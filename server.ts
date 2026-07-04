import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile, spawn } from 'child_process';
import { Readable } from 'stream';
import { createServer as createViteServer } from 'vite';
import ffmpegPath from 'ffmpeg-static';

// yt-dlp runner selection.
// Preferred: a bundled portable Python (./bin/python) running the yt-dlp *zipapp*
//   from node_modules — this starts in ~0.6s.
// The standalone PyInstaller binary (./bin/yt-dlp) is a fallback; it works but
//   re-extracts+rescans itself on every launch on macOS (~19s), so it's slow.
const ROOT = process.cwd();
const PORTABLE_PY = path.join(ROOT, 'bin', 'python', 'bin', 'python3');
const YT_DLP_ZIPAPP = path.join(ROOT, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
const YT_DLP_STANDALONE = path.join(ROOT, 'bin', 'yt-dlp');

// Resolution order: portable Python + zipapp (macOS/Linux, fast) → standalone
// binary in ./bin → `yt-dlp` on PATH (e.g. pip-installed in a Docker/cloud image).
let YT_CMD: string;
let YT_PREFIX: string[];
if (fs.existsSync(PORTABLE_PY) && fs.existsSync(YT_DLP_ZIPAPP)) {
  YT_CMD = PORTABLE_PY;
  YT_PREFIX = [YT_DLP_ZIPAPP];
} else if (fs.existsSync(YT_DLP_STANDALONE)) {
  YT_CMD = YT_DLP_STANDALONE;
  YT_PREFIX = [];
} else {
  YT_CMD = 'yt-dlp'; // assume it's on PATH (cloud/Docker)
  YT_PREFIX = [];
}

const FFMPEG = (ffmpegPath as unknown as string) || '';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Cookies unlock login-walled sites (Instagram, Facebook, private/age-gated, etc.).
// Configure via .env: COOKIES_FROM_BROWSER=chrome|safari|brave|edge|firefox
// or COOKIES_FILE=/path/to/cookies.txt. A cookies.txt in the project root is auto-used.
const COOKIES_BROWSER = (process.env.COOKIES_FROM_BROWSER || '').trim();
const COOKIES_FILE =
  (process.env.COOKIES_FILE || '').trim() ||
  (fs.existsSync(path.join(ROOT, 'cookies.txt')) ? path.join(ROOT, 'cookies.txt') : '');
const COOKIES_ON = !!(COOKIES_FILE || COOKIES_BROWSER);
function cookieArgs(): string[] {
  if (COOKIES_FILE) return ['--cookies', COOKIES_FILE];
  if (COOKIES_BROWSER) return ['--cookies-from-browser', COOKIES_BROWSER];
  return [];
}

// Flags shared by every yt-dlp invocation. --ffmpeg-location is what lets yt-dlp
// merge separate video+audio streams — the reason video links used to yield audio only.
// YouTube extraction actually BREAKS with logged-in cookies (it then requires PO
// tokens → "format not available"). So we only attach cookies to non-YouTube targets.
function isYouTubeTarget(target = ''): boolean {
  return /(?:^|\/\/|\.)youtube\.com|youtu\.be|music\.youtube|^ytsearch/i.test(target);
}

function baseArgs(target = ''): string[] {
  const args = [
    '--no-check-certificates',
    '--no-warnings',
    '--add-header',
    `user-agent:${UA}`,
    // Speed: download many DASH fragments in parallel; skip .part files.
    '--concurrent-fragments',
    '8',
    '--no-part',
    // Robustness: auto-retry transient 403/timeouts instead of failing.
    '--retries',
    '5',
    '--fragment-retries',
    '10',
    '--extractor-retries',
    '3',
  ];
  // Local logged-in cookies BREAK YouTube (PO-token). But on a cloud/datacenter IP,
  // YouTube cookies HELP bypass the "confirm you're not a bot" wall — so allow them
  // for YouTube only when COOKIES_FOR_YOUTUBE=1 (set that on your server, not locally).
  const allowCookies = !isYouTubeTarget(target) || process.env.COOKIES_FOR_YOUTUBE === '1';
  if (allowCookies) args.push(...cookieArgs());
  if (FFMPEG) args.push('--ffmpeg-location', FFMPEG);
  return args;
}

// ---------- helpers ----------
function ytDumpJson(url: string, extra: string[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      YT_CMD,
      [...YT_PREFIX, url, '--dump-single-json', ...extra, ...baseArgs(url)],
      { maxBuffer: 128 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stderr }));
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(Object.assign(new Error('Failed to parse yt-dlp output'), { stderr }));
        }
      }
    );
  });
}

