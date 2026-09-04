# The encoder

A small machine that makes a **publish-grade copy** of a video that is too big
for a channel.

## Why it exists

A 2 GB master is right for YouTube and TikTok and too big for Instagram
(300 MB). Until now the app substituted Cloudflare Stream's web-player MP4 —
about 0.85 Mbps on a long clip. The platform then re-compressed *that*, and
the client saw the loss on their own footage.

This service makes the copy instead: 1080p H.264 High@4.1, CRF 20 with an
8–12 Mbps ceiling depending on the channel, AAC 160k, `+faststart`, BT.709,
constant frame rate. That is what a platform's own encoder expects to be
handed, so what the audience sees is one re-encode, not two.

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
  "sourceUrl": "https://media.example.com/master.mp4",
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
never simply goes quiet — "no answer" is the one outcome the app cannot act on.

### Limits, deliberately

- **One encode at a time**, at most **two waiting**. A third caller gets
  `503 {"error":"busy"}`; Fly starts another machine or the app asks again.
  ffmpeg uses every core it is given, so two encodes on two shared CPUs go
  half as fast each and double the peak memory on a 2 GB box.
- **Source download: 10 minutes. Encode: 45 minutes.** Past either, the job
  reports a failure rather than holding the machine.
- **Temp files are removed on every exit path**, success or failure. A 2 GB
  master plus its copy is most of the disk.
- The queue is **in memory** on purpose. A machine that dies loses its queue,
  and the app owns the job rows and will ask again.

## Deploy

From `services/encoder`, with the Fly CLI installed and `fly auth login` done.

```bash
# 1. create the app (answers: no Postgres, no Redis, do NOT deploy yet)
fly launch --no-deploy --copy-config --name mdm-encoder --region syd

# 2. the two secrets. Generate them first and keep them —
#    the SAME values go into Vercel as ENCODER_TOKEN / ENCODER_CALLBACK_SECRET
openssl rand -hex 32   # -> the token
openssl rand -hex 32   # -> the callback secret

fly secrets set \
  ENCODER_TOKEN=<the token> \
  ENCODER_CALLBACK_SECRET=<the callback secret>

# 3. ship it
fly deploy

# 4. what URL did it get?
fly status        # -> https://mdm-encoder.fly.dev
```

Then, in **Vercel → Settings → Environment Variables** (production *and*
preview):

| variable | value |
|---|---|
| `ENCODER_URL` | `https://mdm-encoder.fly.dev` |
| `ENCODER_TOKEN` | the token from step 2 |
| `ENCODER_CALLBACK_SECRET` | the callback secret from step 2 |

Until `ENCODER_URL` is set the app behaves exactly as it did before this
service existed: it falls back to Cloudflare Stream's copy and says so.

## Smoke test, after deploying

```bash
# health — no auth
curl -s https://mdm-encoder.fly.dev/health
# {"ok":true,"jobs":0,"configured":true}

# the wrong token must be refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Authorization: Bearer nope' https://mdm-encoder.fly.dev/encode
# 401
```

A real 20-second clip end to end needs a presigned R2 PUT and somewhere to
receive the callback. The quickest honest version:

```bash
# a throwaway callback receiver
CB=$(curl -s https://webhook.site/token | python -c 'import sys,json;print("https://webhook.site/"+json.load(sys.stdin)["uuid"])')

# a presigned upload URL for a test key (run in the app repo)
node -e "
  const { signUpload } = require('./app/lib/storage')
  signUpload('zz-test-encode.mp4','video/mp4').then(u => console.log(u.signedUrl))
"

curl -sS -X POST https://mdm-encoder.fly.dev/encode \
  -H "Authorization: Bearer $ENCODER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{
    \"jobId\": \"smoke-$(date +%s)\",
    \"sourceUrl\": \"<a 20-second https mp4>\",
    \"uploadUrl\": \"<the presigned PUT from above>\",
    \"callbackUrl\": \"$CB\",
    \"target\": { \"platform\": \"instagram\", \"maxMB\": 300, \"maxSeconds\": 90,
      \"maxrateKbps\": 10000, \"bufsizeKbps\": 20000, \"audioKbps\": 160,
      \"longSide\": 1920, \"shortSide\": 1080, \"maxFps\": 30 }
  }"
# {"accepted":true,...}

fly logs   # [encode smoke-…] downloaded / probed / encoded / uploaded / reported
```

What to check on the callback body: `ok: true`, `width`/`height` are the
1080p shape of the source, and `videoKbps` is in the thousands — not the
hundreds. A `videoKbps` under 1500 on a 20-second clip means the ladder was
not applied and this whole service bought nothing.

## Locally

```bash
npm install
npm test          # the ladder, which is the only part that decides anything
npm run typecheck
ENCODER_TOKEN=dev ENCODER_CALLBACK_SECRET=dev npm run dev   # needs ffmpeg on PATH
```

`npm test` never touches the network or ffmpeg: the tests are of
`src/ladder.ts`, the pure module every argument comes out of.
