#!/bin/bash
# Permanent public link on YOUR home IP → YouTube works 100%.
# One-time setup (see the printed steps), then just run:  bash start-permanent.sh
cd "$(dirname "$0")"

# Your free static ngrok domain (e.g. cheetah-bold.ngrok-free.app).
# Pass it as an argument, or set NGROK_DOMAIN, or put it in a file `ngrok-domain.txt`.
DOMAIN="${1:-$NGROK_DOMAIN}"
[ -z "$DOMAIN" ] && [ -f ngrok-domain.txt ] && DOMAIN="$(tr -d ' \n' < ngrok-domain.txt)"

if [ -z "$DOMAIN" ]; then
  cat <<'EOF'
────────────────────────────────────────────────────────────
  One-time setup (free, ~3 min):
  1. Sign up:      https://dashboard.ngrok.com/signup
  2. Authtoken:    https://dashboard.ngrok.com/get-started/your-authtoken
                   then run:  ./bin/ngrok config add-authtoken <YOUR_TOKEN>
  3. Free domain:  https://dashboard.ngrok.com/domains  → "New Domain"
                   copy it (e.g. cheetah-bold.ngrok-free.app)

  Then run:        bash start-permanent.sh cheetah-bold.ngrok-free.app
  (or save the domain once:  echo "cheetah-bold.ngrok-free.app" > ngrok-domain.txt)
────────────────────────────────────────────────────────────
EOF
  exit 1
fi

# 1) Start the app if it isn't already up
if ! curl -s -o /dev/null http://localhost:3000/ 2>/dev/null; then
  echo "▶ Starting server…"
  npm run dev >/tmp/streamgarden-server.log 2>&1 &
  for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ 2>/dev/null && break; sleep 1; done
fi
echo "✅ Server up on http://localhost:3000"

# 2) Keep the Mac awake while this runs (so the link stays alive)
caffeinate -dimsu -w $$ &

# 3) Open the PERMANENT public link on your home IP
echo "🌐 Permanent link:  https://$DOMAIN"
echo "   Open it on any device. Keep this window open. Ctrl+C to stop."
exec ./bin/ngrok http --domain="$DOMAIN" 3000
