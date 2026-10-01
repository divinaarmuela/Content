# Instagram direct (Meta) — setup

Branch `meta-instagram-login`, 1 October 2026. This is MD Media's own
connection to Instagram, through the Meta app **Social Scheduler** (App ID
`2142902776443404`) and its Instagram app **Social Scheduler-IG** (Instagram
app ID `843035665085991`). It uses "API setup with Instagram login".

**Today it is for testing only.** Posting, comments, DMs and automations all
still go through Zernio, and nothing in that flow has changed. The new code
can connect an account, keep its token fresh and store what Meta's webhook
sends. It does not post, reply or send messages, because nothing calls those
functions yet.

Until the env vars below are set, every new route answers **503** with the
reason, and the daily job does nothing.

---

## 1. Vercel: environment variables (Production)

| Name | Value |
|---|---|
| `META_IG_APP_SECRET` | The **Instagram app secret** from Meta → Social Scheduler → Instagram → API setup with Instagram login → step 3/4 ("Instagram app secret"). This is not the Facebook app secret. |
| `META_WEBHOOK_VERIFY_TOKEN` | Any long random string you make up, for example the output of `openssl rand -hex 24`. You paste the same string into Meta in step 3 below. |
| `META_IG_APP_ID` | *Optional.* Defaults to `843035665085991`. |
| `META_IG_REDIRECT_URI` | *Optional.* Defaults to `https://app.mdmmarketing.com.au/api/meta/instagram/callback`. |
| `META_IG_HUMAN_AGENT` | *Optional, leave unset.* `1` would let a future caller use the HUMAN_AGENT message tag. Nothing calls it today. |

`CREDENTIALS_KEY` must also be set. It should already be, because Google
Drive and Calendar use it. Tokens are stored encrypted with it, and if it is
missing the routes answer 503.

Redeploy after adding them.

## 2. Inngest: re-sync after the deploy (CLAUDE.md trap 5b)

This branch adds a new function, `meta-ig-token-refresh`, which runs daily at
04:15 Melbourne time. Inngest will not run it until the app has been re-synced:

```bash
curl -X PUT https://app.mdmmarketing.com.au/api/inngest   # {"modified":true} = registered
```

## 3. Meta dashboard → Instagram → API setup with Instagram login

**Step 3, "Configure webhooks":**

- Callback URL: `https://app.mdmmarketing.com.au/api/meta/webhook`
- Verify token: the same value as `META_WEBHOOK_VERIFY_TOKEN`
- Press **Verify and save**. The app answers the challenge only if the token matches.
- Subscribe to these fields: **comments**, **messages**, **mentions** (when
  listed), and **story_insights** (when listed). Only comments, messages
  and mentions are stored, in the `meta_ig_events` table. Every other field
  is logged in `webhook_deliveries` and then dropped. Nothing replies.

**Step 4, "Set up Instagram business login":**

- Redirect URL: `https://app.mdmmarketing.com.au/api/meta/instagram/callback`
  (paste it exactly: no trailing slash, https).

**Permissions** (the use case's list): `instagram_business_basic`,
`instagram_business_manage_comments`, `instagram_business_manage_messages`.
The connect also asks for `instagram_business_content_publish` and
`instagram_business_manage_insights`. Make sure both are added to the use
case, or Instagram's login screen will refuse them.

## 4. Meta dashboard → App roles → Roles → Instagram Testers

While the app is in Development mode, only Instagram accounts added as
testers can log in:

1. Add the **100M** Instagram account (the test client) as an **Instagram Tester**.
2. Sign in to that Instagram account. Go to Settings → Website permissions →
   Apps and websites → **Tester invites**, and accept.

Do not connect a real client's account. Test on 100M or MD Media only.

## 5. Try it

1. As a super admin, open Clients → 100M → Social. At the bottom is a card
   badged **Direct — testing**.
2. Press **Connect Instagram directly (Meta)**. Log in as the tester account
   and allow access.
3. You land back on the same page with "Instagram connected directly —
   @username". The card lists the account, when it was connected, and when
   its token expires (about 60 days).
4. Comment on one of 100M's posts. Within a minute a row should appear in
   `meta_ig_events` (kind `comments`) and in `webhook_deliveries` (provider
   `meta_ig`). Meta only delivers webhooks to an app in Development mode
   for its testers and roles, and the app must be subscribed in step 3.

None of this has been run against Meta yet. Everything in it was tested with
Meta mocked.

---

## Which files are the portable part (the owner: may be reused in unlk.ai)

These two files import nothing of MD Media's: no database, no auth, no
workflow, no UI, not even `server-only`. They use only `node:crypto` and the
global `fetch`, so they can be copied into another codebase unchanged.
`tests/meta-ig-middleware.test.ts` checks that they stay that way.

| File | What it is |
|---|---|
| `app/lib/meta-ig-core.ts` | Pure: env config in one function (`readMetaIgEnv`), URL and parameter builders, signing and verifying the OAuth `state`, the webhook signature and handshake, parsing Meta's answers, the refresh selection, publish container parameters, message bodies. |
| `app/lib/meta-ig-client.ts` | The Graph calls. Each takes the token (or the app config) as an argument and stores nothing: code exchange, long-lived token, refresh, `/me`, `publish` (IMAGE / REELS / STORIES / CAROUSEL, quota checked first), comments (list / reply / hide), private reply, send message, insights. |

The MD Media wiring, which another product would rewrite:

| File | What it is |
|---|---|
| `app/lib/meta-ig.ts` | The `meta_ig_accounts` / `meta_ig_events` tables, token encryption (`secret-box`), the refresh job's body, webhook record-keeping, and the `*For(igUserId)` wrappers that look up a stored token. |
| `app/api/meta/instagram/connect/route.ts` | Account manager or super admin. Redirects to Instagram with a signed state. |
| `app/api/meta/instagram/callback/route.ts` | Public. Its only authority is the signed state. |
| `app/api/meta/instagram/accounts/route.ts` | Super admin. Lists a client's direct connections, without the token. |
| `app/api/meta/webhook/route.ts` | Public. Its only authority is the signature. |
| `app/inngest/functions.ts` → `metaIgTokenRefresh` | The daily refresh job. |
| `app/dashboard/clients/MetaDirectInstagram.tsx` | The "Direct — testing" card, shown to super admins only. |
| `scripts/gen-db-types.mjs` | Ghost tables `meta_ig_accounts`, `meta_ig_events`. |
| `middleware.ts` | `/connect` and `/accounts` are gated. `/callback` and `/webhook` are public. |

## Notes

- `meta_ig_accounts.access_token_encrypted` is AES-GCM ciphertext. It is
  encrypted because the database rules are open-read. The token is never
  sent to a browser, never logged, and never put in a redirect.
- Tokens: the long-lived token lasts 60 days. The daily job refreshes any
  token that is more than 24 hours old and within 15 days of expiry. If Meta
  refuses the refresh, or the token has already expired, the row is set to
  `status: 'expired'` with the reason in `last_error`, and someone has to
  reconnect.
- The Graph API version is pinned to `v23.0` (`META_IG_GRAPH_VERSION` in the
  core). Check it against Meta's changelog before going live.
