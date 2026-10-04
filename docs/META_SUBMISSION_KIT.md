# Meta App Review — submission kit (first submission)

Written 5 Oct 2026. App: **Social Scheduler** (App ID 2142902776443404), Instagram app 843035665085991, "Instagram API
with Instagram Login". Background and the longer list: `docs/META_APP_REVIEW.md`, `docs/META_INSTAGRAM_SETUP.md`.

## What we submit, and why only this

Meta's App Review docs (read 5 Oct 2026):
- *"If you request permissions or features that your app does not use … your submission will not be approved."*
- *"To request Advanced Access to certain permissions, you need to make at least 1 successful API call."*
- Advanced Access (needed to serve clients' accounts, which have no role on our app) *"requires App Review and
  Business Verification."*

Our own app, today, does two things with Instagram: it **connects** an account and it **publishes**. Comments, DMs
and insights still run through Zernio. So the first submission is:

| Permission | What it does in our app | Successful call made? |
|---|---|---|
| `instagram_business_basic` | Connect a client's Instagram; show its username and picture | ✅ (100M's @testbusinessaccount2026 connected) |
| `instagram_business_content_publish` | Publish the client's approved post at its booked time | ❌ **not yet — do step 0 below first** |

The connect asks for exactly these two (`app/lib/meta-ig-core.ts` `META_IG_SCOPES`). Add comments / messages /
insights in a later submission, once our app does them itself.

## Before submitting — checklist

0. **One real publish through our app** to @testbusinessaccount2026 (100M → Clients → Social → "Direct — testing" →
   switch Instagram publishing to Meta → book a post). Meta needs the successful call before the request.
1. `META_APP_SECRET` (Facebook app secret, Settings → Basic) in Vercel Production → redeploy. Check:
   `POST https://app.mdmmarketing.com.au/api/meta/data-deletion` stops answering "not configured".
2. Business Verification (Business Settings → Security Centre) — documents in `docs/META_APP_REVIEW.md` §6.
3. Settings → Basic: values in `docs/META_APP_REVIEW.md` §2; app icon 1024×1024.
4. The two screencasts below. 5. Reviewer instructions below. 6. Submit (Instagram API setup → "Complete app
   review" → Continue to app review → permission descriptions → screencasts → submit).

---

## Form text — `instagram_business_basic`

> MD Media is a social media agency. Our web app is used by our team to plan and publish content for the businesses
> we manage. A business owner connects their Instagram professional account to our app through Instagram Login.
> We use instagram_business_basic to identify the connected account — its Instagram user ID, username and profile
> picture — so our team can see which account is connected for which client, and so posts are published to the
> right account. We store the account ID, username and access token (encrypted) and nothing else from the profile.
> The connected account is shown on the client's page in our app (Clients → client → Social).

## Form text — `instagram_business_content_publish`

> Our team prepares a client's posts (photos, carousels and Reels) in our app. Each post passes our quality check
> and is booked for a time; the client can see it on their portal before it goes out. At the booked time, our app
> uses instagram_business_content_publish to publish that post to the client's own connected Instagram professional
> account — only that account, only posts prepared for that client, and only at the time booked. We never publish
> to an account the client has not connected, and nothing is published without being booked by our team.

---

## Screencast 1 — Connect (shows `instagram_business_basic`)

Record the browser window only (Windows: **Win + Alt + R** to start and stop). 1080p, English, about 1–2 minutes.
Add the captions in brackets as on-screen text, or say them aloud.

1. Start at `https://app.mdmmarketing.com.au/sign-in`, signed out. Sign in as the test team account.
   *[Our team signs in to the MD Media app]*
2. Go to **Clients → 100 Hundred Million Group → Social**. Scroll to the card **"Direct — testing"**.
   *[Each client has a Social page. Here the business connects its Instagram.]*
3. Press **Connect Instagram directly (Meta)**. Instagram's login opens. Sign in as **@testbusinessaccount2026**.
4. **Stop on the permission screen for 3–4 seconds** so the two permissions are readable.
   *[Our app asks for two permissions: basic profile and content publishing]*
5. Press **Allow**. You land back on the client's page: **"Instagram connected directly — @testbusinessaccount2026"**
   with its picture. *[We use the basic profile to show which account is connected]*
6. Stop recording.

## Screencast 2 — Publish (shows `instagram_business_content_publish`)

1. Signed in as the test team account. Go to **Social → Schedule**, client **100 Hundred Million Group**.
   *[Our team prepares the client's post]*
2. **New post** → pick an image from 100M's files → write a caption (e.g. "Test post — Meta App Review").
3. Send it through the quality check and book it for **2 minutes from now** on Instagram.
   *[The post is checked and booked for a time]*
4. Open the client's portal link (Scheduling tab) to show the booked post. *[The client sees it before it goes out]*
5. Wait for the time. Open **instagram.com/testbusinessaccount2026** (or the Instagram app) and show the post live.
   *[At the booked time our app publishes it to the client's own Instagram account]*
6. Stop recording.

Rules: 100M / @testbusinessaccount2026 only — never a real client. The test post can be deleted from Instagram after.

---

## Reviewer instructions (paste into the submission)

> MD Media's app is used by our agency team to manage the businesses we work with. Please sign in at
> https://app.mdmmarketing.com.au/sign-in with the test team account: `[TEST TEAM EMAIL]` / `[PASSWORD]`.
> It is limited to our test business "100 Hundred Million Group" and its Instagram account @testbusinessaccount2026.
>
> 1. Basic profile: Clients → 100 Hundred Million Group → Social → "Direct — testing" → Connect Instagram directly
>    (Meta). Sign in with the Instagram test account `[IG TEST LOGIN]` / `[PASSWORD]`. The connected account's
>    username and picture appear on the page.
> 2. Content publishing: Social → Schedule → 100 Hundred Million Group → New post → add an image and caption →
>    pass the quality check → book it for a time a few minutes ahead. At that time it is published to
>    @testbusinessaccount2026.

`[…]` = owner to fill. The test logins must not need a 2-factor code the reviewer cannot receive.
