# The encoder: Node 22 plus the one binary this whole service exists for.
#
# `ffmpeg` from Debian's own archive rather than a static build, because it
# comes with ffprobe, libx264 and libzimg (`zscale`) already wired together,
# and it is patched by somebody other than us. `zscale` is not optional here:
# it is what converts an HLG or HDR10 master DOWN to BT.709 instead of merely
# labelling it 709, and a build without it would ship washed-out footage.
#
# Pinned to a patch version rather than a floating `22-slim`, so a rebuild in
# six months is the image that was tested. To pin harder still, resolve the
# digest once and paste it here:
#   docker pull node:22.20.0-bookworm-slim
#   docker inspect --format='{{index .RepoDigests 0}}' node:22.20.0-bookworm-slim
#   FROM node@sha256:<the digest>
FROM node:22.20.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Fail the BUILD, not a client's post, if this ffmpeg cannot tone-map.
# Recorded in the build log too, so the README's "which ffmpeg is this?" has an
# answer that came from the image rather than from somebody's memory.
RUN ffmpeg -version | head -n 1 \
  && (ffmpeg -hide_banner -filters | grep -q ' zscale ' \
      || (echo 'FATAL: this ffmpeg has no zscale filter; HDR masters could not be converted' && exit 1))

WORKDIR /app

# dependencies first, so a source change does not re-install them.
# `npm ci` — the lockfile exactly, never a resolved-afresh tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# the build tools are not wanted in the running image
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tini-free: node is PID 1 and handles SIGTERM itself (see server.ts), which
# is what lets an in-flight encode finish and report before the machine stops.
CMD ["node", "dist/server.js"]
