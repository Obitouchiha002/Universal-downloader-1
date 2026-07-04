# Cloud/Docker image for the Universal Video Downloader.
# yt-dlp comes from pip; ffmpeg comes from the ffmpeg-static npm package.
FROM node:20-bookworm-slim

# System deps: Python + pip so we can install yt-dlp onto PATH.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Our postinstall downloads a portable Python for local (macOS) use — not needed
# here because yt-dlp is already on PATH via pip. (ffmpeg-static still downloads.)
ENV SKIP_YTDLP_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Cloud hosts inject $PORT; the server already reads it.
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
