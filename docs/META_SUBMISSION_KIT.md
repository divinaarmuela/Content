# Meta App Review — submission kit (one submission, five permissions)

Rewritten 5 Oct 2026 (the owner: "one big submission", "make sure we get all their features"). App: **Social
Scheduler** (App ID 2142902776443404), Instagram app 843035665085991, "Instagram API with Instagram Login".
Background and the longer list: `docs/META_APP_REVIEW.md`, `docs/META_INSTAGRAM_SETUP.md`.

## What we submit

Meta's App Review docs (read 5 Oct 2026):
- *"If you request permissions or features that your app does not use … your submission will not be approved."*
- *"To request Advanced Access to certain permissions, you need to make at least 1 successful API call."*
- Advanced Access (needed to serve clients' accounts, which have no role on our app) *"requires App Review and
  Business Verification."*

So each permission below is something our own app does, on screen, and each has a real call behind it — made on
the test client **100 Hundred Million Group** / **@testbusinessaccount2026**, through our own Meta app (not Zernio).

| Permission | What it does in our app | Where | Successful call (5 Oct 2026) |
|---|---|---|---|
| `instagram_business_basic` | Connect a client's Instagram; show its username; list its posts | Clients → client → Social → "Instagram — our own Meta app" | ✅ connected, all five scopes granted |
| `instagram_business_manage_comments` | Read a post's comments; reply, hide, show again, delete | same card → **Comments** | ✅ reply, hide, show again (delete not yet pressed) |
| `instagram_business_manage_messages` | Read direct messages; answer inside 24 hours; message a commenter | same card → **Messages** (and "Message them" on a comment) | ✅ a DM answered ("Message them" not yet pressed) |
| `instagram_business_manage_insights` | The account's and each post's numbers | same card → **Insights**, and each post under Comments | ✅ read |
| `instagram_business_content_publish` | Publish the client's booked post at its time | Social → Schedule | ⏳ first post booked for 12:40 pm, 5 Oct — fill in once seen live |

The connect asks for exactly these five (`app/lib/meta-ig-core.ts` `META_IG_SCOPES`). Code: `meta-ig-inbox-core.ts`
(pure), `meta-ig-inbox.ts`, `/api/meta/instagram/inbox`, `MetaInstagramInbox.tsx`, `meta-ig-publish.ts`.

## Two traps found while testing — both matter for the recording

1. **One conversation, one app.** @testbusinessaccount2026 is connected to Zernio AND to our app. When Zernio's
   comment automation had just DMed someone, our app's reply to that person was refused: *"The action is invalid
   since it's not the thread owner"* (100/2534037 — Meta's Conversation Routing; a thread frees up 24 hours after
   its last message). A person Zernio had never written to was answered first time. **For the recording: the DM
   must come from an account Zernio has not messaged, and 100M's comment automation stays OFF** (it was switched
   off 5 Oct 2026, 12:21 pm).
2. **The word "TEST".** That automation fired on a comment saying TEST on the reel. With it off nothing replies by
   itself — but do not use TEST or LINK as the comment on camera anyway.

## Before submitting — checklist

Done:
- [x] Reviewer app login: `mdmedia.review@gmail.com` — account manager, 100M only, password sign-in with no code
      (Clerk "Device Trust" was switched off for this; it can go back on after the review).
- [x] @testbusinessaccount2026 has no two-factor (its settings page offered "Get started", 5 Oct 2026).
- [x] 100M reconnected with all five scopes; "Post this client's Instagram through Meta" is ON for 100M.

Still to do:
1. See the 12:40 pm test post live on @testbusinessaccount2026 (the publishing call).
2. `META_APP_SECRET` (Facebook app secret, Settings → Basic) in Vercel Production → redeploy. Check:
   `POST https://app.mdmmarketing.com.au/api/meta/data-deletion` stops answering "not configured".
