# Meta App Review — groundwork (DRAFT, pending owner review)

Written 30 Sep 2026 from the code on branch `meta-app-review-groundwork`. Nothing here has been
submitted to Meta, and no Meta app exists yet. Everything marked `[…]` is for the owner.

**Read this first — what is NOT built yet.** Today every Instagram/Facebook action goes through
Zernio's Meta app, not ours. A review of *our* app needs our app to do the thing on camera, so
before submission these still have to be built: Instagram Login / Facebook Login (OAuth redirect
and token storage), direct Graph API calls for publish / comments / messages / insights, and a
Meta webhook endpoint for comments and messages. The screencast scripts below describe the flows
as they will look once that exists; they reuse the pages that exist now (Schedule, Inbox,
Automations, the client portal).

Checked on 30 Sep 2026: Meta's data-deletion callback doc (request is a POST with
`signed_request`; payload `algorithm`, `expires`, `issued_at`, `user_id`; response
`{ url, confirmation_code }`), and the permissions reference (every permission named below exists
there). Not checked: the current App Review submission form's exact fields, and whether
"oEmbed Read" is still a separate feature — confirm both in the App Dashboard.

---

## 1. Pages and endpoints built for review

| What Meta asks for | Where it lives | State |
|---|---|---|
| Privacy Policy (with Platform Data section) | `/privacy` — `app/privacy/page.tsx` | Draft banner + noindex |
| Terms of Service | `/terms` — `app/terms/page.tsx` | Draft banner + noindex |
| Data deletion instructions | `/data-deletion` — `app/data-deletion/page.tsx` | Draft banner + noindex |
| Data deletion status (the `url` Meta shows) | `/data-deletion/status?code=…` | Always noindex |
| Data Deletion Request Callback | `POST /api/meta/data-deletion` | 503 until `META_APP_SECRET` is set |
| App / business description for reviewers | `/app-info` — `app/app-info/page.tsx` | Draft banner + noindex |
| Support / contact | `/support` — `app/support/page.tsx` | Draft banner + noindex |

Draft switches: `app/lib/legal-pages.ts` (one per page). To publish: fill the page's `[…]`,
flip its switch to `false`, update `LEGAL_UPDATED`. All five paths are outside middleware.ts's
protected list and matcher (pinned by `tests/meta-data-deletion-route.test.ts`), so they are
public and Clerk-free on both hosts.

The callback records a row in `data_deletion_requests` (ghost table in
`scripts/gen-db-types.mjs`) and does nothing else — no deletion, no email. **A super admin must
watch that table** (there is no dashboard view of it yet; read it in the Firebase console under
`/mdm/tables/data_deletion_requests`) and move `status`: `received` → `in_progress` →
`completed` | `nothing_held`. The status page reads that field.

## 2. App Dashboard → Settings → Basic

| Field | Value |
|---|---|
| Display name | MD Media `[confirm]` |
| Namespace | leave blank |
| App domains | `mdmmarketing.com.au`, `www.mdmmarketing.com.au`, `app.mdmmarketing.com.au` |
| Contact email | hello@mdmmarketing.com.au |
| Privacy Policy URL | `https://www.mdmmarketing.com.au/privacy` |
| Terms of Service URL | `https://www.mdmmarketing.com.au/terms` |
| User data deletion | choose **Data deletion callback URL**: `https://app.mdmmarketing.com.au/api/meta/data-deletion` (the alternative, "instructions URL", would be `https://www.mdmmarketing.com.au/data-deletion`) |
| App icon | 1024 × 1024 PNG `[owner to supply]` |
| Category | Business and pages `[confirm]` |
| Business use | we provide services to other businesses (our clients) — pick the matching option `[confirm wording in the form]` |
| Platform → Website → Site URL | `https://www.mdmmarketing.com.au/` |
| App secret | copy into Vercel as `META_APP_SECRET` (Production); redeploy — the callback wakes up |

Not verified live: that `www.mdmmarketing.com.au` serves this Next.js app (the pages' canonical
URLs already assume it). Open `https://www.mdmmarketing.com.au/privacy` after deploy before
entering the URLs.

Also needed later, once login is built: Valid OAuth Redirect URIs `[not built]`, Webhooks
callback URL + verify token `[not built]`.

## 3. Permissions and use-case descriptions

Recommended route: **Instagram API with Instagram Login** for Instagram (the `instagram_business_*`
scopes), plus **Facebook Login for Business** only if clients' Facebook Pages are to be managed
directly. Request only what a feature on screen uses.

### instagram_business_basic
Use: identify the connected Instagram professional account (id, username, profile picture) and
list its own media so our team can pick a post (for reporting and for choosing the one post an
automation is bound to). Shown in: Schedule → channel list; Automations → post picker.

### instagram_business_content_publish
Use: publish a client's approved photo, carousel or Reel to the client's own Instagram account at
the booked time. Every post is prepared by our team and approved in the app before it goes out.
Shown in: Schedule → post → Book / Publish.

