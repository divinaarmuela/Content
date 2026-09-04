# The encoder

A small machine that makes a **publish-grade copy** of a video that is too big
for a channel.

## Why it exists

A 2 GB master is right for YouTube and TikTok and too big for Instagram
(300 MB). Until now the app substituted Cloudflare Stream's web-player MP4 —
about 0.85 Mbps on a long clip. The platform then re-compressed *that*, and the
client saw the loss on their own footage.

This service makes the copy instead: 1080p H.264 High@4.1, CRF 20 with an
8–12 Mbps ceiling depending on the channel, AAC 160k, `+faststart`, BT.709,
constant frame rate. That is what a platform's own encoder expects to be
handed, so what the audience sees is one re-encode, not two.

An HLG or HDR10 master (the default on a recent iPhone, and this agency shoots
on phones) is **converted** to BT.709 with a Hable tone map, not merely tagged
as 709 — tagging alone is what makes footage come out grey and desaturated.
If the ffmpeg in the image cannot tone-map, the job fails in plain words rather
than shipping a washed-out copy; the Docker build checks for `zscale` and
fails if it is missing, so that should never happen in the deployed image.

## What it is

Two routes and a queue.

| | |
|---|---|
| `GET /health` | Fly's check. No auth, no secrets in the answer. |
| `POST /encode` | One job. Answers `202` at once and reports later. |

`POST /encode` needs `Authorization: Bearer $ENCODER_TOKEN` and a body of:

```json
{
  "jobId": "8f0c…",
  "sourceUrl": "https://media.mdmmarketing.com.au/master.mp4",
  "uploadUrl": "https://…r2.cloudflarestorage.com/…?X-Amz-Signature=…",
  "callbackUrl": "https://app.mdmmarketing.com.au/api/media/encode/callback",
  "target": {
    "platform": "instagram",
    "maxMB": 300,
    "maxSeconds": 90,
    "maxrateKbps": 10000,
    "bufsizeKbps": 20000,
    "audioKbps": 160,
    "longSide": 1920,
    "shortSide": 1080,
    "maxFps": 30
  }
}
```

`uploadUrl` is a presigned R2 **PUT**, signed for `video/mp4`. The service
streams the source down, encodes, PUTs the copy there, and then POSTs to
`callbackUrl`:

```json
{ "jobId": "8f0c…", "ok": true, "bytes": 24917504, "durationSec": 19.98,
  "width": 1080, "height": 1920, "videoKbps": 9820 }
```

…signed with an HMAC of `${unixSeconds}.${body}` under
`$ENCODER_CALLBACK_SECRET`, in an `x-encoder-signature: t=…,v1=…` header. The
app verifies that before it believes a word of it (`app/api/media/encode/callback`).

A failed job reports `ok: false` and an `error` in plain words. The service
never simply goes quiet — "no answer" is the one outcome the app cannot act on
— and if it does go quiet anyway, the app's 15-minute sweep settles the row.

### Limits, deliberately

- **One encode at a time**, at most **two waiting**. A third caller gets
  `503 {"error":"busy"}`; the app asks again. `has()` covers the job being
  encoded right now as well as the waiting ones, so a re-POST of a job in
  flight is answered `202 already queued` rather than encoding it twice.
- **Source download: 10 minutes. Encode: 45 minutes.** Past either, the job
  reports a failure rather than holding the machine.
- **Temp files are removed on every exit path**, success or failure. A 2 GB
  master plus its copy is most of the disk.
- **The source host is pinned** to `ENCODER_SOURCE_HOSTS` when it is set, so a
  request that got past the bearer token still cannot make this machine fetch
  Fly's internal network or a metadata endpoint. Unset, it falls back to
  refusing private, loopback and link-local addresses — `/health` reports
  `sourceHostsPinned` so you can tell which you are running.
- The queue is **in memory** on purpose. A machine that dies loses its queue,
  and the app owns the job rows and will ask again.

### How this machine scales to zero

**`auto_stop_machines` is `"off"` on purpose.** Fly Proxy decides a machine is
idle from *in-flight requests*, and this service deliberately has none: the
POST returns in milliseconds and then ffmpeg runs for two to forty-five minutes
with no open connection. With auto-stop on, Fly's idle sweep stops the machine
**in the middle of an encode** — no callback, no error, and a client's post
waiting forever.

So the machine stops itself: `src/server.ts` exits cleanly once the queue has
been empty for five minutes, and never while a job is running.
`auto_start_machines = true` brings it back on the next request and
`min_machines_running = 0` means nothing is paid for in between. A SIGTERM
from outside (a deploy, a host event) waits for the running encode rather than
killing it.

## Deploy

From `services/encoder`, with the Fly CLI installed and `fly auth login` done.

**Do not run `fly launch`** — it regenerates `fly.toml` from its own detection
and will rewrite the `[[vm]]`, concurrency and `auto_stop_machines` settings
that were chosen deliberately.

```bash
# 1. create the app, leaving fly.toml alone
fly apps create mdm-encoder

# 2. the secrets. Generate them first and keep them —
#    the SAME values go into Vercel as ENCODER_TOKEN / ENCODER_CALLBACK_SECRET
openssl rand -hex 32   # -> the token
openssl rand -hex 32   # -> the callback secret

fly secrets set \
  ENCODER_TOKEN=<the token> \
  ENCODER_CALLBACK_SECRET=<the callback secret> \
  ENCODER_SOURCE_HOSTS=media.mdmmarketing.com.au \
  --app mdm-encoder
#   ^ the host of R2_PUBLIC_BASE_URL, so this machine will fetch nothing else

# 3. ship it
fly deploy --app mdm-encoder

# 4. what URL did it get?
fly status --app mdm-encoder     # -> https://mdm-encoder.fly.dev
```

