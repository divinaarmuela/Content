# Publish-grade video copies — ffmpeg encoder service (design)

**Date:** 3 September 2026 · **Status:** approved by the owner ("okay ffmpeg") · **Runs after:** the Social Schedule page.

## Problem
Masters over a channel's limit (about 300 MB) are replaced by Cloudflare Stream's web-player MP4 (~0.85 Mbps on long clips), then re-compressed by the platform → visible quality loss. Research: `.superpowers/sdd/2026-09-03-dashboard-look/bitrate-research.md`.

## Design
- **Service**: one small Fly.io machine (2 shared CPUs, 2 GB, scale-to-zero) running a tiny Node HTTP app + ffmpeg. `POST /encode { sourceUrl, target: { platform, kind }, callbackUrl, jobId }` → downloads from R2, encodes with the ladder below, uploads the copy to R2 (`copies/<jobId>/<platform>.mp4`), POSTs the result (size, duration, bitrate, dimensions) to the callback. Auth: a shared secret header. Idempotent on `jobId`.
- **Ladder** (`PLATFORM_ENCODE` in `app/lib/media-fit-core.ts` next to `PLATFORM_MEDIA`): container mp4, H.264 High@4.1 (HEVC never), 1080p on the long side (9:16 → 1080×1920, 1:1 → 1080×1080, 16:9 → 1920×1080), CFR at source fps capped 30 (60 kept only where the platform allows), CRF 20 with `-maxrate` per platform (Instagram/Facebook 10M, TikTok 12M, LinkedIn 10M, X 8M, YouTube Shorts 12M) and `-bufsize` = 2× maxrate, AAC 160k stereo 48 kHz, `-movflags +faststart`, BT.709 tags, keyframe every 2 s. Property test: `maxrate × maxSeconds / 8 < maxMB` for every platform/kind.
- **Pipeline change**: `smallerCopyOf()` (`app/lib/stream.ts`) asks the encoder instead of Stream; the Inngest function `media/encode` polls or receives the callback, writes the copy URL where the shrink step wrote it, and the publish job proceeds. Stream previews are untouched (they are still the player). Failure → the row shows "Could not prepare a copy — try a smaller export" and the master is never sent when it exceeds the limit.
- **Editors' guidance** on the upload zone: "Export 1080p H.264 at 10–12 Mbps; a 90-second reel is about 120 MB and posts as-is."
- **Cost**: ~$5–10/month; encoding time ≈ 1–1.5× realtime.

## Tests
Ladder property test; `smallerCopyOf` unit test with a stubbed encoder; one live encode of a 20-second ZZ TEST clip end to end (size and bitrate asserted), cleaned up.