// Get the direct media URL for a format (used for in-browser preview streaming).
function ytGetUrl(url: string, format: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      YT_CMD,
      [...YT_PREFIX, url, '-f', format, '--get-url', '--no-warnings', ...baseArgs(url)],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stderr }));
        const first = stdout.split('\n').map((s) => s.trim()).find((s) => /^https?:/.test(s));
        if (first) resolve(first);
        else reject(new Error('No stream URL'));
      }
    );
  });
}

// Cache resolved direct URLs briefly so seeking (many Range requests) doesn't
// re-run yt-dlp each time. googlevideo URLs stay valid for hours.
const urlCache = new Map<string, { url: string; at: number }>();
const URL_TTL = 20 * 60 * 1000;
async function cachedStreamUrl(pageUrl: string): Promise<string> {
  const hit = urlCache.get(pageUrl);
  if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
  const direct = await ytGetUrl(
    pageUrl,
    'best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none]/best'
  );
  urlCache.set(pageUrl, { url: direct, at: Date.now() });
  return direct;
}

function ytRun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_CMD, [...YT_PREFIX, ...args, ...baseArgs(args[0])]);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`yt-dlp exited with code ${code}`), { stderr }));
    });
  });
}

// ---------- Cobalt fallback (SaveFrom-style) ----------
// When yt-dlp is blocked (e.g. YouTube on a datacenter IP), we ask a public Cobalt
// instance to do the extraction on ITS infrastructure and hand back a direct URL.
// Env COBALT_INSTANCES (comma-separated) overrides/extends this list.
const COBALT_INSTANCES = (
  process.env.COBALT_INSTANCES ||
  'https://dwnld.nichind.dev,https://co.eepy.today,https://cobalt-backend.canine.tools,https://cobalt-api.kwiatekmiki.com'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Returns a direct/tunnel URL for the media, or null if no instance could do it.
async function cobaltResolve(
  pageUrl: string,
  opts: { quality?: string; audioOnly?: boolean } = {}
): Promise<{ url: string; filename?: string } | null> {
  const body: any = opts.audioOnly
    ? { url: pageUrl, downloadMode: 'audio', audioFormat: 'mp3' }
    : { url: pageUrl, downloadMode: 'auto', videoQuality: opts.quality || '1080' };

  for (const base of COBALT_INSTANCES) {
    try {
      const r = await withTimeout(
        fetch(base, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify(body),
        }),
        9000,
        null as any
      );
      if (!r || !r.ok) continue;
      const j: any = await r.json();
      if ((j.status === 'tunnel' || j.status === 'redirect') && j.url) return { url: j.url, filename: j.filename };
      if (j.status === 'picker' && j.picker?.length) return { url: j.picker[0].url, filename: j.filename };
    } catch {
      /* try next instance */
    }
  }
  return null;
}

// Pipe a remote URL straight to the client (used for the Cobalt fallback download).
async function proxyRemote(res: any, remoteUrl: string, filename: string, isAudio: boolean) {
  const upstream = await fetch(remoteUrl, { headers: { 'User-Agent': UA } });
  if (!upstream.ok || !upstream.body) throw new Error(`upstream ${upstream.status}`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  Readable.fromWeb(upstream.body as any).pipe(res);
}

function humanSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// Estimate byte size from bitrate (kbps) × duration (s) when yt-dlp gives no filesize.
function estBytes(f: any, durationSec: number): number | null {
  const kbps = f.tbr || f.vbr || f.abr;
  if (kbps && durationSec) return Math.round((kbps * 1000 * durationSec) / 8);
  return null;
}
function fmtBytes(f: any, durationSec: number): number | null {
  return f.filesize || f.filesize_approx || estBytes(f, durationSec) || null;
}

// ---------- AI smart-resolve (Groq preferred, Gemini fallback, heuristic last) ----------
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
export const AI_ENABLED = !!(GROQ_KEY || GEMINI_KEY);

const AI_SYSTEM = `You resolve user input for a universal video downloader.
Return STRICT JSON: {"target": string, "kind": "url"|"search", "note": string}.
Rules:
- If the input contains a media link (YouTube, Instagram, TikTok, X/Twitter, Facebook, Vimeo, Reddit, SoundCloud, etc.), return the single cleanest canonical URL in "target" (strip tracking params like utm_*, si, feature; keep the video id; for YouTube prefer https://www.youtube.com/watch?v=ID or https://youtu.be/ID). kind="url".
- If the input is a description/song/phrase with no link, return "target":"ytsearch1:<the phrase>" and kind="search".
- "note": one short human sentence about what you did.`;

async function aiResolveGroq(text: string): Promise<any | null> {
  if (!GROQ_KEY) return null;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SYSTEM },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const j: any = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

async function aiResolveGemini(text: string): Promise<any | null> {
  if (!GEMINI_KEY) return null;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_SYSTEM }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const j: any = await r.json();
  const out = j.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(out);
}

