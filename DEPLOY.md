# Deploying to a public subdomain (for your portfolio)

This app runs a real server (yt-dlp + ffmpeg), so it **cannot** go on Vercel/Netlify
(serverless). Use a container host instead. **Render** has a genuinely free tier and
gives you a subdomain like `your-app.onrender.com`. Railway/Fly.io work the same way.

> ⚠️ Honest note: YouTube/Instagram often block **datacenter IPs** ("confirm you're
> not a bot"). On a cloud host some downloads may fail. Adding a `cookies.txt`
> (below) makes YouTube far more reliable. This is a limitation of every hosted
> downloader — locally (your own IP) it works best.

## 1. Push the code to GitHub

```bash
cd universal-video-downloader
git init
git add .
git commit -m "Universal video downloader"
gh repo create streamgarden --public --source=. --push
# (or create a repo on github.com and: git remote add origin <url> && git push -u origin main)
```

`.gitignore` already excludes `node_modules/`, `bin/`, `.env`, and `cookies.txt`,
so no secrets or big binaries get pushed.

## 2. Deploy on Render (Docker)

1. Go to https://render.com → sign in with GitHub.
2. **New +** → **Web Service** → pick your `streamgarden` repo.
3. Render auto-detects the `Dockerfile`. Settings:
   - **Instance type:** Free
   - **Environment variables** (Advanced → Add):
     - `GROQ_API_KEY` = your key (optional, for AI search)
     - `GEMINI_API_KEY` = your key (optional)
     - `COOKIES_FOR_YOUTUBE` = `1` (only if you add cookies in step 4)
4. **Create Web Service.** First build takes a few minutes.
5. You get a public URL: `https://streamgarden.onrender.com` — open it on any device,
   and install it as a PWA (Install App button / Add to Home Screen).

> Render's free tier sleeps after ~15 min idle; the first hit then takes ~30–60s to
> wake. Fine for a portfolio.

## 3. (Optional) Custom subdomain

If you own a domain: Render → your service → **Settings → Custom Domains** →
add `downloader.yourname.com`, then add the shown CNAME record at your DNS provider.

## 4. (Recommended) Make YouTube reliable with cookies

1. In your browser (logged into YouTube), install a "Get cookies.txt" extension and
   export cookies for `youtube.com` → save as `cookies.txt`.
2. In Render → your service → **Environment → Secret Files** → add a file named
   `cookies.txt` with that content (mount path `/app/cookies.txt`).
3. Set env `COOKIES_FOR_YOUTUBE=1`. Redeploy.

The server auto-detects `cookies.txt` in the project root and uses it.

## Want to use Vercel? (Hybrid: frontend on Vercel + backend on Render)

Vercel can't run the downloader (serverless timeouts + no long streaming), but it's
great for the **frontend**. Keep your Vercel workflow and put only the backend on Render.

1. Deploy the **backend** to Render (steps 1–2 above). Note its URL, e.g.
   `https://streamgarden.onrender.com`.
2. On **Vercel** → New Project → import the same GitHub repo.
   - Vercel reads `vercel.json` (builds `vite build` → `dist`).
   - **Environment Variables:**
     - `VITE_API_BASE` = `https://streamgarden.onrender.com`  (your Render URL)
     - `SKIP_YTDLP_DOWNLOAD` = `1`  (skips the local-only setup during Vercel's build)
   - Deploy → you get `https://streamgarden.vercel.app`.
3. (Recommended) On Render set `FRONTEND_ORIGIN` = `https://streamgarden.vercel.app`
   to lock CORS to your site.

Now the UI lives on Vercel (fast, your comfort zone) and calls the downloader on
Render. `VITE_API_BASE` is baked in at build time; the frontend uses same-origin when
it's empty (all-in-one mode), so nothing else changes.

## Alternatives
- **Railway** (railway.app): New Project → Deploy from GitHub → gives `*.up.railway.app`.
- **Fly.io**: `fly launch` (detects Dockerfile) → `*.fly.dev`.
- **Always-best option (personal use):** run locally on your Mac and expose it with a
  Cloudflare Tunnel / ngrok — that uses your home IP so YouTube/Instagram just work.
