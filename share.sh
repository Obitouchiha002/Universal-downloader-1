#!/bin/bash
# Start the app AND a public Cloudflare tunnel in one go.
# Gives you an HTTPS link that works on ANY device, with YouTube working 100%
# because it runs on your home IP. Keep this terminal open while using the link.
cd "$(dirname "$0")"

# 1) Start the server if it isn't already running on :3000
if ! curl -s -o /dev/null http://localhost:3000/ 2>/dev/null; then
  echo "▶ Starting server…"
  npm run dev >/tmp/streamgarden-server.log 2>&1 &
  for i in $(seq 1 30); do
    curl -s -o /dev/null http://localhost:3000/ 2>/dev/null && break
    sleep 1
  done
fi
echo "✅ Server running on http://localhost:3000"

# 2) Download cloudflared on first run if missing
if [ ! -x ./bin/cloudflared ]; then
  echo "▶ Downloading cloudflared…"
  mkdir -p bin
  ARCH=$(uname -m); FILE="cloudflared-darwin-amd64.tgz"
  [ "$ARCH" = "arm64" ] && FILE="cloudflared-darwin-arm64.tgz"
  curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/$FILE" -o /tmp/cf.tgz
  tar -xzf /tmp/cf.tgz -C bin && chmod +x bin/cloudflared
fi

# 3) Open the public tunnel (URL is printed below in a box)
echo "▶ Opening public link… (share the https://…trycloudflare.com URL shown below)"
echo "   Keep this window open. Press Ctrl+C to stop."
exec ./bin/cloudflared tunnel --url http://localhost:3000