type Resolved =
  | { kind: 'url'; url: string; note: string; ai: boolean }
  | { kind: 'search'; query: string; note: string; ai: boolean };

// Spotify/Apple Music audio is DRM-protected and can't be downloaded directly.
// But we can read the track's name+artist (no API key needed) and then fetch the
// same song's audio from YouTube/SoundCloud/etc. — this is how spotDL works too.
async function musicLinkToQuery(url: string): Promise<{ query: string; note: string } | null> {
  try {
    // Spotify
    const sp = url.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
    if (sp) {
      const [, type, id] = sp;
      const r = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'User-Agent': UA } });
      const html = await r.text();
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nd) {
        const j: any = JSON.parse(nd[1]);
        const e = j?.props?.pageProps?.state?.data?.entity;
        if (e?.name) {
          const artists = (e.artists || []).map((a: any) => a.name);
          if (type === 'track') {
            return {
              query: `${artists.join(' ')} ${e.name}`.trim(),
              note: `Spotify track “${e.name}”${artists.length ? ' by ' + artists.join(', ') : ''} — pick a source below to grab the audio.`,
            };
          }
          return { query: e.name, note: `Spotify ${type} “${e.name}” — showing matching results. (Paste a track link for an exact song.)` };
        }
      }
      // Fallback to oEmbed (title only)
      const o = await (await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': UA } })).json().catch(() => null);
      if (o?.title) return { query: o.title, note: `Spotify “${o.title}” — showing matching results to download the audio.` };
    }

    // Apple Music
    const am = url.match(/music\.apple\.com\//);
    if (am) {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const html = await r.text();
      const title = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
      if (title) return { query: title.replace(/\s*[-–]\s*(Single|EP|Album|Apple Music).*/i, '').trim(), note: `Apple Music “${title}” — showing matching results to download the audio.` };
    }
  } catch (e) {
    console.error('music link resolve failed:', (e as any)?.message);
  }
  return null;
}

// Decide whether the user typed a link (→ open it) or a phrase (→ show search results).
async function resolveInput(text: string): Promise<Resolved> {
  const trimmed = text.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);

  // Spotify / Apple Music links → convert to a search for the same song.
  if (urlMatch && /open\.spotify\.com|music\.apple\.com/i.test(urlMatch[0])) {
    const m = await musicLinkToQuery(urlMatch[0]);
    if (m) return { kind: 'search', query: m.query, note: m.note, ai: true };
  }

  // A pasted URL with no surrounding noise → use it directly (fast, no AI latency).
  if (urlMatch && urlMatch[0].length >= trimmed.length - 2) {
    return { kind: 'url', url: cleanUrl(urlMatch[0]), note: '', ai: false };
  }

  // Otherwise let AI clean the link / craft a good search query.
  if (AI_ENABLED) {
    try {
      const res = (await aiResolveGroq(trimmed).catch(() => null)) || (await aiResolveGemini(trimmed).catch(() => null));
      if (res?.target) {
        const target = String(res.target);
        if (res.kind === 'search' || /^ytsearch/i.test(target)) {
          return { kind: 'search', query: target.replace(/^ytsearch\d*:/i, ''), note: res.note || '', ai: true };
        }
        return { kind: 'url', url: cleanUrl(target), note: res.note || '', ai: true };
      }
    } catch (e) {
      console.error('AI resolve failed, using heuristic:', (e as any)?.message);
    }
  }

  if (urlMatch) return { kind: 'url', url: cleanUrl(urlMatch[0]), note: '', ai: false };
  return { kind: 'search', query: trimmed, note: '', ai: false };
}

