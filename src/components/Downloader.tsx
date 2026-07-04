import React, { useState, useEffect, useRef } from 'react';
import { VideoInfo, MediaFormat, SearchResult, PlatformGroup } from '../types';
import { ProgressBar } from './ProgressBar';
import {
  Search, Download, FileVideo, FileAudio, AlertCircle, Loader2,
  Sparkles, Clapperboard, Music, ArrowLeft, Play, TrendingUp, X, Image as ImageIcon,
  ChevronRight, Youtube,
} from 'lucide-react';

// Backend base URL. Empty = same origin (all-in-one). Set VITE_API_BASE to point a
// Vercel-hosted frontend at a separate backend (e.g. https://app.onrender.com).
const API = ((import.meta as any).env?.VITE_API_BASE || '').replace(/\/$/, '');

// Light haptic feedback (vibrate on mobile; no-op on desktop, paired with CSS scale).
function haptic(ms = 8) {
  try { (navigator as any).vibrate?.(ms); } catch {}
}

type Mode = 'video' | 'audio' | 'image';
const IMAGE_FORMATS = ['jpg', 'png', 'webp'] as const;
type View = 'search' | 'results' | 'media';

export function Downloader() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('search');
  const [groups, setGroups] = useState<PlatformGroup[]>([]);
  const [searchNote, setSearchNote] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [mode, setMode] = useState<Mode>('video');
  const [imgFormat, setImgFormat] = useState<typeof IMAGE_FORMATS[number]>('jpg');
  const [playing, setPlaying] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false); // server is fetching/converting, no bytes yet
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSizeLabel, setDownloadSizeLabel] = useState('');

  // Live suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [sugIndex, setSugIndex] = useState(-1);
  const suggestAbort = useRef<AbortController | null>(null);
  const justPicked = useRef(false); // suppress the fetch triggered by programmatic setUrl

  // Abort controllers so old requests get cancelled when the user moves on.
  const analyzeAbort = useRef<AbortController | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json()).then(d => setAiEnabled(!!d.ai)).catch(() => {});
  }, []);

  // Debounced live suggestions as the user types.
  useEffect(() => {
    if (justPicked.current) { justPicked.current = false; return; }
    const q = url.trim();
    if (view !== 'search' || q.length < 2 || /^https?:\/\//i.test(q)) {
      setSuggestions([]); setShowSug(false); return;
    }
    const t = setTimeout(async () => {
      suggestAbort.current?.abort();
      const ac = new AbortController();
      suggestAbort.current = ac;
      try {
        const r = await fetch(`${API}/api/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        const d = await r.json();
        setSuggestions(d.suggestions || []);
        setShowSug((d.suggestions || []).length > 0);
        setSugIndex(-1);
      } catch { /* aborted */ }
    }, 160);
    return () => clearTimeout(t);
  }, [url, view]);

  const cancelInflight = () => {
    analyzeAbort.current?.abort();
    downloadAbort.current?.abort();
  };

  const analyze = (e: React.FormEvent) => { e.preventDefault(); runAnalyze(url); };

  const chooseSuggestion = (s: string) => {
    justPicked.current = true;
    setUrl(s);
    setSuggestions([]); setShowSug(false); setSugIndex(-1);
    haptic(8);
    runAnalyze(s);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSug || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSugIndex(i => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSugIndex(i => (i - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter' && sugIndex >= 0) { e.preventDefault(); chooseSuggestion(suggestions[sugIndex]); }
    else if (e.key === 'Escape') { setShowSug(false); setSugIndex(-1); }
  };

  const runAnalyze = async (text: string) => {
    if (!text.trim()) return;
    haptic(10);
    cancelInflight();
    setShowSug(false); setSuggestions([]);
    const ac = new AbortController();
    analyzeAbort.current = ac;
    setLoading(true);
    setError(null);
    setGroups([]);
    setVideoInfo(null);
    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text.trim() }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze');
      if (data.type === 'results') {
        setGroups(data.groups || []);
        setSearchNote(data.aiNote || '');
        setView('results');
      } else {
        setVideoInfo(data);
        setMode(data.video?.length ? 'video' : 'audio');
        setPlaying(false);
        setView('media');
      }
      haptic(15);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (analyzeAbort.current === ac) setLoading(false);
    }
  };

  const pickResult = async (r: SearchResult) => {
    haptic(10);
    cancelInflight();
    const ac = new AbortController();
    analyzeAbort.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: r.url }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setVideoInfo(data);
      setMode(data.video?.length ? 'video' : 'audio');
      setPlaying(false);
      setView('media');
      haptic(15);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (analyzeAbort.current === ac) setLoading(false);
    }
  };

  const goBack = () => {
    haptic(8);
    cancelInflight();
    setError(null);
    setPlaying(false);
    if (view === 'media' && groups.length > 0) { setVideoInfo(null); setView('results'); }
    else { setGroups([]); setVideoInfo(null); setView('search'); }
  };

  const startDownload = async (format: MediaFormat) => {
    if (!videoInfo) return;
    haptic(12);
    downloadAbort.current?.abort();
    const ac = new AbortController();
    downloadAbort.current = ac;
    setDownloadingId(format.id);
    setPreparing(true);
    setDownloadProgress(0);
    setDownloadSizeLabel('');
    setError(null);
    try {
      const dlUrl = `${API}/api/download?url=${encodeURIComponent(videoInfo.resolvedUrl)}&format=${encodeURIComponent(format.id)}`;
      const response = await fetch(dlUrl, { signal: ac.signal });
      if (!response.ok) throw new Error('Download failed to start');

      let totalBytes = format.size || 0;
      if (!totalBytes) {
        const cl = response.headers.get('content-length');
        if (cl) totalBytes = parseInt(cl, 10);
      }
      if (!response.body) throw new Error('Streaming not supported in this browser');

      const reader = response.body.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          setPreparing(false); // first bytes arrived → switch to real progress
          chunks.push(value);
          received += value.length;
          if (totalBytes) {
            setDownloadProgress((received / totalBytes) * 100);
            setDownloadSizeLabel(`${(received / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`);
          } else {
            setDownloadProgress(p => Math.min(p + 4, 95));
            setDownloadSizeLabel(`${(received / 1048576).toFixed(1)} MB`);
          }
        }
      }

      setDownloadProgress(100);
      setDownloadSizeLabel('Saving…');
      const blob = new Blob(chunks as BlobPart[]);
      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      const clean = (videoInfo.title || 'media').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'media';
      a.download = `${clean}_${format.label}.${format.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objUrl);
      haptic(20);
      setDownloadingId(null);
      setPreparing(false);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(`Download error: ${err.message}`);
      setDownloadingId(null);
      setPreparing(false);
    }
  };

  const downloadImage = (img: { url: string; label: string }) => {
    haptic(12);
    const a = document.createElement('a');
    a.href = `${API}/api/image?src=${encodeURIComponent(img.url)}&format=${imgFormat}`;
    const clean = (videoInfo?.title || 'thumbnail').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'thumbnail';
    a.download = `${clean}_${img.label.replace(/[^0-9x]/gi, '')}.${imgFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const list = videoInfo ? (mode === 'video' ? videoInfo.video : videoInfo.audio) : [];
  const isAudioConvert = (f: MediaFormat) => f.id === 'audio';

  return (
    <div className="w-full flex flex-col items-center gap-8">
      <div className="w-full max-w-3xl text-center space-y-3">
        <h1 className="text-4xl md:text-5xl font-serif italic text-[#414132]">Archive your favorite moments.</h1>
        <p className="text-[#5A5A40]/60 max-w-lg mx-auto">
          Paste a link — or just type a song name — from YouTube, Instagram, TikTok, X & 1700+ sites.
        </p>
        {aiEnabled && (
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#5A5A40]/70 bg-[#5A5A40]/8 px-3 py-1 rounded-full ring-1 ring-[#5A5A40]/10">
            <Sparkles className="w-3 h-3" /> AI Smart Search
          </div>
        )}
      </div>

      {/* search */}
      <div className="w-full max-w-3xl bg-white rounded-[40px] p-2 shadow-xl shadow-[#5A5A40]/5 flex items-center ring-1 ring-[#5A5A40]/10 relative transition-all duration-300 focus-within:ring-2 focus-within:ring-[#5A5A40]/30 focus-within:shadow-2xl">
        <div className="absolute left-6 text-[#5A5A40]/30 hidden sm:block pointer-events-none">
          <Search className="w-6 h-6" />
        </div>
        <form onSubmit={analyze} className="flex flex-1 items-center">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onSearchKeyDown}
            onFocus={() => { if (suggestions.length) setShowSug(true); }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            autoComplete="off"
            placeholder={aiEnabled ? 'Paste a link or type a song / video name…' : 'https://www.youtube.com/watch?v=…'}
            className="flex-1 bg-transparent px-6 sm:pl-16 sm:pr-8 py-3 sm:py-5 outline-none text-base sm:text-lg placeholder-[#5A5A40]/30 text-[#333333]"
            required
          />
          <button
            type="submit"
            disabled={loading}
            onMouseEnter={() => haptic(5)}
            className="bg-[#5A5A40] text-white px-6 sm:px-10 py-3 sm:py-5 rounded-[32px] font-semibold hover:bg-[#4A4A35] active:scale-95 transition-all duration-150 disabled:opacity-70 flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (aiEnabled ? 'Search' : 'Analyze')}
          </button>
        </form>

        {/* live suggestions */}
        {showSug && suggestions.length > 0 && view === 'search' && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-3xl shadow-2xl shadow-[#5A5A40]/10 ring-1 ring-[#5A5A40]/10 py-2 z-20 overflow-hidden animate-[fadeIn_.15s_ease]">
            {suggestions.map((s, i) => (
              <button
                key={s + i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                onMouseEnter={() => { setSugIndex(i); haptic(3); }}
                className={`w-full text-left px-6 py-2.5 flex items-center gap-3 text-[15px] transition-colors ${
                  i === sugIndex ? 'bg-[#5A5A40]/8 text-[#414132]' : 'text-[#5A5A40]/80 hover:bg-[#5A5A40]/5'
                }`}
              >
                <TrendingUp className="w-4 h-4 text-[#5A5A40]/40 flex-shrink-0" />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {(view === 'results' || view === 'media') && (
        <div className={`w-full max-w-3xl ${view === 'results' ? 'lg:max-w-5xl' : ''}`}>
          <button onClick={goBack} onMouseEnter={() => haptic(4)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5A5A40]/70 hover:text-[#5A5A40] active:scale-95 transition-all">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
      )}

      {error && (
        <div className="w-full max-w-3xl bg-red-50 border border-red-200 p-4 rounded-[32px] flex items-start gap-3 ring-1 ring-red-500/20 animate-[fadeIn_.3s_ease]">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-red-700 text-sm font-medium">{error}</p>
        </div>
      )}

      {loading && (
        <div className="w-full max-w-3xl flex items-center justify-center gap-3 text-[#5A5A40]/60 py-6 animate-[fadeIn_.3s_ease]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">{view === 'search' ? 'Finding the best matches…' : 'Loading formats…'}</span>
        </div>
      )}

      {/* SEARCH RESULTS */}
      {!loading && view === 'results' && (
        <div className="w-full max-w-3xl lg:max-w-5xl flex flex-col gap-6 animate-[fadeIn_.4s_ease]">
          {searchNote && (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-[#5A5A40]/60 justify-center text-center px-2">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" /> {searchNote}
            </p>
          )}
          {groups.map((g) => {
            const PlatIcon = g.platform === 'YouTube' ? Youtube : g.kind === 'audio' ? Music : Play;
            return (
              <div key={g.platform} className="flex flex-col gap-2">
                {/* platform header */}
                <div className="flex items-center gap-2.5 px-0.5 mb-0.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white bg-[#5A5A40] px-2.5 py-1 rounded-lg">
                    <PlatIcon className="w-3.5 h-3.5" /> {g.platform}
                  </span>
                  <div className="flex-1 h-px bg-[#5A5A40]/10" />
                  <span className="text-[11px] text-[#5A5A40]/40 font-semibold">{g.results.length}</span>
                </div>

                {/* compact result rows (2 columns on wide screens) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                  {g.results.map((r, i) => (
                    <button key={r.url + i} onClick={() => pickResult(r)} onMouseEnter={() => haptic(3)}
                      className="group text-left bg-white/70 border border-[#5A5A40]/12 rounded-2xl p-2 flex items-center gap-3 shadow-sm transition-all duration-200 hover:bg-white hover:border-[#5A5A40]/30 hover:shadow-md active:scale-[.99]">
                      <div className="relative w-24 sm:w-28 aspect-video rounded-xl overflow-hidden bg-[#5A5A40]/5 flex-shrink-0">
                        {r.thumbnail
                          ? <img src={r.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          : <div className="w-full h-full flex items-center justify-center text-[#5A5A40]/30"><PlatIcon className="w-5 h-5" /></div>}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25">
                          <Play className="w-6 h-6 text-white fill-white" />
                        </div>
                        {r.duration && <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[9px] px-1 py-0.5 rounded font-medium leading-none">{r.duration}</span>}
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <div className="text-[13px] sm:text-sm font-medium text-[#333333] line-clamp-2 leading-snug">{r.title}</div>
                        {r.channel && <div className="text-[11px] text-[#5A5A40]/55 mt-0.5 truncate">{r.channel}</div>}
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#5A5A40]/25 group-hover:text-[#5A5A40] group-hover:translate-x-0.5 transition-all flex-shrink-0 mr-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MEDIA / FORMATS */}
      {!loading && view === 'media' && videoInfo && (
        <div className="w-full max-w-3xl flex flex-col gap-8 animate-[fadeIn_.4s_ease]">
          {/* full-width preview player (streamed through our server → works on every platform) */}
          {playing && videoInfo.previewUrl && (
            <div className="relative rounded-[32px] overflow-hidden bg-black aspect-video ring-1 ring-[#5A5A40]/20 shadow-lg animate-[fadeIn_.3s_ease]">
              <video
                className="w-full h-full"
                src={`${API}${videoInfo.previewUrl}`}
                controls autoPlay playsInline
                onError={() => setError('Preview could not load for this video, but you can still download it.')}
              />
              <button onClick={() => { setPlaying(false); haptic(8); }}
                className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-sm transition-colors active:scale-95 z-10">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="bg-white/60 border border-[#5A5A40]/20 rounded-[40px] p-6 flex flex-col sm:flex-row gap-6 shadow-sm">
            <button
              type="button"
              onClick={() => { if (videoInfo.previewUrl) { setPlaying(p => !p); haptic(10); } }}
              onMouseEnter={() => haptic(3)}
              disabled={!videoInfo.previewUrl}
              className="w-full sm:w-1/3 bg-[#5A5A40]/5 rounded-[32px] overflow-hidden aspect-video relative group flex-shrink-0 disabled:cursor-default"
            >
              {videoInfo.thumbnail
                ? <img src={videoInfo.thumbnail} alt={videoInfo.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                : <div className="w-full h-full flex items-center justify-center text-[#5A5A40]/30"><FileVideo className="w-12 h-12" /></div>}
              {(videoInfo.previewUrl) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-90 group-hover:opacity-100 group-hover:bg-black/35 transition-all">
                  <div className="bg-white/95 rounded-full p-3.5 shadow-lg group-hover:scale-110 transition-transform">
                    <Play className="w-6 h-6 text-[#5A5A40] fill-[#5A5A40] ml-0.5" />
                  </div>
                </div>
              )}
            </button>
            <div className="flex-1 flex flex-col justify-center min-w-0">
              <h2 className="text-xl md:text-2xl font-serif text-[#414132] mb-2 line-clamp-2" title={videoInfo.title}>{videoInfo.title}</h2>
              <p className="text-[#5A5A40]/60 text-sm truncate">
                {videoInfo.uploader && <span>{videoInfo.uploader} · </span>}
                {videoInfo.source && <span className="capitalize">{videoInfo.source}</span>}
                {videoInfo.duration ? <span> · {videoInfo.duration}</span> : null}
              </p>
              {(videoInfo.previewUrl) && (
                <button onClick={() => { setPlaying(p => !p); haptic(8); }} onMouseEnter={() => haptic(3)}
                  className="mt-3 self-start inline-flex items-center gap-1.5 text-xs font-bold text-[#5A5A40] border border-[#5A5A40]/30 hover:bg-[#5A5A40] hover:text-white px-4 py-2 rounded-full transition-all active:scale-95">
                  {playing ? <><X className="w-3.5 h-3.5" /> Close preview</> : <><Play className="w-3.5 h-3.5 fill-current" /> Preview</>}
                </button>
              )}
              {videoInfo.aiNote && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#5A5A40]/70">
                  <Sparkles className="w-3.5 h-3.5" /> {videoInfo.aiNote}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="bg-white/70 ring-1 ring-[#5A5A40]/15 rounded-full p-1 flex gap-1 shadow-sm">
              {(['video', 'audio', 'image'] as Mode[]).map((m) => {
                const active = mode === m;
                const Icon = m === 'video' ? Clapperboard : m === 'audio' ? Music : ImageIcon;
                const label = m === 'video' ? 'Video' : m === 'audio' ? 'Audio' : 'Image';
                return (
                  <button key={m} onClick={() => { setMode(m); haptic(8); }} onMouseEnter={() => haptic(4)}
                    className={`flex items-center gap-2 px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-all duration-200 active:scale-95 ${active ? 'bg-[#5A5A40] text-white shadow' : 'text-[#5A5A40]/70 hover:bg-[#5A5A40]/5'}`}>
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* IMAGE MODE: format selector + resolution cards */}
          {mode === 'image' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/50 mr-1">Format</span>
                {IMAGE_FORMATS.map((f) => (
                  <button key={f} onClick={() => { setImgFormat(f); haptic(6); }} onMouseEnter={() => haptic(3)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase transition-all active:scale-95 ${imgFormat === f ? 'bg-[#5A5A40] text-white shadow' : 'bg-white/70 ring-1 ring-[#5A5A40]/20 text-[#5A5A40]/70 hover:bg-white'}`}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(videoInfo.images || []).map((img, i) => (
                  <div key={img.url + i} onMouseEnter={() => haptic(3)}
                    className="group bg-white/60 border border-[#5A5A40]/20 rounded-3xl p-4 flex flex-col gap-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#5A5A40]/10 hover:bg-white hover:border-[#5A5A40]/40">
                    <div className="rounded-2xl overflow-hidden aspect-video bg-[#5A5A40]/5">
                      <img src={img.url} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-base font-serif text-[#414132]">{img.label}</div>
                        <div className="text-[10px] uppercase tracking-wider text-[#5A5A40]/50 font-bold">{imgFormat} image</div>
                      </div>
                      <button onClick={() => downloadImage(img)} onMouseEnter={() => haptic(4)}
                        className="bg-[#5A5A40] text-white p-2.5 rounded-full hover:bg-[#4A4A35] active:scale-95 transition-all">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {(videoInfo.images || []).length === 0 && (
                  <div className="col-span-full text-center text-[#5A5A40]/50 py-8 text-sm">No thumbnail images found.</div>
                )}
              </div>
            </div>
          )}

          {mode !== 'image' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((format, index) => (
              <div key={format.id} onMouseEnter={() => haptic(3)}
                className="group bg-white/60 border border-[#5A5A40]/20 rounded-3xl p-6 flex flex-col gap-4 relative overflow-hidden shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#5A5A40]/10 hover:bg-white hover:border-[#5A5A40]/40">
                {format.note && (
                  <div className="absolute top-0 right-0 bg-[#5A5A40] text-white text-[8px] px-3 py-1 rounded-bl-xl font-bold uppercase tracking-wider">{format.note}</div>
                )}
                <span className="text-[10px] uppercase tracking-tighter font-bold text-[#5A5A40]/50 flex items-center gap-1">
                  {mode === 'video' ? <FileVideo className="w-3 h-3" /> : <FileAudio className="w-3 h-3" />}
                  {mode === 'video' ? 'Video' : 'Audio'} Option
                </span>
                <div>
                  <div className="text-2xl font-serif text-[#414132] flex items-baseline gap-2">
                    {format.label}
                    {mode === 'audio' && format.bitrate ? <span className="text-xs font-sans text-[#5A5A40]/50">{format.bitrate} kbps</span> : null}
                  </div>
                  <div className="text-xs text-[#5A5A40]/60">
                    {format.ext.toUpperCase()}{format.sizeText ? ` · ${format.sizeText}` : ' · size on download'}
                  </div>
                </div>

                {downloadingId === format.id ? (
                  preparing ? (
                    <div className="mt-auto flex flex-col gap-2">
                      <div className="h-2 w-full bg-[#5A5A40]/10 rounded-full overflow-hidden">
                        <div className="h-full w-1/3 bg-[#5A5A40] rounded-full animate-[slide_1.1s_ease-in-out_infinite]" />
                      </div>
                      <span className="text-[11px] font-medium text-[#5A5A40]/70 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {isAudioConvert(format) ? 'Converting to MP3…' : 'Preparing your file…'}
                      </span>
                    </div>
                  ) : (
                    <ProgressBar progress={downloadProgress} label={downloadSizeLabel} />
                  )
                ) : (
                  <button onClick={() => startDownload(format)} disabled={downloadingId !== null} onMouseEnter={() => haptic(4)}
                    className={`mt-auto py-2.5 rounded-full text-xs font-bold transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 ${index === 0 ? 'bg-[#5A5A40] text-white hover:bg-[#4A4A35]' : 'border border-[#5A5A40]/30 text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white'}`}>
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                )}
              </div>
            ))}
            {list.length === 0 && (
              <div className="col-span-full text-center text-[#5A5A40]/50 py-8 text-sm">No {mode} formats found for this link.</div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
