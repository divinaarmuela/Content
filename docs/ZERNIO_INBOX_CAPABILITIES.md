# Zernio's social inbox — what it can do, and what the acquisition scanner can read

Compiled 21 Sep 2026 from Zernio's own OpenAPI spec, **version 1.17.0**
(`https://docs.zernio.com/api/openapi`, 491 paths, 53 webhook events), so nobody
re-derives it from the docs site. The full parameter-by-parameter extract is
beside this file:

- `docs/zernio/inbox-endpoints.md` — every endpoint, query param, body field and
  response field for Messages, Comments, Reviews, Mentions, Contacts, Custom
  Fields, Inbox Analytics, Comment Automations and Sequences.
- `docs/zernio/webhook-events.md` — every webhook event with its whole payload.

**What this is and is not.** It is what the SPEC says. Only the calls
`app/lib/publisher.ts` already makes (list conversations, list/send messages,
mark read, list comments) have been seen working against the live account.
Every other shape here is unverified until one real payload has been read —
the rule in CLAUDE.md. WhatsApp is parked (21 Sep 2026): the owner is not sure
the number is a business number.

## 1. The whole API by tag

API Keys 4 · Account Groups 4 · Account Settings 9 · Accounts 16 · Ad Accounts
46 · Ad Audiences 7 · Ad Campaigns 50 · Ad Creatives 18 · Ad Insights 10 · Ad
Library 1 · Ad Targeting 5 · Analytics 26 · Blogs 10 · Broadcasts 10 · Business
Agent 55 · Calls 3 · **Comment Automations 6** · **Comments 15** · Connect 57 ·
Connected Apps 2 · **Contacts 7** · Conversions 14 · **Custom Fields 6** ·
Discord 24 · GMB (attributes, menus, location, media, place actions, reviews,
services, verifications) 25 · **Inbox Analytics 7** · Instagram 5 · Invites 1 ·
Lead Gen 7 · LinkedIn Mentions 1 · Logs 1 · Media 1 · **Mentions 2** ·
**Messages 16** · Messaging Ads 3 · Phone Numbers 28 · Posts 10 · Products 3 ·
Profiles 5 · Queue 6 · Reach and Frequency 4 · Reddit Search 2 · **Reviews 3** ·
SMS 22 · **Sequences 10** · Slack 1 · Tools 1 · Tracking Tags 10 · Twitter
Engagement 8 · Usage 6 · Users 2 · Validate 4 · Verify 3 · Voice 18 ·
**Webhooks 7** · WhatsApp (calling, flows, numbers, sandbox, templates, core)
92 · Workflows 14. Bold = the social inbox. The inbox needs Zernio's Inbox addon.

## 2. Direct messages (tag: Messages)

