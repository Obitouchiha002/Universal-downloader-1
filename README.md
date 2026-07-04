<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e8c9a954-6508-41ea-a9dc-a6c233442dfc

## Run Locally

**Prerequisites:**  Node.js (no API key required)

1. Install dependencies (this also runs `scripts/setup.mjs` automatically):
   `npm install`
   Setup downloads a small portable Python + the `yt-dlp` binary into `bin/`.
   To run it again manually: `npm run setup`
2. Run the app:
   `npm run dev`
3. Open http://localhost:3000

### How it works
Downloads are powered by `yt-dlp` + `ffmpeg` (bundled via `ffmpeg-static`). yt-dlp
fetches the best video and audio streams and ffmpeg merges them into a single MP4 —
this is why video links download **video + audio**, not audio only.

**Why the portable Python?** On macOS the standalone (PyInstaller) `yt-dlp` binary
re-extracts and gets re-scanned by the OS on every launch (~19s per call). Running
the yt-dlp *zipapp* under a bundled CPython starts in ~0.6s instead, so both
"Analyze" and downloads are fast. The server prefers the portable Python and falls
back to the standalone binary if it isn't present.

### Works with 1700+ sites
YouTube, Instagram, TikTok, X/Twitter, Facebook, Vimeo, Reddit, SoundCloud, and
more (anything yt-dlp supports). Public content works out of the box.

### Instagram / Facebook / private content (login cookies)
These sites **block anonymous downloads** — they need your logged-in session. Enable
it once:

1. Log in to the site (e.g. Instagram) in a browser, e.g. **Chrome**.
2. In `.env` set: `COOKIES_FROM_BROWSER="chrome"` (or `safari`, `brave`, `edge`, `firefox`).
3. Restart `npm run dev`. Console shows `Login cookies: browser:chrome`.
   - macOS may pop a Keychain prompt the first time — click **Allow**.

Cookies are only used for non-YouTube sites (YouTube actually works better without
them). Alternatively export a `cookies.txt` and set `COOKIES_FILE`, or drop
`cookies.txt` in the project root.

### AI Smart Paste (optional)
**Downloading needs no API key.** But if you add a Groq and/or Gemini key, the
search box also accepts messy text or even a song name — the AI resolves it to the
right link or best search result.

1. Copy `.env.example` to `.env`
2. Add `GROQ_API_KEY` (https://console.groq.com/keys) and/or `GEMINI_API_KEY`
   (https://aistudio.google.com/apikey). Groq is tried first (fastest), then Gemini.
3. Restart `npm run dev` — you'll see `AI smart-paste: ON` in the console.