**Record which ffmpeg you got.** The build log prints it (the Dockerfile runs
`ffmpeg -version` and checks for `zscale`); paste the first line here so a
future rebuild can be compared against it:

```
ffmpeg version <fill in from the build log>   # Debian bookworm, with libzimg
```

Then, in **Vercel → Settings → Environment Variables** (production *and*
preview):

| variable | value |
|---|---|
| `ENCODER_URL` | `https://mdm-encoder.fly.dev` |
| `ENCODER_TOKEN` | the token from step 2 |
| `ENCODER_CALLBACK_SECRET` | the callback secret from step 2 |

Redeploy the app after setting them — Vercel env changes need a new deployment.

Until `ENCODER_URL` is set the app behaves exactly as it did before this
service existed: it falls back to Cloudflare Stream's copy and says so.

### Re-sync Inngest — not optional

`media/encode`, `media/encode.finished` and the stale sweep are **new**
functions, and a new Inngest function does nothing until the app is re-synced
(CLAUDE.md trap 5b): `inngest.send()` for an unregistered event succeeds and is
then dropped — no run, no error, nothing in the dashboard.

```bash
curl -X PUT https://app.mdmmarketing.com.au/api/inngest
# {"modified":true}   <- it registered something new
```

Then confirm **Make a publish-grade copy**, **Release posts waiting on a copy**
and **Settle stale copies** all appear in the Inngest dashboard.

## Smoke test, after deploying

```bash
# health — no auth
curl -s https://mdm-encoder.fly.dev/health
# {"ok":true,"jobs":0,"configured":true,"sourceHostsPinned":true}

# the wrong token must be refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Authorization: Bearer nope' https://mdm-encoder.fly.dev/encode
# 401
```

### The one that matters: a clip over five minutes

A twenty-second clip finishes inside a minute and proves nothing about the
machine staying alive through a real encode. **Use a clip over five minutes
long** — long enough that an idle-shutdown bug would show.

Presign an upload for it. `app/lib/storage.ts` is ESM TypeScript importing
`server-only`, so plain `node -e "require(...)"` cannot load it; run it through
`tsx` from the **app** root with the R2 variables in the environment:

```bash
# in the app root, with R2_* set (e.g. `vercel env pull .env.local` first)
npx tsx -e "
  process.env.NODE_ENV='development';
  const { signUpload } = await import('./app/lib/storage.ts');
  const u = await signUpload('smoke-encode.mp4', 'video/mp4', { expiresIn: 21600 });
  console.log(JSON.stringify(u, null, 2));
"
```

(`server-only` throws outside a server context; if it does, the quickest
alternative is to run the same two lines inside `npx vitest run` with the
repo's `server-only` stub alias, or to take a presigned URL out of the app's
own upload route with the browser's network tab open.)

Somewhere to receive the callback — any request bin will do; the app will
refuse an unsigned one, and a bin will not:

```bash
CB=https://webhook.site/<your uuid>

curl -sS -X POST https://mdm-encoder.fly.dev/encode \
  -H "Authorization: Bearer $ENCODER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{
    \"jobId\": \"smoke-$(date +%s)\",
    \"sourceUrl\": \"<an https mp4 over five minutes long, on your R2 host>\",
    \"uploadUrl\": \"<the signedUrl from above>\",
    \"callbackUrl\": \"$CB\",
    \"target\": { \"platform\": \"instagram\", \"maxMB\": 300, \"maxSeconds\": 330,
      \"maxrateKbps\": 6000, \"bufsizeKbps\": 12000, \"audioKbps\": 160,
      \"longSide\": 1920, \"shortSide\": 1080, \"maxFps\": 30 }
  }"
# {"accepted":true,...}
```

Then watch, and **do not stop watching until `reported`**:

```bash
fly logs --app mdm-encoder
```

Want, in this order, all with the same jobId:

```
[encode smoke-…] accepted   {"platform":"instagram",...}
[encode smoke-…] downloaded {"bytes":…}
[encode smoke-…] probed     {"width":…,"height":…,"fps":…}
[encode smoke-…] encoded    {"bytes":…,"width":1080,"height":1920,"videoKbps":…}
[encode smoke-…] uploaded   {"bytes":…}
[encode smoke-…] reported   {"ok":true}
```

Watch for:

- **the log stopping after `downloaded` or `probed`, with `fly status` showing
  `stopped`** — the machine was stopped mid-encode. Check `auto_stop_machines`
  is `"off"` in the deployed config (`fly config show --app mdm-encoder`).
- **`tone mapping {"from":"HLG"}`** on a phone-shot clip — that is the HDR
  conversion doing its job. `cannot tone-map` means the image lost `zscale`.
- **`videoKbps` in the thousands, not the hundreds.** Under 1500 on a short
  clip means the ladder was not applied and this whole service bought nothing.
- roughly five minutes of idle after the job, then the machine exiting by
  itself — that is the scale-to-zero working.

## Locally

```bash
npm install
npm test          # the ladder, the request rules, and the queue
npm run typecheck
ENCODER_TOKEN=dev ENCODER_CALLBACK_SECRET=dev npm run dev   # needs ffmpeg on PATH
```

`npm test` never touches the network or ffmpeg: the tests are of `src/ladder.ts`,
`src/request.ts` and `src/queue.ts` — the three modules that decide anything.
