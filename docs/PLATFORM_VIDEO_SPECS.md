# Platform video specifications — read, not remembered

What each channel's OWN documentation says about the video we hand it, set
against what `PLATFORM_ENCODE` in `app/lib/media-fit-core.ts` actually does.

Every row below was read from the source named in it on **8 September 2026**.
Where a row says *not published*, that means the platform's own docs do not
state it — not that a blog said something. A number nobody read is a number
nobody should encode against; those rows stay at the conservative default
until somebody reads them.

This file exists for the same reason `ZERNIO_POSTING_OPTIONS.md` does: so the
next person does not re-derive it, and so a changed platform limit is a diff
rather than an argument.

## What our ladder does today

`PLATFORM_ENCODE` sets, per channel: a bitrate ceiling, an audio bitrate, the
output size, and a frame-rate cap. The bitrate is a CEILING, not a target —
the encoder runs `-crf 20`, so an easy clip spends far less.

| Channel | fps cap | bitrate ceiling | audio | output size |
|---|---|---|---|---|
| instagram | **60** | 10 Mbps | 160 kbps | 1920×1080 |
| youtube | 60 | 12 Mbps | 160 kbps | 1920×1080 |
| facebook | **60** | 10 Mbps | 160 kbps | 1920×1080 |
| tiktok | **60** | 12 Mbps | 160 kbps | 1920×1080 |
| threads | **60** | 8 Mbps | 160 kbps | 1920×1080 |
| linkedin | 30 | 10 Mbps | 160 kbps | 1920×1080 |
| twitter | 30 | 8 Mbps | 160 kbps | 1920×1080 |
| pinterest | 30 | 8 Mbps | 160 kbps | 1920×1080 |
| bluesky | 30 | 8 Mbps | 160 kbps | 1920×1080 |
| reddit | 30 | 8 Mbps | 160 kbps | 1920×1080 |

## What the platforms document

### Instagram — VERIFIED
Meta, Instagram Platform → Media reference.

- Frame rate: **23–60 FPS**
- File size: **300 MB maximum** (Reels)
- Duration: 3 s – 15 min
- Resolution: maximum 1920 horizontal pixels
- Video: HEVC or H264, progressive, closed GOP, 4:2:0
- Audio: AAC, 48 kHz maximum, 1–2 channels

**Ours matches.** The fps cap was 30 until 8 Sep 2026 on the untested belief
that "the platform would do that anyway"; it is now 60. A 1080p50 master was
being flattened to 30 for no reason — measured on a real post (C0584.MP4).

### Facebook Reels — VERIFIED
Meta, Video API → Reels publishing.

- Frame rate: **"24 to 60 frames per second"**
- Duration: 3–90 s
- Resolution: minimum 540×960, recommended 1080×1920
- Video: H.264 / H.265 (VP9, AV1 also accepted)
- Audio: AAC-LC, 128 kbps or higher
- File size: not stated on that page

**Now matches.** Raised 30 → 60 on 8 Sep 2026.

### Threads — VERIFIED
Meta, Threads → Posts.

- Frame rate: **23–60 FPS**
- File size: **1 GB maximum**
- Duration: ≤ 300 s
- Resolution: maximum 1920 horizontal pixels
- Bitrate: video VBR, 100 Mbps maximum; audio 128 kbps

**Now matches.** Raised 30 → 60 on 8 Sep 2026.

On the audio line: Threads states a flat "Audio Bitrate: 128 kbps" with no
qualifier, which read alone could be a ceiling. Facebook Reels settles it —
that page says "128 kbps or higher". 128 is the standard Meta publishes, not
a limit, so our 160 stays.

### YouTube — VERIFIED
Google, "Recommended upload encoding settings".

- Frame rate: match the source. 24, 25, 30, 48, 50, 60 are all named.
- 1080p SDR: **8 Mbps** standard frame rate, **12 Mbps** high frame rate
- 1080p HDR: 10 Mbps SFR, 15 Mbps HFR
- Container MP4, moov at the front (fast start)
- Video H.264 High Profile, closed GOP, CABAC, 4:2:0
- Audio AAC-LC or Opus, 48 kHz

**Ours matches.** 60 fps, 12 Mbps ceiling — exactly their high-frame-rate
1080p number.

### LinkedIn — PARTLY VERIFIED
Microsoft Learn, LinkedIn Videos API.

- File size: **75 KB – 500 MB** in the stated specification. The API's own
  `fileSizeBytes` field says "Maximum allowed Videos size is 5GB" — the two
  do not agree, and 500 MB is the safe one to build against.
- Duration: **3 s – 30 min**
- Format: MP4
- Frame rate: **not published**

One useful observation from their own API responses: the playback URL
LinkedIn returns is shaped `mp4-720p-30fp-crf28`. LinkedIn re-encodes to
720p30 regardless of what is sent. **So 30 fps here is right**, and sending
60 would only be thrown away.

### TikTok — VERIFIED
TikTok, Content Posting API → Media Transfer Guide. (The Upload reference
page carries none of this; the Media Transfer Guide is the one to read.)

- Frame rate: **"Minimum of 23 FPS"**, **"Maximum of 60 FPS"**
- File size: **4 GB maximum**
- Duration: developers may send up to **10 minutes**; creators' own accounts
  allow 3, 5 or 10 minutes and TikTok trims to the account's limit
- Format: MP4 + H.264

**Now matches**, and the duration disagreement reported earlier was mine, not
theirs — read off the wrong page. `maxMB: 4096` and `maxSeconds: 10 * 60` are
both right.

### X / Twitter — NOT VERIFIED
X Developer Platform. The specification pages returned 402/404 to an
unauthenticated fetch on 8 Sep 2026.

- Recommended resolution: 1280×720 / 720×1280 / 720×720. 1080p playback is
  for subscribed accounts only.
- Audio: AAC Low Complexity
- Promoted video: up to 10 min, 500 MB
- Frame rate: **not read**

**Leave at 30.** Note the 720p recommendation — our 1080p output may be
downscaled by X for non-subscribers regardless.

### Pinterest, Bluesky, Reddit — NOT VERIFIED
Official specification pages were not reachable on 8 Sep 2026 (404s and
redirects). None of the three has been read. **All stay at 30 fps.**

## Settled on 8 September 2026

- Instagram, Facebook, Threads and TikTok raised 30 → 60 fps, each on its own
  documentation. YouTube was already 60.
- Audio stays at 160 kbps: Facebook Reels' "128 kbps or higher" shows Meta's
  128 is a standard, not a ceiling.
- TikTok's duration and size rules were already right; the mismatch reported
  earlier came from reading the wrong TikTok page.
- LinkedIn stays at 30 on evidence of its own re-encoding.

## Still open

1. **Read X, Pinterest, Bluesky and Reddit.** Four rows sit at 30 fps purely
   because nobody has read them. Their pages 402'd and 404'd unauthenticated
   on 8 Sep 2026 — they need a real look, not another search.
2. **X's 720p recommendation.** Their guidance names 1280×720 and says 1080p
   playback is for subscribed accounts. We send 1080p to everyone. Worth
   knowing whether that is downscaled on the way in.
