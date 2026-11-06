# MD App — Unified Login (Stage 1, 6 Nov 2026)

MD App is Meta's new app for the agency (App ID `2326339324873915`, owned by the verified business MD Media).
It uses the **Instagram API with Unified Login**: Facebook Login for Business, the configuration
"Connect client accounts" (config_id `1439306511741893`), which gives a **Business Integration System User
(BISU) token that never expires**, belonging to the client's business portfolio.

**It is a separate, opt-in road.** Zernio stays the default for every client. The old Instagram-Login app
(`meta-ig-*`) and the old Facebook app (`meta-fb-*`) keep working unchanged. Nothing in Zernio's publisher,
webhook, inbox copy or account sync calls MD App code.

## Env (add in Vercel — the owner)

| Name | Needed | Default |
|---|---|---|
| `MD_SECRET` | **yes** (App secret from MD App → Settings → Basic) | — |
| `CREDENTIALS_KEY` | yes (already set for the old roads) | — |
| `MD_APP_WEBHOOK_VERIFY_TOKEN` | for the webhook handshake (any long random string, same value typed into MD App's Webhooks settings) | — |
| `MD_APP_ID` | no | `2326339324873915` |
| `MD_APP_CONFIG_ID` | no | `1439306511741893` |
| `MD_APP_REDIRECT_URI` | no | `https://app.mdmmarketing.com.au/api/meta/facebook/callback` |

Until `MD_SECRET` and `CREDENTIALS_KEY` are set, every MD App route answers 503 with a plain reason.

## Flow

1. Super admin opens the client's **Social** page → card **"Direct via MD App (testing)"** → *Connect with
   Facebook / Instagram* → `GET /api/meta/md-app/connect?clientId=` (account manager+, client must be theirs).
2. Redirect to `https://www.facebook.com/dialog/oauth?client_id&config_id&redirect_uri&response_type=code&state`
   (no `scope`). The `state` is HMAC-signed with `MD_SECRET`, 10-minute expiry, prefix `mdapp1.`.
3. Meta returns to **`/api/meta/facebook/callback`** (already registered on MD App). That route is shared with
   the old Facebook app: a state starting `mdapp1.` goes to `app/lib/md-app-callback.ts`; anything else
   follows the old road exactly as before. No new redirect URI needs registering.
4. Code → `GET graph.facebook.com/v27.0/oauth/access_token` → BISU token, stored **encrypted** in
   `md_app_connections` (one row per client, id = client id). Then:
   `GET /me?fields=client_business_id`, `GET /me/assigned_instagram_accounts?fields=id,username`,
   `GET /me/accounts?fields=id,name` (Pages), `GET /me/adaccounts?fields=id,account_id,name` → `md_app_assets`.
5. Super admin ticks which accounts belong to the client, then (optionally) turns on **"Use MD App for this
   client"** (`md_app_connections.use_md_app`). The switch never writes the `clients` row.
6. Test buttons — each makes ONE real call, so Meta logs a successful call per permission before App Review.

## Tables (ghost tables, `scripts/gen-db-types.mjs`)

`md_app_connections`, `md_app_assets`, `md_app_events` (webhook, stored only), `md_app_publishes`
(never-twice guard: `sending_at` claimed before the one publishing call; a retry that finds it with no
`post_id` never posts again; a Meta 4xx refusal lifts it).

## Test buttons → permission → call

| Button | Permission(s) | Call |
|---|---|---|
| Read Instagram profile | instagram_basic | `GET /{ig-id}?fields=id,username,…` |
| List Instagram posts | instagram_basic | `GET /{ig-id}/media` |
| Read Instagram insights | instagram_manage_insights | `GET /{ig-id}/insights?metric=reach,follows_and_unfollows,profile_views,accounts_engaged,total_interactions,views&period=day&metric_type=total_value` |
| List comments on the latest post | instagram_manage_comments | `GET /{media-id}/comments` (after one `/media` read) |
| List Instagram conversations | instagram_manage_messages | `GET /{ig-id}/conversations?platform=instagram` |
| Read Instagram posting allowance | instagram_content_publish | `GET /{ig-id}/content_publishing_limit` |
| Subscribe Instagram to webhooks | instagram_manage_comments / _messages / _insights | `POST /{ig-id}/subscribed_apps` comments,mentions,messages,message_reactions,messaging_seen,story_insights |
| List Pages | pages_show_list | `GET /me/accounts` |
| Read Page posts | pages_read_engagement, pages_read_user_content | `GET /{page-id}/feed` (Page token) |
| Read Page insights | read_insights | `GET /{page-id}/insights` (PAGE_METRICS from meta-fb-core) |
| List Messenger conversations | pages_messaging | `GET /{page-id}/conversations?platform=messenger` |
| Subscribe Page to webhooks | pages_manage_metadata | `POST /{page-id}/subscribed_apps` feed,messages,leadgen |
| List lead forms | leads_retrieval | `GET /{page-id}/leadgen_forms` |
| List ad accounts | ads_read | `GET /me/adaccounts` |
| Read business portfolio | business_management | `GET /me?fields=client_business_id` |

Page calls use a Page token read on demand with `GET /{page-id}?fields=access_token` (never stored).
Every call carries `appsecret_proof`. Not covered by a button (no harmless one-call test): publishing
(`instagram_content_publish`, `pages_manage_posts`, `publish_video`) — use `mdPublish` on a ZZ TEST client;
comment reply/hide/delete (`pages_manage_engagement`); `ads_management`, `pages_manage_ads`.

## What Meta logs

The App Dashboard → App Review → Permissions and Features shows, per permission, whether the app has made a
successful API call in the last 30 days. One press of each button above is meant to produce that.

## Webhook

Same callback URL: `https://app.mdmmarketing.com.au/api/meta/webhook`. GET handshake accepts
`MD_APP_WEBHOOK_VERIFY_TOKEN` (as well as the old token). POST: a body signed (`X-Hub-Signature-256`) with
`MD_SECRET` only is stored in `md_app_events` (id = hash of object/account/field/payload, claimed once) —
never in the old tables or Zernio's inbox copy, and nothing replies.

## Verified vs not (docs read 6 Nov 2026, developers.facebook.com/documentation/instagram-platform/*.md)

Verified on the pages: dialog URL + params; code exchange endpoint (v27.0); `/me?fields=client_business_id`;
`/me/assigned_instagram_accounts`; `/me/adaccounts`; graph.facebook.com only; publishing container flow;
comment endpoints; private replies body + one-per-commenter + 7 days; IG `subscribed_apps` with BISU token;
webhook field names; signature header.

NOT verified: `state` round-trip (not mentioned; standard OAuth); whether `redirect_uri` is required on the
exchange (we send it); Pages via `/me/accounts` for a BISU (docs silent); Page token via
`/{page-id}?fields=access_token` with a BISU; IG insights metric names (from the Graph reference, not re-read);
HUMAN_AGENT tag syntax for Unified; the `hide` parameter name; Page webhook subscription with a Page token
derived from a BISU. The first real connect + test buttons will settle these.