3. Business Verification (Business Settings → Security Centre) — documents in `docs/META_APP_REVIEW.md` §6.
4. Tech Provider access verification (Meta asks for it when an app serves other businesses' accounts).
5. Settings → Basic: values in `docs/META_APP_REVIEW.md` §2; app icon 1024×1024.
6. The screencasts below. 7. Reviewer instructions below. 8. Submit (Instagram API setup → "Complete app review" →
   Continue to app review → a description and a screencast per permission → submit). Meta takes roughly 2–3 weeks.

---

## Form text — one per permission

### `instagram_business_basic`

> MD Media is a social media agency. Our web app is used by our team to manage the Instagram accounts of the
> businesses we work with. A business connects its Instagram professional account to our app through Instagram
> Login. We use instagram_business_basic to identify the connected account — its Instagram user ID and username —
> and to list its own posts, so our team can see which account is connected for which client and choose the post
> whose comments or numbers they want to look at. We store the account ID, username and access token (encrypted)
> and nothing else from the profile. The connected account is shown on the client's page in our app
> (Clients → client → Social).

### `instagram_business_manage_comments`

> Our team looks after the comments on a client's Instagram posts. On the client's page (Clients → client → Social
> → Comments) they pick one of the account's posts and our app uses instagram_business_manage_comments to read the
> comments on it, post a reply the team member has written, hide or un-hide a comment, and delete a comment. Every
> action is taken by a signed-in team member pressing a button for that one comment; our app does not reply, hide
> or delete automatically. Comments are read from Instagram when the page is opened and are not stored.

### `instagram_business_manage_messages`

> Our team answers the direct messages people send to a client's Instagram account. On the client's page (Clients
> → client → Social → Messages) our app uses instagram_business_manage_messages to list the account's conversations
> and their recent messages, and to send a reply that a team member has written, within Instagram's 24-hour
> messaging window. From a comment, a team member can also send one private reply to the person who wrote it.
> Every message is written and sent by a signed-in team member; our app sends no automatic messages. Messages are
> read from Instagram when the page is opened.

### `instagram_business_manage_insights`

> We report to each client on how their Instagram account is performing. On the client's page (Clients → client →
> Social → Insights) our app uses instagram_business_manage_insights to show the account's followers and posts and
> its reach, views, accounts engaged, interactions, likes, comments, shares and saves for the last 7 or 28 days,
> and, on each post, that post's own reach, views, likes, comments, shares and saves. The numbers are shown to our
> team members who work on that client and are used to plan the client's content.

### `instagram_business_content_publish`

> Our team prepares a client's posts (photos, carousels and Reels) in our app. Each post is booked for a time; the
> client can see it on their portal before it goes out. At the booked time, our app uses
> instagram_business_content_publish to publish that post to the client's own connected Instagram professional
> account — only that account, only posts prepared for that client, and only at the time booked. We never publish
> to an account the client has not connected, and nothing is published without being booked by our team.

---

## Screencasts

Meta's rules (App Review docs, read 5 Oct 2026): 1080p or better, screen width no more than 1440, use the mouse,
no audio needed, English UI, and each one must show **the permission being granted and then being used**. Record
the browser window (Windows: **Win + Alt + R** starts and stops). Add the captions in brackets as on-screen text.

Sign in as the reviewer account `mdmedia.review@gmail.com` for every recording — it is what Meta will use.

**Set up before pressing record:** 100M's comment automation OFF · a second Instagram account that Zernio has never
messaged, ready on a phone (call it "the customer") · @testbusinessaccount2026 signed OUT in the recording browser,
so Instagram's login shows.

### Screencast 1 — Connect (`instagram_business_basic`) — reuse its first minute in every other one

1. `https://app.mdmmarketing.com.au/sign-in`, signed out. Sign in. *[Our team signs in to the MD Media app]*
2. **Clients → 100 Hundred Million Group → Social.** Scroll to **"Instagram — our own Meta app"**.
   *[Each client has a Social page. Here the business connects its Instagram.]*
3. Press **Connect Instagram directly (Meta)**. Sign in to Instagram as **@testbusinessaccount2026**.
4. **Stop on Instagram's permission screen for 4–5 seconds** so the permissions are readable.
   *[Our app asks for: basic profile, publishing, comments, messages and insights]*
5. Press **Allow**. Back on the client's page: **"Instagram connected directly — @testbusinessaccount2026"**.
   *[We use the basic profile to show which account is connected]*