### instagram_business_manage_comments
Use: show comments on the client's posts in the app's Inbox so our team can reply on the client's
behalf, and post the single public reply of a comment-to-message automation the client switched
on for one post. We never comment on anyone else's content. Shown in: Inbox → Comments; Automations.

### instagram_business_manage_messages
Use: show direct messages sent to the client's account in the Inbox so our team can answer them,
and send the one private reply to a person who commented the chosen keyword on the one post an
automation is switched on for. We only message people who wrote to the account or commented on
that post first, once per person per post. Shown in: Inbox → Direct messages; Automations.

### instagram_business_manage_insights
Use: read the results of the client's own posts (views, reach, likes, comments, shares, saves) and
show them to the client in the portal and to our team. Shown in: post page → performance; client portal.

### Facebook Pages (only if managed directly)
- `pages_show_list` — list the Pages the client manages so they pick the one to connect.
- `pages_manage_posts` — publish the client's approved posts to their Page.
- `pages_read_engagement`, `pages_read_user_content` — read the Page's posts and the comments on them for the Inbox and reporting.
- `pages_manage_engagement` — reply to comments on the Page.
- `pages_messaging` — answer Messenger conversations sent to the Page.
- `read_insights` — Page post results for reporting.
- `business_management` — **do not request** unless a flow needs Business Manager assets; nothing in the app does today.

### oEmbed
`app/lib/link-preview-core.ts` calls Meta's oEmbed with `META_OEMBED_TOKEN` to preview a public
post link. Request the oEmbed Read feature `[confirm name]` if this app's token is to be used.

## 4. Screencast scripts (one per permission group; record at 1080p, English UI, captions on)

Each video: start signed out, show the sign-in, show the permission dialog, then the feature, and
end on the result in Instagram itself. Use the 100M test client only (see §5).

1. **Connect + basic** — Sign in as the test account manager → Social → Schedule → Access →
   "Connect Instagram" → Instagram Login dialog (show the scopes) → back in the app, the 100M
   account appears with its username and picture.
2. **Publish** — Schedule → New post → pick an image from the test client's files → caption →
   Send for approval → sign in as the test client in the portal → Approve → back as the team →
   Book for "now + 2 minutes" → show the post live on the 100M Instagram profile.
3. **Comments** — From a second (tester) Instagram account comment on that post → app Inbox →
   Comments → the comment appears → type a reply → Send → show the reply on Instagram.
4. **Messages** — From the tester account send a DM to 100M → Inbox → Direct messages → reply →
   show it arrive in the tester's Instagram inbox.
5. **Automation** — Automations → New → pick the 100M post → keyword "LINK" → DM text with button
   → public reply text → switch on → from the tester account comment "LINK" → show the DM and the
   public reply arrive → comment "LINK" again → show nothing is sent a second time.
6. **Insights** — Open the post's page in the app → performance figures → client portal shows
   the same figures.
7. **Data deletion** — show `/data-deletion`, then the status page for a code.

## 5. Test user instructions for the reviewer (paste into the submission)

> MD Media's app is used by our agency team and by the businesses we manage. Please sign in at
> https://app.mdmmarketing.com.au/sign-in with:
>
> - Team account: `[TEST TEAM EMAIL]` / `[PASSWORD]`
> - Client (portal) account: `[TEST CLIENT EMAIL]` / `[PASSWORD]`
>
> Both are limited to our test business "100 Hundred Million Group" and its Instagram account
> `@[100M INSTAGRAM HANDLE]`. To test comments and messages, use the Instagram tester account
> `[TESTER HANDLE]` / `[PASSWORD]` (or your own tester, added under App Roles). Steps: as in the
> screencasts, §4 above `[condense into numbered steps per permission]`.

Rules (owner's): test on 100M only — never a real client's account; test accounts must not have
2-factor codes the reviewer cannot receive `[owner to arrange]`.

## 6. Business Verification — documents checklist

- [ ] Legal name exactly as registered: MD Media Marketing Pty Ltd `[confirm]`
- [ ] ABN / ACN — ASIC company extract or ABN registration printout (the site footer currently
      shows ABN 75 681 730 512 — confirmed by the owner on 1 Oct 2026 and on the policies)
- [ ] Proof of address matching the Business Manager address: utility bill, bank statement or
      ASIC extract: Unit 56/23 Chambers Rd, Altona North VIC 3025
- [ ] Business phone that can receive a call/SMS code `[PHONE]`
- [ ] Domain verification of `mdmmarketing.com.au` in Business Settings (DNS TXT record or meta tag)
- [ ] Business email on the domain (hello@mdmmarketing.com.au) able to receive a code
- [ ] Website shows the legal name (footer already does) and links Privacy / Terms (added on this branch)
- [ ] Business Manager admin with 2-factor enabled; app attached to that Business Manager

## 7. Placeholders still open

`[PHONE]`, retention periods (privacy §5), the fate of the follower records
collected before 30 Sep 2026 (privacy §2), the Platform-Data matching confirmation (privacy §8),
IP terms, liability cap and governing state (terms), support response time, the Zernio → own-app
sentence (/app-info), and every credential in §5.