function durationText(sec: any): string {
  const s = Number(sec) || 0;
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

// Don't let one slow provider block the whole search — fall back to [] after `ms`.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ---- per-platform search (each returns up to n pickable results) ----
// Primary: scrape the YouTube results page (fast, and works on cloud/datacenter IPs
// where yt-dlp's ytsearch is blocked). Falls back to yt-dlp on a residential IP.
async function searchYouTube(query: string, n = 5): Promise<any[]> {
  try {
    const r = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' } }
    );
    const html = await r.text();
    const m = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/s);
    if (m) {
      const j = JSON.parse(m[1]);
      const sections =
        j.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      const items = sections.flatMap((c: any) => c.itemSectionRenderer?.contents || []);
      const out = items
        .filter((i: any) => i.videoRenderer?.videoId)
        .slice(0, n)
        .map((i: any) => {
          const v = i.videoRenderer;
          return {
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: v.title?.runs?.[0]?.text || 'Untitled',
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
            duration: v.lengthText?.simpleText || '',
          };
        });
      if (out.length) return out;
    }
  } catch (e) {
    console.error('YouTube scrape search failed, falling back to yt-dlp:', (e as any)?.message);
  }
  // Fallback: yt-dlp ytsearch (residential IP)
  try {
    const data = await ytDumpJson(`ytsearch${n}:${query}`, ['--flat-playlist']);
    return (data.entries || [])
      .filter((e: any) => e && (e.id || e.url))
      .map((e: any) => ({
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title || 'Untitled',
        thumbnail:
          (e.thumbnails?.length ? e.thumbnails[e.thumbnails.length - 1].url : e.thumbnail) ||
          (e.id ? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` : ''),
        channel: e.channel || e.uploader || '',
        duration: durationText(e.duration),
      }))
      .filter((r: any) => r.url);
  } catch {
    return [];
  }
}

async function searchSoundCloud(query: string, n = 5): Promise<any[]> {
  const data = await ytDumpJson(`scsearch${n}:${query}`, ['--flat-playlist']);
  return (data.entries || [])
    .filter((e: any) => e && (e.url || e.webpage_url))
    .map((e: any) => ({
      url: e.url || e.webpage_url,
      title: e.title || 'Untitled',
      thumbnail: e.thumbnails?.length ? e.thumbnails[e.thumbnails.length - 1].url : (e.thumbnail || ''),
      channel: e.uploader || e.channel || '',
      duration: durationText(e.duration),
    }))
    .filter((r: any) => r.url);
}

// Dailymotion has a public search API (no key required).
async function searchDailymotion(query: string, n = 5): Promise<any[]> {
  const url =
    `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}` +
    `&limit=${n}&fields=id,title,duration,thumbnail_360_url,owner.screenname`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const j: any = await r.json();
  return (j.list || []).map((v: any) => ({
    url: `https://www.dailymotion.com/video/${v.id}`,
    title: v.title || 'Untitled',
    thumbnail: v.thumbnail_360_url || '',
    channel: v['owner.screenname'] || '',
    duration: durationText(v.duration),
  }));
}

// Run every provider in parallel and group the results by platform.
async function multiSearch(query: string): Promise<any[]> {
  const [yt, dm, sc] = await Promise.all([
    withTimeout(searchYouTube(query, 5), 15000, []),
    withTimeout(searchDailymotion(query, 5), 8000, []),
    withTimeout(searchSoundCloud(query, 5), 15000, []),
  ]);
  return [
    { platform: 'YouTube', kind: 'video', results: yt },
    { platform: 'Dailymotion', kind: 'video', results: dm },
    { platform: 'SoundCloud', kind: 'audio', results: sc },
  ].filter((g) => g.results.length > 0);
}

function cleanUrl(u: string): string {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'si', 'feature', 'list', 'index', 'pp'].forEach(
      (p) => url.searchParams.delete(p)
    );
    return url.toString().replace(/[)>\]]+$/, '');
  } catch {
    return u;
  }
}