| Call | What it gives |
|---|---|
| `GET /v1/inbox/conversations` | Every DM thread across connected accounts. Filters: `profileId`, `platform` (facebook, instagram, twitter, bluesky, reddit, telegram, whatsapp), `status` (active/archived), `accountId`, `sortOrder`, `limit` (50), `cursor`. |
| `GET /v1/inbox/conversations/search` | `query` matches message text AND the contact's name, username or phone. `direction` incoming/outgoing. Searchable: facebook, instagram, telegram, whatsapp, sms, slack. Returns up to 3 matching messages per thread. |
| `GET /v1/inbox/conversations/{id}?accountId=` | One thread: participants, last message, `instagramProfile`, ad-click `metadata`. |
| `GET …/{id}/messages?accountId=` | The messages, 100 a page, `sortOrder` asc/desc, `cursor`. |
| `POST …/{id}/messages` | Reply: text, attachment, quick replies, buttons, templates; `Idempotency-Key` header. |
| `POST /v1/inbox/conversations` | START a DM — **X, Bluesky, Reddit, WhatsApp, SMS, Slack only. Not Instagram, not Facebook**: Meta lets a business answer, never open. |
| `POST …/{id}/read` | Clear the unread count (in the spec now; `publisher.ts` called it "undocumented"). |
| `PUT …/{id}` | Archive / activate. |
| `PATCH` / `DELETE …/messages/{messageId}` | Edit / unsend. |
| `POST …/typing`, `…/reactions`, `…/thread-control` | Typing dots, emoji, hand a WhatsApp thread to or from Meta's agent. |
| `GET …/messages/{messageId}/attachments/{index}` | A working link to an attachment (Meta's own links expire). |

**On a conversation row:** `participantId`, `participantName`,
`participantPicture`, `lastMessage`, `updatedTime`, `unreadCount`, `status`,
`url` (open it on the platform), and for Instagram `instagramProfile`
{`isFollower`, `isFollowing`, `followerCount`, `isVerified`, `fetchedAt`}.
`participantUsername` is on the SEARCH result and on webhooks, not on the list row.

**On a message:** `direction` (incoming/outgoing), `message`, `senderId`,
`senderName`, `createdAt`, `attachments[]` (image, video, audio, file, sticker,
share, template; `originalType` says ig_reel / ig_story / story_mention),
`storyReply`, `isStoryMention`, edits and deletes with history,
**`deliveryStatus` (sent, delivered, read, failed), `deliveredAt`, `readAt`,
`sentAt`**, `reactions[]`, `sentVia` (human, api, broadcast, sequence, workflow,
comment_automation).

**Where the thread came from — `metadata`:** `meta_ad_id`, `meta_ad_source`
(ADS, SHORTLINK, IGME-SOURCE-LINK), `meta_ad_type`, **`meta_ad_ref`** (the `ref`
on an `ig.me/m/<handle>?ref=…` link), ad title / photo / video / post / product.
Captured once, on the first inbound message after the click.

## 3. Comments, reviews, mentions

- **Comments (15):** list across posts or for one post; reply; delete; edit;
  moderate; hide / unhide; pin / unpin; like / unlike a comment or a post;
  **private-reply** (answer a public comment in the DMs — the one way to reach
  an Instagram commenter's inbox first).
- **Reviews (3):** list (Google Business, Facebook), reply, delete the reply.
- **Mentions (2):** list, reply.

## 4. Contacts and custom fields — Zernio's own CRM

`GET/POST /v1/contacts`, one contact, its channels, bulk create, tags,
`isSubscribed`, `isBlocked`, `notes`, **`lastMessageSentAt`,
`lastMessageReceivedAt`, `messagesSentCount`, `messagesReceivedCount`**,
`customFields` (set one with `PUT /v1/contacts/{id}/fields/{slug}`), and
`platformIdentifier` / `displayIdentifier`. Search is on name, email and
company — not phone. Every inbox webhook carries the sender's `contactId`.

## 5. Inbox analytics (7)

`/v1/analytics/inbox/volume` · `/heatmap` · `/source-breakdown` ·
`/response-time` · `/top-accounts` · `/conversations` (sort by lastMessageAt,
firstMessageAt, totalMessages, received, sent, read, failed) ·
`/conversations/{id}`. All take `fromDate` (required), `toDate`, `profileId`,
`platform`.

## 6. Automation Zernio can run itself

Comment Automations (keyword on a comment → DM), Sequences (timed DM steps with
enrol / unenrol), Broadcasts, Workflows. **Not used, on purpose:** the
blueprint's rule is that every prospect-facing message is a person's to write;
the dashboard only reminds.

## 7. Webhook events (53) — the inbox ones

`message.received` · `message.sent` · `message.edited` · `message.deleted` ·
`message.delivered` · **`message.read`** · `message.failed` ·
`reaction.received` · **`referral.received`** · `conversation.started` ·
`conversation.control_changed` (WhatsApp) · `comment.received` · `review.new` ·
`review.updated` · `lead.received` (Meta lead forms) · `call.received` /
`call.ended` / `call.failed` · `whatsapp.automatic_event` (Meta detected
LeadSubmitted or Purchase, with currency and value).

`message.received` carries: `message` {`text`, `direction`, `platform`,
`sentAt`, `isRead`, `attachments`}, **`sender` {`id`, `name`, `username`,
`picture`, `contactId`, `instagramProfile`}**, `conversation` {`id`,
`participantUsername`, `participantName`}, `account` {`accountId`, `profileId`,
`platform`, `username`}, `metadata` {`quickReplyPayload`, `postbackPayload`,
`quotedMessageId`, `referral`}. `message.read` / `.delivered` carry the message
and a `statusAt`; read receipts exist for Instagram, Facebook, WhatsApp,
Telegram and SMS.

Today `app/lib/zernio-webhook-core.ts` folds all of these into one action —
"the Inbox page is out of date" — and reads none of the sender or the text.

## 8. What the acquisition scanner can know, source by source

| Signal (blueprint points) | Email — scanned today | Instagram DM — Zernio | The app itself |
|---|---|---|---|
| **Reply (+20)** | LIVE 21 Sep 2026: mail from a prospect's address or own domain, to or cc hello@ / contact@ / tech@ | `message.received`, `direction: incoming`, `sender.username` = the prospect's handle, on MD Media's own account | — |
| **Seen, no reply (0)** | not knowable | `message.read` on our outgoing DM | — |
| **Link click (+15)** | — | `referral.received` / `metadata.meta_ad_ref`: give each prospect `ig.me/m/<our handle>?ref=<prospect id>` | a tracked redirect on our own domain for Loom and booking links |
| **Call booked (+30)** | Google Calendar "Accepted:" / "Invitation:" mail naming the prospect | a DM a person reads as a booking — never guessed | **the app's own `bookings` table**: a booking whose customer email is a prospect's |
| **Discovery held** | Otter.ai and Read.ai meeting reports, with the attendee | — | — |
| **Proposal / contract signed** | PandaDoc and Adobe Sign "completed" mail | — | — |
| **Deposit paid** | MYOB invoice mail, and remittance advice from the prospect's domain | — | — |
| **Not interested** | a reply a person reads and marks | the same | — |
| Follows us / follower count | — | `instagramProfile.isFollower`, `followerCount` | — |

**What the 4,214 emails already scanned say** (subjects and sender domains
only, read 21 Sep 2026 from `email_ingest_log`): 7 became leads, 1,434 were
judged not a lead, 2,742 were skipped. Meeting mail is from Otter.ai (83),
Google Calendar (36) and Read.ai (21); payment mail is overwhelmingly MYOB
(210), then Amex and Shopify; contract mail is PandaDoc (10) and Adobe Sign
(8). So the tools in use are known without asking: **Google Calendar, Otter,
Read.ai, MYOB, PandaDoc, Adobe Sign.** The log keeps the subject and sender,
not the body — a past email's body is only read again by asking Gmail for it.

## 9. Rules for the scanner

1. A finding that names the prospect exactly (their address, their handle,
   their booking) is recorded as confirmed. Anything inferred from words in a
   subject line is recorded **unconfirmed — worth nothing on the score until a
   person presses Confirm** (`prospect_events.confirmed`, already in the model).
2. One real event is one line: locked on the email's Message-ID, the DM's
   message id, the booking's id.
3. The scanner never sends anything and never moves a prospect past Engaged on
   its own. Deposit paid and Contract signed are a person's to confirm: they
   make a client.
