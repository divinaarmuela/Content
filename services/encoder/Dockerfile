# The encoder: Node 22 plus the one binary this whole service exists for.
#
# `ffmpeg` from Debian's own archive rather than a static build, because it
# comes with ffprobe, libx264 and the fdk-free AAC encoder already wired
# together, and it is patched by somebody other than us.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# dependencies first, so a source change does not re-install them
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# the build tools are not wanted in the running image
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tini-free: node is PID 1 and handles SIGTERM itself (see server.ts), which
# is what lets an in-flight encode finish its callback when Fly stops the
# machine
CMD ["node", "dist/server.js"]