// ---------- build the format lists shown in the UI ----------
function buildFormats(info: any) {
  const durationSec = Number(info.duration) || 0;
  const all: any[] = info.formats || [];

  // best audio-only stream (for merged-video size estimate + MP3 conversion)
  const audioOnly = all
    .filter((f) => (f.acodec && f.acodec !== 'none') && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));
  const bestAudio = audioOnly[0];
  const bestAudioBytes = bestAudio ? fmtBytes(bestAudio, durationSec) : 0;

  // ---- video options, one per available resolution bucket ----
  const byHeight = new Map<number, any>();
  for (const f of all) {
    if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
    const prev = byHeight.get(f.height);
    // prefer mp4/avc1, then higher bitrate
    const score = (x: any) =>
      (String(x.ext) === 'mp4' ? 2 : 0) +
      (String(x.vcodec).startsWith('avc1') ? 1 : 0) +
      (x.tbr || 0) / 100000;
    if (!prev || score(f) > score(prev)) byHeight.set(f.height, f);
  }

  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  const maxH = heights[0] || 0;
  const video = heights.map((h) => {
    const f = byHeight.get(h);
    const hasOwnAudio = f.acodec && f.acodec !== 'none';
    const vBytes = fmtBytes(f, durationSec) || 0;
    const total = hasOwnAudio ? vBytes : vBytes + (bestAudioBytes || 0);
    return {
      id: `v${h}`,
      height: h,
      label: `${h}p`,
      ext: 'mp4',
      size: total || null,
      sizeText: humanSize(total),
      note: h === maxH ? 'Best Quality' : '',
    };
  });

  // Only offer a generic "Best" video option when we truly can't tell the format —
  // not for audio-only sources (e.g. SoundCloud), which should show Audio only.
  if (video.length === 0 && audioOnly.length === 0) {
    video.push({ id: 'best', height: 0, label: 'Best Quality', ext: 'mp4', size: null, sizeText: '', note: 'Auto' });
  }

  // ---- audio options ----
  // Native streams first (no re-encode = fast, ~3s). The first/best one is the
  // recommended default. MP3 is offered last because it must be transcoded (slower).
  const audio: any[] = [];
  const seenExt = new Set<string>();
  let firstAudio = true;
  for (const f of audioOnly) {
    const ext = String(f.ext || '').toLowerCase();
    if (!ext || seenExt.has(ext)) continue;
    seenExt.add(ext);
    const bytes = fmtBytes(f, durationSec);
    audio.push({
      // Encoded by extension (not raw itag): a raw format_id is client-specific and
      // often 403s; `bestaudio[ext=…]` lets yt-dlp pick a downloadable stream.
      id: `a:${ext}`,
      label: ext.toUpperCase(),
      ext,
      bitrate: f.abr ? Math.round(f.abr) : null,
      size: bytes || null,
      sizeText: humanSize(bytes),
      note: firstAudio ? 'Recommended · fast' : 'Original',
    });
    firstAudio = false;
    if (seenExt.size >= 3) break;
  }
  // MP3 (transcoded) — most compatible but slower.
  audio.push({
    id: 'audio',
    label: 'MP3',
    ext: 'mp3',
    bitrate: bestAudio?.abr ? Math.round(bestAudio.abr) : null,
    size: bestAudioBytes || null,
    sizeText: bestAudioBytes ? `~${humanSize(bestAudioBytes)}` : '',
    note: 'Converts · slower',
  });

  return { video, audio };
}

// Full media payload for the UI (metadata + format lists + preview player).
function buildMedia(info: any) {
  const { video, audio } = buildFormats(info);

  const resolvedUrl = info.webpage_url || info.original_url || '';

  // Preview streams through our own /api/stream (works on every platform, unlike
  // YouTube's embed which errors on localhost / embed-disabled videos).
  const previewUrl = resolvedUrl ? `/api/stream?url=${encodeURIComponent(resolvedUrl)}` : '';

  // Downloadable thumbnail/image options (distinct resolutions, biggest first).
  const seenRes = new Set<string>();
  const images = (info.thumbnails || [])
    .filter((t: any) => t.url && /^https?/.test(t.url))
    .sort((a: any, b: any) => (b.width || b.preference || 0) - (a.width || a.preference || 0))
    .map((t: any) => {
      const w = t.width, h = t.height;
      const label = w && h ? `${w}×${h}` : (t.id ? String(t.id) : 'Image');
      return { url: t.url, label, width: w || 0, height: h || 0 };
    })
    .filter((im: any) => {
      const key = im.label;
      if (seenRes.has(key)) return false;
      seenRes.add(key);
      return true;
    })
    .slice(0, 6);
  // Fallback to the single thumbnail if the array was empty.
  if (images.length === 0 && info.thumbnail) images.push({ url: info.thumbnail, label: 'Default', width: 0, height: 0 });

  return {
    title: info.title || 'Media',
    thumbnail:
      info.thumbnail ||
      (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : ''),
    duration: info.duration_string || info.duration || '',
    uploader: info.uploader || info.channel || info.extractor_key || '',
    source: info.extractor_key || '',
    resolvedUrl,
    previewUrl,
    images,
    video,
    audio,
  };
}