6. Under it, the **Comments** tab lists the account's posts. *[…and to list its posts]*

### Screencast 2 — Comments (`instagram_business_manage_comments`)

Before: the customer leaves a comment on a post (e.g. "How much is this?").
1. Steps 1–5 of Screencast 1 (the grant).
2. **Comments** → press the post. Its comments appear. *[Our app reads the post's comments]*
3. On the customer's comment press **Reply**, type "Thanks — we'll message you the details.", **Post reply**.
   *[A team member replies]* Open the post on Instagram (the "Open on Instagram" link) and show the reply there.
4. Back in the app: **Hide** → the comment is marked Hidden. **Show again**. *[…hides or un-hides a comment]*
5. On our own reply press **Delete** → **Delete it**. *[…and deletes a comment]*

### Screencast 3 — Messages (`instagram_business_manage_messages`)

Before: the customer sends @testbusinessaccount2026 a DM ("Hi, do you have this in stock?").
1. Steps 1–5 of Screencast 1 (the grant).
2. **Messages**. The customer's conversation is listed, marked "Can be answered". *[Our app reads the messages]*
3. Open it, type "Hi! Yes we do — happy to help.", **Send message**. *[A team member answers]*
4. Show the customer's phone (or instagram.com signed in as the customer) with the reply received.
5. Optional: **Comments** → a customer comment → **Message them** → type → **Send message**. *[One private reply to a commenter]*

### Screencast 4 — Insights (`instagram_business_manage_insights`)

1. Steps 1–5 of Screencast 1 (the grant).
2. **Insights**. Followers, posts and the last 7 days. Press **Last 28 days**. *[The account's numbers]*
3. **Comments** → press a post → the "This post" numbers at the top. *[…and each post's numbers]*

### Screencast 5 — Publish (`instagram_business_content_publish`)

1. Steps 1–5 of Screencast 1 (the grant).
2. **Social → Schedule**, client **100 Hundred Million Group**. *[Our team prepares the client's post]*
3. **New post** → upload a JPEG → **Use this file** → write a caption → channel **testbusinessaccount2026** →
   pick a time **at least 15 minutes ahead** (the app refuses sooner) → **Schedule it** → **Schedule it**.
   *[The post is booked for a time]*
4. Open the client's portal link (Scheduling tab) to show the booked post. *[The client sees it before it goes out]*
5. Pause the recording until the time. Then open **instagram.com/testbusinessaccount2026** and show the post live.
   *[At the booked time our app publishes it to the client's own Instagram account]*

Rules: 100M / @testbusinessaccount2026 only — never a real client. Test posts and comments can be deleted after.

---

## Reviewer instructions (paste into the submission)

> MD Media's app is used by our agency team to manage the businesses we work with. Please sign in at
> https://app.mdmmarketing.com.au/sign-in with the test team account: `mdmedia.review@gmail.com` / `[PASSWORD]`
> (email and password only — no code is sent). It is limited to our test business "100 Hundred Million Group" and
> its Instagram account @testbusinessaccount2026.
>
> 1. Connect (basic): Clients → 100 Hundred Million Group → Social → "Instagram — our own Meta app" → Connect
>    Instagram directly (Meta). Sign in with the Instagram test account `testbusinessaccount2026` / `[PASSWORD]`
>    (no two-factor). The connected account's username appears on the page.
> 2. Comments: in the same card, Comments → choose a post → its comments are listed. Reply, Hide / Show again and
>    Delete are on each comment.
> 3. Messages: Messages → open a conversation → write a reply → Send message. Instagram allows a reply within 24
>    hours of the person's last message, so please first send a direct message to @testbusinessaccount2026 from
>    any Instagram account.
> 4. Insights: Insights → the account's numbers for the last 7 or 28 days; each post's own numbers are at the top
>    of its page under Comments.
> 5. Publishing: Social → Schedule → 100 Hundred Million Group → New post → upload a JPEG image → add a caption →
>    choose the channel testbusinessaccount2026 → pick a time at least 15 minutes ahead → Schedule it. At that time
>    it is published to @testbusinessaccount2026.

`[…]` = owner to fill; passwords are never written in this repo.
