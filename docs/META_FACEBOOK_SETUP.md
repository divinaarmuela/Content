# Facebook Page direct (Meta) — setup

Built 6 Nov 2026. The Facebook twin of `docs/META_INSTAGRAM_SETUP.md`. Zernio stays the default everywhere:
nothing on this road runs for a client whose `facebook_via_meta` is off.

## What is already configured on Meta (do not change from here)

- App "Social Scheduler", App ID `2142902776443404`; secret = Vercel env `META_APP_SECRET` (Production only).
- Facebook Login for Business, configuration **"Connect Facebook Page"**, `config_id` `1428692675563072`,
  User access token. Permissions: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`,
  `pages_manage_posts`, `pages_manage_engagement`, `pages_manage_metadata`, `read_insights`, `pages_messaging`
  (Messenger use case added 6 Nov 2026).
- Valid OAuth redirect URI: `https://app.mdmmarketing.com.au/api/meta/facebook/callback`.
- Test Page: "MD Media Test Page", Page ID `61596416725098`. Test client: 100 Hundred Million Group (100M).

## Env (Vercel Production)

| Name | Value | Needed |
|---|---|---|
| `META_APP_SECRET` | the Facebook app secret | yes (already set) |
| `CREDENTIALS_KEY` | already set (encrypts tokens) | yes |
| `META_FB_APP_ID` | default `2142902776443404` | no |
| `META_FB_REDIRECT_URI` | default the URI above | no |
| `META_FB_CONFIG_ID` | default `1428692675563072` | no |
| `META_WEBHOOK_VERIFY_TOKEN` | shared with Instagram | for the webhook |

Until `META_APP_SECRET` and `CREDENTIALS_KEY` are set, every route answers 503 with the reason.

## Webhook

Same callback as Instagram: `https://app.mdmmarketing.com.au/api/meta/webhook`. In the Meta dashboard, the
**Page** webhook object must be subscribed to the fields `feed` and `messages` (the app-level subscription —
check it; the per-Page `POST /{page-id}/subscribed_apps` is done by the app when a Page is picked). Page bodies
(`object: "page"`) must be signed with `META_APP_SECRET`; Instagram bodies with `META_IG_APP_SECRET`. A body
signed with the other app's secret is refused. Events are stored in `meta_fb_events`; nothing replies on its own.

## How it works

1. Client → Social → "Facebook Page — our own Meta app" (Direct — testing) → **Connect Facebook Page (Meta)**
   (`/api/meta/facebook/connect`, account manager on their own client, or super admin).
2. Facebook asks which Pages to share. The callback (`/api/meta/facebook/callback`, public, signed state only)
   exchanges code → user token → long-lived user token → `GET /me/accounts`, and stores **every** Page as a
   candidate in `meta_fb_pages` (token encrypted). A Page that is already another client's picked Page is left alone.
3. One Page shared → it is picked automatically. Several → a super admin presses **Use this Page**
   (`POST /api/meta/facebook/pages {action:'pick'}`); the other candidates are removed and the Page is subscribed
   to `feed,messages`.
4. The card then shows **Comments**, **Messages** (Messenger, reply within 24 hours) and **Numbers**.
5. Super admin switch **Post this client's Facebook through Meta** (`PATCH /api/meta/facebook/pages`). On, and
   with a picked Page: a booked post's Facebook target becomes its own job (`provider: 'meta_fb'`), held until its
   time and posted by `app/lib/meta-fb-publish.ts` (text, one photo, 2–10 photos, one video; Stories/Reels and
   documents stay on Zernio). Switched off before its time → it goes through Zernio.

Never twice: `publish_jobs.meta_fb.sending_at` is written before the one publishing call; a retry that finds it
with no `post_id` fails with words asking someone to check the Page, rather than posting again.

## Insights

Many Page metrics were withdrawn (Meta's deprecated-metrics page, read 6 Nov 2026: `page_impressions*`,
`page_fans`, `post_impressions*` gone since 15 Jun / 15 Nov 2025). Used here: `page_follows`,
`page_daily_follows_unique`, `page_media_view`, `page_total_media_view_unique`, `page_post_engagements`,
`page_views_total`; per post `post_media_view`, `post_total_media_view_unique`, `post_clicks`,
`post_reactions_by_type_total`. Not yet seen live — if Meta refuses one, the card says so and shows the rest.

## Files

`app/lib/meta-fb-core.ts` (pure, `tests/meta-fb-core.test.ts`), `app/lib/meta-fb-client.ts` (Graph calls,
portable), `app/lib/meta-fb.ts` (tables, encryption, inbox, webhook record), `app/lib/meta-fb-publish.ts`,
`app/api/meta/facebook/{connect,callback,pages,inbox}`, `app/dashboard/clients/MetaDirectFacebook.tsx`,
`tests/meta-fb-routes.test.ts`.