// Fallback media when yt-dlp can't reach the site (e.g. YouTube blocked on a cloud
// IP). Title/thumbnail come from oEmbed (works from any IP); downloads then go via
// the Cobalt fallback. Standard quality options are offered without exact sizes.
async function fallbackMedia(pageUrl: string) {
  let title = 'Video';
  let thumbnail = '';
  try {
    const o: any = await withTimeout(
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(pageUrl)}&format=json`, {
        headers: { 'User-Agent': UA },
      }).then((r) => (r.ok ? r.json() : null)),
      6000,
      null
    );
    if (o?.title) title = o.title;
    if (o?.thumbnail_url) thumbnail = o.thumbnail_url;
  } catch {
    /* keep defaults */
  }
  const video = [1080, 720, 480, 360].map((hh) => ({
    id: `v${hh}`, height: hh, label: `${hh}p`, ext: 'mp4',
    size: null, sizeText: '', note: hh === 1080 ? 'Best Quality' : '',
  }));
  const audio = [{ id: 'audio', label: 'MP3', ext: 'mp3', bitrate: null, size: null, sizeText: '', note: 'Audio' }];
  return {
    title, thumbnail, duration: '', uploader: '', source: 'YouTube',
    resolvedUrl: pageUrl,
    previewUrl: `/api/stream?url=${encodeURIComponent(pageUrl)}`,
    images: thumbnail ? [{ url: thumbnail, label: 'Default', width: 0, height: 0 }] : [],
    video, audio,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000; // cloud hosts inject PORT

  // CORS — lets a separately-hosted frontend (e.g. on Vercel) call this API.
  // Set FRONTEND_ORIGIN to lock it to your site; defaults to allow-all.
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  // Expose whether AI is configured so the UI can show the right badge.
  app.get('/api/config', (_req, res) => res.json({ ai: AI_ENABLED, cookies: COOKIES_ON }));

  // ---- Preview stream: proxy a playable progressive stream (all platforms) ----
  // Used by an HTML5 <video> so preview works everywhere, not just YouTube embeds.
  app.get('/api/stream', async (req, res) => {
    const src = req.query.url;
    if (!src || typeof src !== 'string') return res.status(400).send('url required');
    try {
      const direct = await cachedStreamUrl(src);
      const range = req.headers.range;
      const upstream = await fetch(direct, {
        headers: { 'User-Agent': UA, ...(range ? { Range: range } : {}) },
      });
      res.status(upstream.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body as any).pipe(res);
      res.on('close', () => {});
    } catch (e: any) {
      console.error('Stream error:', e?.stderr || e?.message || e);
      if (!res.headersSent) res.status(502).send('Preview unavailable');
    }
  });

  // ---- Thumbnail/image download in any format (jpg/png/webp) ----
  app.get('/api/image', async (req, res) => {
    const src = req.query.src;
    const format = String(req.query.format || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!src || typeof src !== 'string') return res.status(400).send('src required');
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
    const fmt = allowed.includes(format) ? format : 'jpg';

    const tmpBase = path.join(os.tmpdir(), `img-${Date.now()}-${process.pid}`);
    const inFile = `${tmpBase}.src`;
    const outFile = `${tmpBase}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
    try {
      const r = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      fs.writeFileSync(inFile, Buffer.from(await r.arrayBuffer()));

      // Convert with ffmpeg (handles jpg↔png↔webp↔bmp).
      await new Promise<void>((resolve, reject) => {
        const p = spawn(FFMPEG, ['-y', '-i', inFile, outFile]);
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        p.on('error', reject);
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-200)))));
      });

      const stat = fs.statSync(outFile);
      const ctype = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : fmt === 'bmp' ? 'image/bmp' : 'image/jpeg';
      res.setHeader('Content-Type', ctype);
      res.setHeader('Content-Length', stat.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="thumbnail.${fmt === 'jpeg' ? 'jpg' : fmt}"`);
      const stream = fs.createReadStream(outFile);
      stream.pipe(res);
      stream.on('close', () => { fs.unlink(inFile, () => {}); fs.unlink(outFile, () => {}); });
    } catch (e: any) {
      console.error('Image error:', e?.message || e);
      fs.unlink(inFile, () => {});
      fs.unlink(outFile, () => {});
      if (!res.headersSent) res.status(500).send('Image conversion failed');
    }
  });

  // Live search suggestions (YouTube's own autocomplete — instant, per keystroke).
  app.get('/api/suggest', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || /^https?:\/\//i.test(q)) return res.json({ suggestions: [] });
    try {
      const r = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': UA } }
      );
      const j: any = await r.json();
      res.json({ suggestions: (j[1] || []).slice(0, 8) });
    } catch {
      res.json({ suggestions: [] });
    }
  });

  // ---- Analyze: link → formats, OR phrase → pickable search results ----
  app.post('/api/analyze', async (req, res) => {
    const { url } = req.body || {};
    const text = String(url || '').trim();
    if (!text) return res.status(400).json({ error: 'Please enter a link or a search.' });

    try {
      const resolved = await resolveInput(text);
      if (resolved.kind === 'search') {
        const groups = await multiSearch(resolved.query);
        if (groups.length === 0) return res.status(404).json({ error: 'No results found on any platform.' });
        return res.json({
          type: 'results',
          query: resolved.query,
          aiNote: resolved.ai ? resolved.note : '',
          groups,
        });
      }
      try {
        if (process.env.FORCE_COBALT === '1' && isYouTubeTarget(resolved.url)) throw new Error('forced-cobalt');
        const info = await ytDumpJson(resolved.url);
        return res.json({ type: 'media', aiNote: resolved.ai ? resolved.note : '', ...buildMedia(info) });
      } catch (ytErr) {
        // yt-dlp blocked → serve fallback options (download will use Cobalt).
        const media = await fallbackMedia(resolved.url);
        return res.json({ type: 'media', aiNote: resolved.ai ? resolved.note : '', ...media });
      }
    } catch (error: any) {
      console.error('Analyze error:', error?.stderr || error?.message || error);
      res.status(500).json({ error: mapError(error) });
    }
  });

  // ---- Info: a specific URL (e.g. a picked search result) → formats ----
  app.post('/api/info', async (req, res) => {
    const { url } = req.body || {};
    if (!url || !String(url).trim()) return res.status(400).json({ error: 'Please enter a link.' });
    const clean = cleanUrl(String(url).trim());
    try {
      if (process.env.FORCE_COBALT === '1' && isYouTubeTarget(clean)) throw new Error('forced-cobalt');
      const info = await ytDumpJson(clean);
      res.json({ type: 'media', aiNote: '', ...buildMedia(info) });
    } catch (error: any) {
      console.error('Error fetching info (yt-dlp), using fallback:', error?.message || error);
      try {
        const media = await fallbackMedia(clean);
        res.json({ type: 'media', aiNote: '', ...media });
      } catch (e2: any) {
        res.status(500).json({ error: mapError(error) });
      }
    }
  });

  // ---- Download: fetch (merge if needed) to a temp file, then stream it ----
  app.get('/api/download', async (req, res) => {
    const { url, format } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL is required');

    const quality = typeof format === 'string' ? format : 'best';
    const isMp3 = quality === 'audio';
    const isNativeAudio = quality.startsWith('a:');
    const wantAudio = isMp3 || isNativeAudio;
    const cobQuality = quality.startsWith('v') ? quality.slice(1) : '1080';

    // On a cloud IP yt-dlp is always blocked for YouTube, so FORCE_COBALT=1 skips the
    // doomed ~20s yt-dlp attempt and goes straight to the Cobalt fallback (YouTube only;
    // other sites still use yt-dlp, which works fine from the cloud).
    if (process.env.FORCE_COBALT === '1' && isYouTubeTarget(url)) {
      try {
        const cob = await cobaltResolve(url, { quality: cobQuality, audioOnly: wantAudio });
        if (cob?.url) return await proxyRemote(res, cob.url, cob.filename || `download.${wantAudio ? 'mp3' : 'mp4'}`, wantAudio);
        return res.status(502).send('Could not fetch this link right now. Please try again.');
      } catch (e: any) {
        console.error('Cobalt (forced) failed:', e?.message || e);
        return res.status(502).send('Could not fetch this link right now. Please try again.');
      }
    }

    const tmpBase = path.join(os.tmpdir(), `uvd-${Date.now()}-${process.pid}`);
    const outputTemplate = `${tmpBase}.%(ext)s`;
    let producedFile: string | null = null;

    try {
      if (isMp3) {
        await ytRun([url, '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3',
          '--audio-quality', '0', '-o', outputTemplate]);
      } else if (isNativeAudio) {
        const ext = quality.slice(2);
        await ytRun([url, '-f', `bestaudio[ext=${ext}]/bestaudio/best`, '-o', outputTemplate]);
      } else {
        const h = quality.startsWith('v') ? parseInt(quality.slice(1), 10) : 0;
        const cap = h ? `[height<=${h}]` : '';
        const fmt = [
          `bv*${cap}[vcodec^=avc1]+ba[acodec^=mp4a]`,
          `bv*${cap}[ext=mp4]+ba[ext=m4a]`,
          `bv*${cap}+ba`,
          `b${cap}`,
          'best',
        ].join('/');
        await ytRun([url, '-f', fmt, '--merge-output-format', 'mp4', '-o', outputTemplate]);
      }

      const dir = path.dirname(tmpBase);
      const prefix = path.basename(tmpBase);
      const match = fs.readdirSync(dir).find((f) => f.startsWith(prefix));
      if (!match) return res.status(500).send('Download produced no file.');

      producedFile = path.join(dir, match);
      const stat = fs.statSync(producedFile);
      const ext = path.extname(match);
      const audioType = ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/webm';

      res.setHeader('Content-Type', isMp3 || isNativeAudio ? audioType : 'video/mp4');
      res.setHeader('Content-Length', stat.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="download${ext}"`);

      const stream = fs.createReadStream(producedFile);
      stream.pipe(res);
      const cleanup = () => {
        if (producedFile) { fs.unlink(producedFile, () => {}); producedFile = null; }
      };
      stream.on('close', cleanup);
      stream.on('error', (err) => { console.error('Stream error:', err); cleanup(); if (!res.headersSent) res.status(500).end(); });
      res.on('close', () => stream.destroy());
    } catch (error: any) {
      console.error('Download error (yt-dlp):', error?.stderr || error?.message || error);
      if (producedFile) fs.unlink(producedFile, () => {});

      // Fallback: yt-dlp was blocked (e.g. YouTube on a cloud IP) → try Cobalt.
      if (!res.headersSent) {
        try {
          const h = quality.startsWith('v') ? quality.slice(1) : '1080';
          const cob = await cobaltResolve(url, { quality: h, audioOnly: isMp3 || isNativeAudio });
          if (cob?.url) {
            console.log('[download] using Cobalt fallback');
            const ext = isMp3 || isNativeAudio ? 'mp3' : 'mp4';
            return await proxyRemote(res, cob.url, cob.filename || `download.${ext}`, isMp3 || isNativeAudio);
          }
        } catch (e: any) {
          console.error('Cobalt fallback failed:', e?.message || e);
        }
        res.status(500).send('Download failed: ' + mapError(error));
      }
    }
  });

  // ---- Frontend ----
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅ Universal Video Downloader running:`);
    console.log(`     ➜  http://localhost:${PORT}`);
    console.log(`     AI smart-paste: ${AI_ENABLED ? 'ON' : 'off (add GROQ_API_KEY or GEMINI_API_KEY)'}`);
    console.log(`     Login cookies:  ${COOKIES_ON ? (COOKIES_FILE ? 'file' : `browser:${COOKIES_BROWSER}`) : 'off (set COOKIES_FROM_BROWSER for Instagram/FB)'}\n`);
  });
}

function mapError(error: any): string {
  const msg = (error?.stderr || error?.message || '').toString();

  // Login-walled platforms (Instagram, Facebook, private/age-gated content).
  if (/empty media response|login required|requires? (?:a )?login|use --cookies|rate.?limit|only available to|account|not granting access|Sign in to confirm|not a bot|age.?restrict/i.test(msg)) {
    return COOKIES_ON
      ? 'This post needs a logged-in session that could not access it. Make sure you are logged in to that site in the browser set as COOKIES_FROM_BROWSER, and that the post is visible there.'
      : 'This platform (e.g. Instagram/Facebook) needs you to be logged in. Enable cookies once: put COOKIES_FROM_BROWSER=chrome (or safari) in your .env and restart. Then log in to that site in that browser.';
  }
  if (/Video unavailable|Private video|members-only|This video is private/i.test(msg))
    return 'This video is unavailable, private, or region-restricted.';
  if (/Unsupported URL|no video|Unable to extract|Unable to find|nothing to download/i.test(msg))
    return 'This link/platform is not supported, or nothing was found at that URL.';
  if (/timed out|Connection reset|getaddrinfo|Temporary failure|Failed to resolve|Network is unreachable/i.test(msg))
    return 'Network error reaching the site. Please check your connection and try again.';
  return 'Could not process this link. Please check it and try again.';
}

startServer();
