# Zernio API 1.17.0 — extracted 2026-09-21


## TAG: __WEBHOOKS__

## WEBHOOK EVENTS

### post.scheduled
Post scheduled event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.published
Post published event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.failed
Post failed event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.partial
Post partial event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.cancelled
Post cancelled event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.recycled
Post recycled event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.scheduled|post.published|post.failed|post.partial|post.cancelled|post.recycled)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. Use it to route events by connected account (e.g. separate staging vs production endpoints). A post can span multiple accounts.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.platform.published
Post platform published event
  - `id` (required): string — Stable webhook event ID.
  - `event` (required): enum(post.platform.published|post.platform.failed|post.platform.deleted|post.tiktok.url_resolved)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string — Post-level status AT FIRE TIME. May still be `publishing` if other platforms haven't terminated; check this field rather than assuming.
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. On post.platform.* events see also the top-level `account` block.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `platform` (required): object — The specific platform that transitioned to a terminal state.
    - `name` (required): string — Platform name (e.g. `twitter`, `tiktok`, `instagram`).
    - `status` (required): enum(published|failed|deleted) — Terminal status this event fires on. Matches the event suffix.
    - `platformPostId`: string — Platform-native post id. Present on `published` and `deleted`, absent on `failed`.
    - `publishedUrl`: string — Public URL to the platform-side post. Present on `published` (when the platform exposes one and it is not a draft) and on `deleted` (when one was recorded at publish time).
    - `error`: string — Error message from the platform. Present on `failed` only.
    - `deletedAt`: string — When the platform-side deletion was detected by Zernio sync (ISO 8601). Present only on `post.platform.deleted`.
  - `account` (required): object — The connected account the platform-write went through.
    - `accountId` (required): string
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.platform.failed
Post platform failed event
  - `id` (required): string — Stable webhook event ID.
  - `event` (required): enum(post.platform.published|post.platform.failed|post.platform.deleted|post.tiktok.url_resolved)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string — Post-level status AT FIRE TIME. May still be `publishing` if other platforms haven't terminated; check this field rather than assuming.
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. On post.platform.* events see also the top-level `account` block.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `platform` (required): object — The specific platform that transitioned to a terminal state.
    - `name` (required): string — Platform name (e.g. `twitter`, `tiktok`, `instagram`).
    - `status` (required): enum(published|failed|deleted) — Terminal status this event fires on. Matches the event suffix.
    - `platformPostId`: string — Platform-native post id. Present on `published` and `deleted`, absent on `failed`.
    - `publishedUrl`: string — Public URL to the platform-side post. Present on `published` (when the platform exposes one and it is not a draft) and on `deleted` (when one was recorded at publish time).
    - `error`: string — Error message from the platform. Present on `failed` only.
    - `deletedAt`: string — When the platform-side deletion was detected by Zernio sync (ISO 8601). Present only on `post.platform.deleted`.
  - `account` (required): object — The connected account the platform-write went through.
    - `accountId` (required): string
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.platform.deleted
Post platform deleted event
  - `id` (required): string — Stable webhook event ID.
  - `event` (required): enum(post.platform.published|post.platform.failed|post.platform.deleted|post.tiktok.url_resolved)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string — Post-level status AT FIRE TIME. May still be `publishing` if other platforms haven't terminated; check this field rather than assuming.
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. On post.platform.* events see also the top-level `account` block.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `platform` (required): object — The specific platform that transitioned to a terminal state.
    - `name` (required): string — Platform name (e.g. `twitter`, `tiktok`, `instagram`).
    - `status` (required): enum(published|failed|deleted) — Terminal status this event fires on. Matches the event suffix.
    - `platformPostId`: string — Platform-native post id. Present on `published` and `deleted`, absent on `failed`.
    - `publishedUrl`: string — Public URL to the platform-side post. Present on `published` (when the platform exposes one and it is not a draft) and on `deleted` (when one was recorded at publish time).
    - `error`: string — Error message from the platform. Present on `failed` only.
    - `deletedAt`: string — When the platform-side deletion was detected by Zernio sync (ISO 8601). Present only on `post.platform.deleted`.
  - `account` (required): object — The connected account the platform-write went through.
    - `accountId` (required): string
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.tiktok.url_resolved
TikTok post URL resolved event
  - `id` (required): string — Stable webhook event ID.
  - `event` (required): enum(post.platform.published|post.platform.failed|post.platform.deleted|post.tiktok.url_resolved)
  - `post` (required): object
    - `id` (required): string
    - `content` (required): string
    - `status` (required): string — Post-level status AT FIRE TIME. May still be `publishing` if other platforms haven't terminated; check this field rather than assuming.
    - `scheduledFor` (required): string
    - `publishedAt`: string
    - `platforms` (required): object[]
      - `platform` (required): string
      - `status` (required): string
      - `accountId`: string — SocialAccount id this platform target published through. On post.platform.* events see also the top-level `account` block.
      - `platformPostId`: string
      - `publishedUrl`: string
      - `error`: string
    - `metadata`: object — The free-form `metadata` object supplied when the post was created, echoed back so you can map events onto your own records. Omitted when the post was created without it.
  - `platform` (required): object — The specific platform that transitioned to a terminal state.
    - `name` (required): string — Platform name (e.g. `twitter`, `tiktok`, `instagram`).
    - `status` (required): enum(published|failed|deleted) — Terminal status this event fires on. Matches the event suffix.
    - `platformPostId`: string — Platform-native post id. Present on `published` and `deleted`, absent on `failed`.
    - `publishedUrl`: string — Public URL to the platform-side post. Present on `published` (when the platform exposes one and it is not a draft) and on `deleted` (when one was recorded at publish time).
    - `error`: string — Error message from the platform. Present on `failed` only.
    - `deletedAt`: string — When the platform-side deletion was detected by Zernio sync (ISO 8601). Present only on `post.platform.deleted`.
  - `account` (required): object — The connected account the platform-write went through.
    - `accountId` (required): string
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### account.connected
Account connected event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(account.connected)
  - `account` (required): object
    - `accountId` (required): string — The account's unique identifier (same as used in /v1/accounts/{accountId})
    - `profileId` (required): string — The profile's unique identifier this account belongs to
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### account.disconnected
Account disconnected event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(account.disconnected)
  - `account` (required): object
    - `accountId` (required): string — The account's unique identifier (same as used in /v1/accounts/{accountId})
    - `profileId` (required): string — The profile's unique identifier this account belongs to
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
    - `disconnectionType` (required): enum(intentional|unintentional) — Whether the disconnection was intentional (user action) or unintentional (token expired/revoked)
    - `reason` (required): string — Human-readable reason for the disconnection
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### account.ads.initial_sync_completed
Ads initial sync completed event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(account.ads.initial_sync_completed)
  - `account` (required): object
    - `accountId` (required): string — The account's unique identifier (same as used in /v1/accounts/{accountId})
    - `profileId` (required): string — The profile's unique identifier this account belongs to
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
    - `platformUserId`: string — The platform-side account/ad-account ID (e.g. Meta ad account ID).
    - `profilePicture`: string — URL of the account's profile picture, when available.
    - `platformAdAccountId`: string — When the consumer scoped the connect call to a single ad account, this echoes that ID back so the webhook can be correlated to the originating connect request without consulting the consumer's DB. Meta uses the `act_*` s
    - `platformAdAccountIds`: string[] — Every ad-account ID that the connected token could see at discovery time. Useful for "we synced ads from these accounts" UX without a follow-up API call. Empty array when the token had no ad-account visibility.
  - `sync` (required): object — Summary of the initial ads sync backfill results.
    - `status` (required): enum(success|failure) — Overall outcome of the initial sync.
    - `totalAds` (required): integer — Total number of ads discovered for backfill.
    - `synced` (required): integer — Number of ads successfully synced.
    - `failed` (required): integer — Number of ads that failed to sync.
    - `error`: string — Free-form error message from the platform (typically Meta's Marketing API). Truncated to ~2KB. Present when `status` is `failure` (and sometimes on `success` when discovery saw zero ad accounts). For UX branching prefer 
    - `errorCode`: string — Platform-native error code if parsed (e.g. Meta `190`, `10`, `200`).
    - `errorSubcode`: string — Platform-native error subcode if parsed.
    - `errorCategory`: enum(token_invalid|permission_denied|no_ad_accounts|rate_limited|discovery_failed|unknown) — Stable category for UX branching. New values may be added; existing ones are stable. Mapping: - `token_invalid`: access token is expired or revoked. Reconnect. - `permission_denied`: token lacks required scope, or the us
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### analytics.synced
Analytics synced event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(analytics.synced)
  - `account` (required): object
    - `accountId` (required): string — The account's unique identifier (same as used in /v1/accounts/{accountId})
    - `profileId` (required): string — The profile this account belongs to
    - `platform` (required): string
    - `username` (required): string
  - `sync` (required): object — Summary of the analytics sync cycle that completed.
    - `syncedAt` (required): string — When the cycle COMPLETED. Not a join key for the delta feed: the rows a cycle produces carry a `syncedAt` stamped when the cycle STARTED, which is measured at around one second earlier at the median and up to a couple of
    - `postsUpdated` (required): integer — Post records created or modified by this cycle. Not the number of delta feed rows the cycle produced, which the syncer does not report, so a cycle with a non-zero `postsUpdated` can still yield an empty delta page.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued).

### message.received
Message received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(message.received)
  - `message` (required): object
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms|twitter|bluesky|reddit|slack|tiktok)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio, share)
      - `originalType`: string — Instagram and Facebook only, and present only when it differs from `type`. Meta's own attachment type before Zernio normalized it: `ig_reel` and `reel` become `video`, while `ig_post`, `post`, `ig_story` and `story_menti
      - `url` (required): string — Where to fetch the attachment. **The contract differs by platform.** - **WhatsApp**: points at `GET /v1/whatsapp/media/{mediaId}`, an authenticated Zernio endpoint. You MUST send `Authorization: Bearer <your API key>`; f
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (omitted for outgoing/business sender).
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data for the sender. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
    - `sentVia`: enum(human|api|broadcast|sequence|workflow|comment_automation|bulk-api|) — Which Zernio surface produced the message. Always present and always `null` on this event, since nobody on our side produced an inbound message; it is only informative on `message.sent`, which documents the vocabulary.
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `metadata`: object|null — Platform-specific message context (present when the message is a quick reply tap, postback button tap, inline keyboard callback, a quote-reply to an earlier message, a WhatsApp inbound that Meta Business Agent is answeri
    - `standby`: boolean — WhatsApp only. true when this inbound arrived while Meta Business Agent held the conversation: the agent answers it, and Zernio only observes. Sending a reply takes control back. See conversation.control_changed.
    - `quotedMessageId`: string — Raw platform envelope id (WhatsApp `context.id`; Instagram and Facebook Messenger `reply_to.mid`) of the message this one is a quote-reply to, forwarded verbatim. It may not equal the stored id of that message (see `quot
    - `quotedMessage`: object — Zernio's own ids for the message this one quote-replies to. Present only when that message is stored; WhatsApp only today.
      - `messageId`: string — Internal id of the stored quoted message.
      - `platformMessageId`: string — The STORED message's platform id (what message.sent and list-messages return). Can differ from quotedMessageId, because Meta renders one message under a different wamid per perspective.
    - `quickReplyPayload`: string — Payload from a quick reply tap (Facebook/Instagram Messenger).
    - `postbackPayload`: string — Payload from a postback button tap (Facebook/Instagram Messenger).
    - `postbackTitle`: string — Title of the tapped postback button (Facebook/Instagram Messenger).
    - `callbackData`: string — Callback data from an inline keyboard button tap (Telegram).
    - `interactiveType`: enum(button_reply|list_reply|nfm_reply) — WhatsApp only. Which kind of interactive reply the user sent: `button_reply` (tap on an interactive button), `list_reply` (tap on a list row), or `nfm_reply` (a WhatsApp Flow submission or an `address_message` submission
    - `interactiveId`: string — WhatsApp only. The `id` of the tapped button or list row, matching the `id` you supplied when the message was sent. Not set for Flow responses.
    - `buttonPayload`: string — WhatsApp only. Payload attached to a tapped template button. Template buttons emit a plain `button` webhook (not an interactive reply), so `interactiveType` is empty while this field is populated.
    - `flowResponseJson`: string — WhatsApp only. Raw `nfm_reply.response_json` string returned by a Flow submission. Useful if you need the exact wire payload; for typed access use `flowResponseData` instead.
    - `flowResponseData`: object — WhatsApp only. Parsed Flow response JSON. Populated when `flowResponseJson` is valid JSON; otherwise omitted. Keys and value types depend on the specific Flow that was submitted. An `address_message` submission (`nfmRepl
    - `nfmReplyName`: string — WhatsApp only. `nfm_reply.name` as Meta sent it, e.g. `flow` or `address_message`. Address submissions share the `nfm_reply` envelope with Flow submissions and are otherwise indistinguishable in `flowResponseData`; use t
    - `order`: object — WhatsApp only. Cart submitted by the user from a commerce message (catalog, product, or product-list message). Meta's `order` object forwarded verbatim.
      - `catalog_id`: string — Meta catalog the ordered products belong to.
      - `text`: string — Optional free-text note the user attached to the cart.
      - `product_items`: object[]
    - `referredProduct`: object — WhatsApp only. The product the user is asking about. Set when an inbound text carries Meta's `context.referred_product` (the user tapped "Message business" on a product). Forwarded verbatim.
      - `catalog_id`: string — Meta catalog the product belongs to.
      - `product_retailer_id`: string — Retailer ID (SKU) of the product being asked about.
    - `location`: object — WhatsApp only. The location pin the user shared, forwarded verbatim from Meta. The message `text` is only the emoji preview (`📍 <name>`); the coordinates live here.
      - `latitude`: number — Latitude in decimal degrees.
      - `longitude`: number — Longitude in decimal degrees.
      - `name`: string — Location name, when the user shared a named place.
      - `address`: string — Street address, when Meta sends one.
    - `contacts`: object[] — WhatsApp only. Contact cards the user shared, forwarded verbatim from Meta. Read `contactsOrigin` before treating any number here as the sender's own.
    - `contactsOrigin`: enum(contact_request|other) — WhatsApp only. How the contact card was shared. `contact_request` means the user tapped a `request_contact_info` button, so the number is their own and consented. `other` means they picked a card from their address book:
    - `storyReply`: object — Instagram only. Populated when an IG user replies to one of the account's stories (Meta `messaging_story_replies`). Mutually exclusive in practice with `isStoryMention`.
      - `storyId` (required): string — The Instagram story ID the user replied to.
      - `storyUrl`: string — Meta CDN URL for the story media. Expires approximately 24 hours after the story posted; consumers must fetch promptly or treat 404s as expected.
    - `isStoryMention`: boolean — Instagram only. True when the message was generated by an IG user mentioning the account in their own story (`story_mention` attachment type). Mutually exclusive in practice with `storyReply`.
    - `referral`: object|null — Click attribution forwarded verbatim from Meta. Populated only on the FIRST inbound message after the click; absent on subsequent messages of the same conversation. On Instagram and Messenger a RETURNING click also attac
      - `ctwa_clid`: string — Meta's GCLID-equivalent click identifier.
      - `source_id`: string
      - `source_type`: string
      - `source_url`: string
      - `headline`: string
      - `body`: string
      - `media_type`: string
      - `image_url`: string
      - `video_url`: string
      - `thumbnail_url`: string
      - `ad_id`: string — Facebook Messenger CTM / Instagram CTD only. The Meta ad ID the user clicked to start the conversation.
      - `ref`: string — The `ref` parameter passed through from the Meta ad creative or from an ig.me / m.me link. Instagram / Facebook Messenger only.
      - `source`: string — Meta-supplied source identifier (`ADS` for ad clicks; `SHORTLINK`, `SHORTLINKS` or `IGME-SOURCE-LINK` for ref links). Instagram / Facebook Messenger only.
      - `type`: string — Meta-supplied referral type (e.g. `OPEN_THREAD`). Instagram / Facebook Messenger only.
      - `referer_uri`: string — URI of the originating site, when Meta supplies one (m.me links opened from the web). Facebook Messenger only.
      - `ads_context_data`: object — Snapshot of the ad's public context at click time. Facebook Messenger CTM / Instagram CTD only.
    - `unsupported`: object — WhatsApp only. Meta's own reason this message has no renderable body. Present when Meta attached an error to the inbound payload; in practice the `unsupported`, `errors` and `unknown` types (code 131051: message type cur
      - `code`: integer — Meta's numeric error code (e.g. 131051).
      - `title`: string — Meta's short error title.
      - `details`: string — Meta's human-readable error detail string.
    - `noRenderableContent`: boolean — Instagram / Facebook Messenger only. Set when the message carries nothing an integrator can render (a `template` attachment with no text and no parseable content, or Meta's own `is_unsupported` flag). Sibling of `unsuppo
    - `tiktokMessageType`: string — TikTok only. The message type as TikTok reports it, forwarded verbatim (for example image, video, sticker, share_post, emoji, reaction, template). Present on every TikTok DM that is not plain text; those arrive with text
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### conversation.control_changed
Conversation control changed event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(conversation.control_changed)
  - `conversation` (required): object — The conversation object included in conversation lifecycle webhook payloads (conversation.started, conversation.control_changed).
    - `id` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|twitter|reddit|bluesky|sms|slack|tiktok)
    - `platformConversationId` (required): string
    - `participantId`: string — Contact's platform identifier (IGSID, PSID, wa_id, etc.)
    - `participantName` (required): string
    - `participantUsername`: string — Contact's handle when the platform exposes one
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection (same join used by message.*, reaction.received, and call.* webhooks). Best-effort: omitted
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `control` (required): object
    - `owner` (required): enum(app|ai_agent|other) — Who answers now. ai_agent: Meta Business Agent; app: you; other: another partner app on the number.
    - `previousOwner` (required): enum(app|ai_agent|other|) — Owner before this change, null when the thread had never been agent-handled.
    - `metadata`: string — Free-form string the transferring app attached to the handover, forwarded verbatim.
  - `changedAt` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### conversation.started
Conversation started event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(conversation.started)
  - `conversation` (required): object — The conversation object included in conversation lifecycle webhook payloads (conversation.started, conversation.control_changed).
    - `id` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|twitter|reddit|bluesky|sms|slack|tiktok)
    - `platformConversationId` (required): string
    - `participantId`: string — Contact's platform identifier (IGSID, PSID, wa_id, etc.)
    - `participantName` (required): string
    - `participantUsername`: string — Contact's handle when the platform exposes one
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection (same join used by message.*, reaction.received, and call.* webhooks). Best-effort: omitted
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `startedAt` (required): string — When the conversation document was created.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### call.received
Call received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(call.received)
  - `call` (required): object
    - `id`: string — Internal Zernio Call doc id
    - `metaCallId`: string|null — Meta wacid.* call id when known
    - `accountId`: string
    - `phoneNumberId`: string — Meta phone_number_id
    - `direction`: enum(inbound|outbound)
    - `from`: string — Consumer wa_id / E.164
    - `to`: string — Business number (E.164)
    - `forwardTo`: string — Destination snapshot at routing time
    - `contactId`: string
    - `conversationId`: string
    - `startedAt`: string
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### call.ended
Call ended event
  - `id` (required): string
  - `event` (required): enum(call.ended)
  - `call` (required): object
    - `id`: string
    - `metaCallId`: string|null
    - `accountId`: string
    - `phoneNumberId`: string
    - `direction`: enum(inbound|outbound)
    - `from`: string
    - `to`: string
    - `startedAt`: string
    - `endedAt`: string
    - `durationSeconds`: integer
    - `endReason`: enum(hangup|no_answer|rejected|error)
    - `hangupCause`: string|null — Raw carrier hangup cause behind endReason (e.g. normal_clearing, call_rejected, not_found). Null when the carrier reported none.
    - `sipHangupCause`: string|null — SIP response code that ended the call when SIP-signalled (e.g. '403', '486', '603'). endReason collapses all three to 'rejected', so this is what separates a refused destination from a busy line. Null on non-SIP legs.
    - `isVoicemail`: boolean — True when the inbound call was handled by voicemail, whether scheduled or because the forward did not connect.
    - `callErrors`: object[] — Failures recorded on the call up to hangup (bridge failed, dial failed, recording error). Empty on a clean call. `message` is free-form diagnostic text and is not stable, do not parse it. `code` is 0 unless a provider co
      - `code`: integer
      - `message`: string
    - `recordingUrl`: string
    - `recordingExpiresAt`: string
    - `billing`: object
      - `metaCostUSD`: number — Meta per-minute charge. Billed by Meta DIRECTLY to your WhatsApp Business Account payment method (your separate Meta invoice). Zernio does NOT charge this. Display only.
      - `telnyxCostUSD`: number
      - `recordingCostUSD`: number
      - `billableCostUSD`: number — The amount Zernio bills you = Telnyx leg + recording. Excludes Meta (billed by Meta directly).
      - `totalCostUSD`: number — Full economic cost incl. the Meta portion you pay directly (Meta + Telnyx + recording). Display only, not the Zernio-billed amount.
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### call.failed
Call failed event
  - `id` (required): string
  - `event` (required): enum(call.failed)
  - `call` (required): object
    - `id`: string
    - `metaCallId`: string|null
    - `accountId`: string
    - `phoneNumberId`: string
    - `direction`: enum(inbound|outbound)
    - `from`: string
    - `to`: string
    - `failedAt`: string
    - `error`: object
      - `code`: integer
      - `message`: string
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### call.permission_request
Call permission request reply event
  - `id` (required): string
  - `event` (required): enum(call.permission_request)
  - `permission` (required): object
    - `from`: string — Consumer wa_id who replied
    - `response`: enum(accept|reject)
    - `isPermanent`: boolean
    - `expirationTimestamp`: string — Present only when temporary
    - `responseSource`: string — Meta's response source, typically `user_action`
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.sent
Message sent event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(message.sent)
  - `message` (required): object
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|twitter|reddit|bluesky|slack|tiktok) — Every platform whose outgoing messages Zernio observes. sms is absent on purpose: its carrier receipts update delivery status and never raise message.sent.
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio, share)
      - `originalType`: string — Instagram and Facebook only, and present only when it differs from `type`. Meta's own attachment type before Zernio normalized it. See the same field on message.received for the full mapping.
      - `url` (required): string — Where to fetch the attachment. For outgoing messages this is the media URL as sent, so for WhatsApp it is the URL you supplied when publishing (WhatsApp sends media by link), not a Zernio endpoint, and it needs no Zernio
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object — **On this event the sender is your own business, not the person you are talking to.** `id` is the Zernio account id and `name`, `username` and `picture` are that connected account's own profile. Do not read these to name
      - `id` (required): string — The Zernio account id of the connected account that sent the message, not a contact id.
      - `contactId`: string — Always omitted on this event: the sender is the business, not a contact. Use conversation.contactId to join back to the CRM Contact.
      - `name`: string — Display name of your connected account.
      - `username`: string — Username of your connected account.
      - `picture`: string — Profile picture of your connected account.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
    - `source`: enum(whatsapp_business_app|cloud_api|meta_business_agent) — WhatsApp send origin. whatsapp_business_app when sent from the WhatsApp Business phone app on a Coexistence number; cloud_api when sent through Zernio (dashboard, API, or broadcasts); meta_business_agent when Meta Busine
    - `sentVia`: enum(human|api|broadcast|sequence|workflow|comment_automation|bulk-api|) — Which Zernio surface produced this message: `human` (an operator in the Zernio inbox), `api` (a call to this API), `broadcast`, `sequence`, `workflow`, `comment_automation`, or `bulk-api` (POST /v1/whatsapp/bulk). Same v
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `metadata`: object — Platform-specific context for the sent message: a quote-reply reference, a WhatsApp location pin, WhatsApp contact cards or the TikTok message type. The key is present only when the send carried some context, and absent 
    - `location`: object — WhatsApp only. The location pin this message carries, in the same shape the inbox send API accepts. Present on API sends that passed `location`, and on Coexistence echoes of a pin shared from the WhatsApp Business app. T
      - `latitude`: number — Latitude in decimal degrees.
      - `longitude`: number — Longitude in decimal degrees.
      - `name`: string — Location name, when one was given.
      - `address`: string — Street address, when one was given.
    - `contacts`: object[] — WhatsApp only. The contact cards this message carries. On API sends this is the `contacts` array exactly as given to the inbox send API (`name`, `phones[].phone` / `type`, `emails[]`); on Coexistence echoes of a card sha
    - `quotedMessageId`: string — `platformMessageId` of the message this send is a quote-reply to. Present when the reply was sent through Zernio with `replyTo` on the inbox send API (WhatsApp and Telegram). A WhatsApp API send fires its `message.sent` 
    - `threadTs`: string — Slack only. Parent thread ts of the sent message. Pass it back as `replyTo` on the inbox send API to keep replying inside the thread.
    - `tiktokMessageType`: string — TikTok only. The message type as TikTok reports it, forwarded verbatim (for example image, video, sticker, share_post, emoji, reaction, template). Present on every TikTok DM that is not plain text; those arrive with text
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.edited
Message edited event
  - `id` (required): string
  - `event` (required): enum(message.edited)
  - `message` (required): object — The message object included in inbox webhook payloads.
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content (retained on deleted messages for API consumers; Zernio dashboard UI hides this)
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio)
      - `url` (required): string — Where to fetch the attachment. The contract depends on direction and platform: inbound WhatsApp media points at the authenticated `GET /v1/whatsapp/media/{mediaId}` and requires `Authorization: Bearer <your API key>`, wh
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`. For other platforms, the platform's own user ID.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (joined via the ContactChannel mapping). Lets integrators link a message straight to a Contact without a follow-up Contacts API call. Omitted when the sender isn't a
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
  - `editHistory` (required): object[] — Prior versions of the message, oldest first.
    - `text` (required): string|null
    - `attachments` (required): object[]
      - `type`: string
      - `url`: string
      - `payload`: object
    - `editedAt` (required): string
  - `editCount` (required): integer — Total number of edits applied to this message.
  - `editedAt` (required): string — When the most recent edit happened.
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.deleted
Message deleted event
  - `id` (required): string
  - `event` (required): enum(message.deleted)
  - `message` (required): object — The message object included in inbox webhook payloads.
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content (retained on deleted messages for API consumers; Zernio dashboard UI hides this)
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio)
      - `url` (required): string — Where to fetch the attachment. The contract depends on direction and platform: inbound WhatsApp media points at the authenticated `GET /v1/whatsapp/media/{mediaId}` and requires `Authorization: Bearer <your API key>`, wh
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`. For other platforms, the platform's own user ID.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (joined via the ContactChannel mapping). Lets integrators link a message straight to a Contact without a follow-up Contacts API call. Omitted when the sender isn't a
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
  - `deletedAt` (required): string
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.delivered
Message delivered event
  - `id` (required): string
  - `event` (required): enum(message.delivered|message.read|message.failed)
  - `message` (required): object — The message object included in inbox webhook payloads.
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content (retained on deleted messages for API consumers; Zernio dashboard UI hides this)
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio)
      - `url` (required): string — Where to fetch the attachment. The contract depends on direction and platform: inbound WhatsApp media points at the authenticated `GET /v1/whatsapp/media/{mediaId}` and requires `Authorization: Bearer <your API key>`, wh
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`. For other platforms, the platform's own user ID.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (joined via the ContactChannel mapping). Lets integrators link a message straight to a Contact without a follow-up Contacts API call. Omitted when the sender isn't a
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
  - `statusAt` (required): string — When the platform reported this status.
  - `error`: object|null — Populated only on message.failed.
    - `code`: integer
    - `title`: string
    - `message`: string
    - `details`: string — Platform's extended detail for `code` (WhatsApp: Meta's `error_data.details`), when the platform sent one. Absent on SMS.
    - `href`: string — Link to the platform's documentation for `code`, when the platform sent one.
    - `explanation`: string|null — Plain-language translation of `code` (e.g. for 131026, that the recipient has likely opted out of marketing messages while utility templates are unaffected, or for 131031, that Meta restricted the WhatsApp Business Accou
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.read
Message read event
  - `id` (required): string
  - `event` (required): enum(message.delivered|message.read|message.failed)
  - `message` (required): object — The message object included in inbox webhook payloads.
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content (retained on deleted messages for API consumers; Zernio dashboard UI hides this)
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio)
      - `url` (required): string — Where to fetch the attachment. The contract depends on direction and platform: inbound WhatsApp media points at the authenticated `GET /v1/whatsapp/media/{mediaId}` and requires `Authorization: Bearer <your API key>`, wh
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`. For other platforms, the platform's own user ID.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (joined via the ContactChannel mapping). Lets integrators link a message straight to a Contact without a follow-up Contacts API call. Omitted when the sender isn't a
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
  - `statusAt` (required): string — When the platform reported this status.
  - `error`: object|null — Populated only on message.failed.
    - `code`: integer
    - `title`: string
    - `message`: string
    - `details`: string — Platform's extended detail for `code` (WhatsApp: Meta's `error_data.details`), when the platform sent one. Absent on SMS.
    - `href`: string — Link to the platform's documentation for `code`, when the platform sent one.
    - `explanation`: string|null — Plain-language translation of `code` (e.g. for 131026, that the recipient has likely opted out of marketing messages while utility templates are unaffected, or for 131031, that Meta restricted the WhatsApp Business Accou
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### message.failed
Message delivery failed event
  - `id` (required): string
  - `event` (required): enum(message.delivered|message.read|message.failed)
  - `message` (required): object — The message object included in inbox webhook payloads.
    - `id` (required): string — Internal message ID
    - `conversationId` (required): string — Internal conversation ID
    - `platform` (required): enum(instagram|facebook|telegram|whatsapp|sms)
    - `platformMessageId` (required): string — Platform's message ID
    - `direction` (required): enum(incoming|outgoing)
    - `text` (required): string|null — Message text content (retained on deleted messages for API consumers; Zernio dashboard UI hides this)
    - `attachments` (required): object[]
      - `type` (required): string — Attachment type (image, video, file, sticker, audio)
      - `url` (required): string — Where to fetch the attachment. The contract depends on direction and platform: inbound WhatsApp media points at the authenticated `GET /v1/whatsapp/media/{mediaId}` and requires `Authorization: Bearer <your API key>`, wh
      - `payload`: object — Additional attachment metadata
    - `sender` (required): object
      - `id` (required): string — Sender's platform identifier. For WhatsApp this is the phone number (without leading `+`) when available, otherwise the `businessScopedUserId`. For other platforms, the platform's own user ID.
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists (joined via the ContactChannel mapping). Lets integrators link a message straight to a Contact without a follow-up Contacts API call. Omitted when the sender isn't a
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`). **Nullable during the BSUID rollout (April 2026+).** WhatsApp users who adopt a username can message businesses without exposing a phone number, so
      - `businessScopedUserId`: string — WhatsApp only. Business-scoped user ID (BSUID), Meta's canonical identifier for a WhatsApp user within your business. Present when Meta includes it in the inbound payload (rollout in progress since early April 2026). **R
      - `parentBusinessScopedUserId`: string — WhatsApp only. Parent BSUID for businesses with linked business portfolios. Omitted for standalone portfolios.
      - `whatsappUsername`: string — WhatsApp only. User's WhatsApp username (e.g. `@jane`). Not a stable identifier, because users can change it. Useful for display, not recommended as an identity anchor.
      - `instagramProfile`: object — Instagram profile data. Only present for Instagram conversations.
    - `sentAt` (required): string — When the message was sent, as reported by the platform and passed through unmodified. Full ISO 8601 date-time: Instagram and Facebook carry millisecond precision, while some platforms (for example WhatsApp and Telegram) 
    - `isRead` (required): boolean
  - `statusAt` (required): string — When the platform reported this status.
  - `error`: object|null — Populated only on message.failed.
    - `code`: integer
    - `title`: string
    - `message`: string
    - `details`: string — Platform's extended detail for `code` (WhatsApp: Meta's `error_data.details`), when the platform sent one. Absent on SMS.
    - `href`: string — Link to the platform's documentation for `code`, when the platform sent one.
    - `explanation`: string|null — Plain-language translation of `code` (e.g. for 131026, that the recipient has likely opted out of marketing messages while utility templates are unaffected, or for 131031, that Meta restricted the WhatsApp Business Accou
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### reaction.received
Reaction received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(reaction.received)
  - `reaction` (required): object
    - `emoji` (required): string — The emoji reacted with. May be an empty string when `action` is `removed` on WhatsApp (Meta does not report which emoji was removed).
    - `action` (required): enum(added|removed)
    - `messageId`: string — Internal Zernio message ID of the reacted-to message, when resolvable from the platform ID.
    - `platformMessageId` (required): string — Platform-native ID of the reacted-to message (e.g. WhatsApp wamid).
    - `sender` (required): object — Whoever added or removed the reaction. Usually the participant, but on WhatsApp, Slack, Instagram and Facebook Messenger it is the business own platform id when the business reacted from the native app or via the reactio
      - `id` (required): string
      - `contactId`: string — Zernio CRM Contact id for this sender, when one exists.
      - `name`: string
      - `username`: string
      - `picture`: string
      - `phoneNumber`: string|null — WhatsApp only. Sender's phone number in E.164 format (with leading `+`), when available.
    - `reactedAt` (required): string
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### referral.received
Referral received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(referral.received)
  - `referral` (required): object — Meta's referral object, forwarded verbatim. Same shape as `metadata.referral` on `message.received`: `ref` + `source` for ig.me / m.me links, `ad_id` + `ads_context_data` for returning Messenger ad clicks.
    - `ref`: string — The `ref` parameter of the clicked ig.me / m.me link or ad.
    - `source`: string — Meta-supplied source (`SHORTLINK`, `SHORTLINKS`, `IGME-SOURCE-LINK`, `ADS` - treat as opaque).
    - `type`: string — Meta-supplied referral type (e.g. `OPEN_THREAD`).
    - `referer_uri`: string — URI of the originating site, when Meta supplies one. Facebook Messenger only.
    - `ad_id`: string — The Meta ad ID, on returning ad clicks. Facebook Messenger only.
    - `ads_context_data`: object — Snapshot of the ad's public context at click time.
      - `ad_title`: string
      - `photo_url`: string
      - `video_url`: string
      - `post_id`: string
      - `product_id`: string
      - `flow_id`: string
  - `sender` (required): object — Who clicked - the conversation participant.
    - `id` (required): string — Platform-scoped user ID (IGSID / PSID).
    - `contactId`: string — Zernio CRM Contact id for this sender, when one exists.
  - `conversation` (required): object — The conversation context included in inbox webhook payloads.
    - `id` (required): string
    - `platformConversationId` (required): string
    - `participantId`: string
    - `participantName`: string
    - `participantUsername`: string
    - `participantPicture`: string
    - `status` (required): enum(active|archived)
    - `contactId`: string — Zernio CRM Contact ID for the participant, when one exists. Resolved by joining `participantId` to the ContactChannel collection. Best-effort: omitted when no channel matches or `participantId` is absent. Lets integrator
  - `account` (required): object — The account context included in inbox webhook payloads.
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same value as id). Canonical field so consumers can filter every webhook event on one field (e.g. route staging vs production by account). id is kept for backward compatibility.
    - `profileId`: string — Zernio profile ID this account belongs to. Use it to route or filter inbox webhooks by profile. This is the profile ID only, not its name (resolve the name via the API with this ID). Optional; omitted on the shared Whats
    - `platform` (required): string
    - `username` (required): string
    - `displayName`: string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### comment.received
Comment received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(comment.received)
  - `comment` (required): object
    - `id` (required): string — Platform comment ID
    - `postId` (required): string|null — Internal post ID (null for posts not published through Zernio)
    - `platformPostId` (required): string — Platform's post ID
    - `platform` (required): enum(instagram|facebook|threads|youtube|linkedin|bluesky|reddit|tiktok)
    - `text` (required): string — Comment text content
    - `author` (required): object
      - `id` (required): string — Author's platform ID
      - `username`: string
      - `name`: string
      - `picture`: string|null
      - `isOwnAccount`: boolean — True when this comment was authored by the connected account itself. Populated on the Instagram and Facebook realtime webhooks (Meta re-delivers the account's own replies as comments events) and on TikTok, where it is in
      - `instagramProfile`: object — Instagram only, best-effort. Present ONLY for commenters who have messaged the account before: Meta gates the follow relationship behind messaging consent, and commenting does not grant it. Absent otherwise - treat a mis
    - `createdAt` (required): string
    - `isReply` (required): boolean — Whether this is a reply to another comment
    - `parentCommentId` (required): string|null — Parent comment ID if this is a reply
    - `ad`: object — Ad context. Present only when the comment was made on paid content. Instagram: populated from the webhook payload's value.media.ad_id and value.media.ad_title. Facebook: populated via a Graph API lookup of the parent pos
      - `id`: string — Meta ad ID (Instagram only).
      - `title`: string — Ad creative title (Instagram only).
      - `promotionStatus`: string — Facebook promotion status returned by Graph API. Common values: "active" (organic post currently boosted), "ineligible" (dark post or ad creative, not promotable because it already is an ad).
    - `attachment`: object — Facebook only. Present on graphic-only comments (sticker, GIF, photo) that carry no text. URLs are ephemeral and may expire for Meta platforms (oe= expiry), so fetch promptly. Instagram comments do not support attachment
      - `type` (required): string — Attachment type: sticker, animated_image_share, or photo.
      - `imageUrl`: string — Rendered image/preview URL (from attachment.media.image.src).
      - `url`: string — Source URL (from attachment.url). For GIFs this is an l.facebook.com redirect.
  - `post` (required): object
    - `id` (required): string|null — Internal post ID (null for posts not published through Zernio)
    - `platformPostId` (required): string — Platform's post ID
    - `content` (required): string|null — Post text, from our synced copy. No platform call is made on the comment path, so null when the post was never synced.
    - `imageUrl` (required): string|null — Post thumbnail or first media item URL. Platform CDN URLs expire, fetch promptly.
    - `permalink` (required): string|null — Public URL of the post. Null when no URL was ever stored for it, for example a platform draft or a post recovered without one.
  - `account` (required): object
    - `id` (required): string — Account ID
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### review.new
Review new event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(review.new)
  - `review` (required): object — Review data shared by review.new and review.updated payloads.
    - `id` (required): string — Platform review ID (e.g. "accounts/123/locations/456/reviews/789" for Google Business Profile).
    - `platform` (required): enum(googlebusiness) — Platform the review originated on. Currently Google Business Profile only.
    - `rating` (required): integer — Star rating the reviewer gave.
    - `text` (required): string — Review text content. May be empty if the reviewer left only a rating.
    - `reviewer` (required): object
      - `id` (required): string|null — Platform reviewer ID. Null when the platform does not expose it (common on Google Business Profile anonymous reviews).
      - `name` (required): string
      - `profileImage` (required): string|null
    - `createdAt` (required): string
    - `hasReply` (required): boolean — Whether the connected account has replied to this review.
    - `reply`: object — Present when hasReply is true.
      - `text` (required): string
      - `createdAt` (required): string
  - `account` (required): object
    - `id` (required): string
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### review.updated
Review updated event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(review.updated)
  - `review` (required): object — Review data shared by review.new and review.updated payloads.
    - `id` (required): string — Platform review ID (e.g. "accounts/123/locations/456/reviews/789" for Google Business Profile).
    - `platform` (required): enum(googlebusiness) — Platform the review originated on. Currently Google Business Profile only.
    - `rating` (required): integer — Star rating the reviewer gave.
    - `text` (required): string — Review text content. May be empty if the reviewer left only a rating.
    - `reviewer` (required): object
      - `id` (required): string|null — Platform reviewer ID. Null when the platform does not expose it (common on Google Business Profile anonymous reviews).
      - `name` (required): string
      - `profileImage` (required): string|null
    - `createdAt` (required): string
    - `hasReply` (required): boolean — Whether the connected account has replied to this review.
    - `reply`: object — Present when hasReply is true.
      - `text` (required): string
      - `createdAt` (required): string
  - `account` (required): object
    - `id` (required): string
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.external.created
External post created event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.external.created|post.external.updated|post.external.deleted)
  - `post` (required): object — Native (external) post data shared by all post.external.* payloads.
    - `id` (required): string — Platform-native post ID (NOT a Zernio post ID).
    - `platform` (required): string — Platform the post lives on (e.g. "googlebusiness").
    - `accountId` (required): string — Zernio account ID the post belongs to.
    - `url` (required): string|null — Direct URL to the post on the platform, when available.
    - `content` (required): string — Post text. May be empty.
    - `mediaType` (required): string — One of image, video, gif, document, text, carousel.
    - `mediaItems` (required): object[]
      - `type` (required): enum(image|video)
      - `url` (required): string|null — 'Direct URL to the media file. Null when the platform withholds it: check mediaStatus before downloading. Instagram omits the video file for Reels it flags as containing copyrighted material (its docs name audio as the u
      - `thumbnail`: string — Cover image. Still present when url is null.
      - `mediaStatus`: enum(available|unavailable) — unavailable means the media file could not be retrieved (url is null or, for LinkedIn videos, a cover image standing in for the file). available or absent means the file is available at url (older synced items omit the f
      - `unavailableReason`: enum(platform_withheld) — Why the file is missing. platform_withheld means the platform declined to return it and retrying will not help.
    - `thumbnailUrl` (required): string|null
    - `publishedAt` (required): string
    - `mediaProductType`: string — Instagram only: the platform media product type (e.g. FEED, REELS, STORY, AD). Absent when the platform did not report it.
    - `isAiGenerated`: boolean — Instagram only: whether Instagram labeled the media as AI-generated. Absent when the platform did not report it.
    - `isSharedToFeed`: boolean — Instagram reels only: whether the reel is also shared to the main feed. Absent when the platform did not report it.
    - `mediaAudioType`: string — Instagram only: audio type of the media (MUSIC or ORIGINAL_SOUND). Absent when the platform did not report it.
    - `source` (required): enum(external) — Always "external". Distinguishes these from Zernio-originated post.* events.
    - `deletedAt`: string|null — Detection time of deletion. Present on post.external.deleted; null/absent otherwise.
  - `account` (required): object
    - `id` (required): string
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.external.updated
External post updated event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.external.created|post.external.updated|post.external.deleted)
  - `post` (required): object — Native (external) post data shared by all post.external.* payloads.
    - `id` (required): string — Platform-native post ID (NOT a Zernio post ID).
    - `platform` (required): string — Platform the post lives on (e.g. "googlebusiness").
    - `accountId` (required): string — Zernio account ID the post belongs to.
    - `url` (required): string|null — Direct URL to the post on the platform, when available.
    - `content` (required): string — Post text. May be empty.
    - `mediaType` (required): string — One of image, video, gif, document, text, carousel.
    - `mediaItems` (required): object[]
      - `type` (required): enum(image|video)
      - `url` (required): string|null — 'Direct URL to the media file. Null when the platform withholds it: check mediaStatus before downloading. Instagram omits the video file for Reels it flags as containing copyrighted material (its docs name audio as the u
      - `thumbnail`: string — Cover image. Still present when url is null.
      - `mediaStatus`: enum(available|unavailable) — unavailable means the media file could not be retrieved (url is null or, for LinkedIn videos, a cover image standing in for the file). available or absent means the file is available at url (older synced items omit the f
      - `unavailableReason`: enum(platform_withheld) — Why the file is missing. platform_withheld means the platform declined to return it and retrying will not help.
    - `thumbnailUrl` (required): string|null
    - `publishedAt` (required): string
    - `mediaProductType`: string — Instagram only: the platform media product type (e.g. FEED, REELS, STORY, AD). Absent when the platform did not report it.
    - `isAiGenerated`: boolean — Instagram only: whether Instagram labeled the media as AI-generated. Absent when the platform did not report it.
    - `isSharedToFeed`: boolean — Instagram reels only: whether the reel is also shared to the main feed. Absent when the platform did not report it.
    - `mediaAudioType`: string — Instagram only: audio type of the media (MUSIC or ORIGINAL_SOUND). Absent when the platform did not report it.
    - `source` (required): enum(external) — Always "external". Distinguishes these from Zernio-originated post.* events.
    - `deletedAt`: string|null — Detection time of deletion. Present on post.external.deleted; null/absent otherwise.
  - `account` (required): object
    - `id` (required): string
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### post.external.deleted
External post deleted event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(post.external.created|post.external.updated|post.external.deleted)
  - `post` (required): object — Native (external) post data shared by all post.external.* payloads.
    - `id` (required): string — Platform-native post ID (NOT a Zernio post ID).
    - `platform` (required): string — Platform the post lives on (e.g. "googlebusiness").
    - `accountId` (required): string — Zernio account ID the post belongs to.
    - `url` (required): string|null — Direct URL to the post on the platform, when available.
    - `content` (required): string — Post text. May be empty.
    - `mediaType` (required): string — One of image, video, gif, document, text, carousel.
    - `mediaItems` (required): object[]
      - `type` (required): enum(image|video)
      - `url` (required): string|null — 'Direct URL to the media file. Null when the platform withholds it: check mediaStatus before downloading. Instagram omits the video file for Reels it flags as containing copyrighted material (its docs name audio as the u
      - `thumbnail`: string — Cover image. Still present when url is null.
      - `mediaStatus`: enum(available|unavailable) — unavailable means the media file could not be retrieved (url is null or, for LinkedIn videos, a cover image standing in for the file). available or absent means the file is available at url (older synced items omit the f
      - `unavailableReason`: enum(platform_withheld) — Why the file is missing. platform_withheld means the platform declined to return it and retrying will not help.
    - `thumbnailUrl` (required): string|null
    - `publishedAt` (required): string
    - `mediaProductType`: string — Instagram only: the platform media product type (e.g. FEED, REELS, STORY, AD). Absent when the platform did not report it.
    - `isAiGenerated`: boolean — Instagram only: whether Instagram labeled the media as AI-generated. Absent when the platform did not report it.
    - `isSharedToFeed`: boolean — Instagram reels only: whether the reel is also shared to the main feed. Absent when the platform did not report it.
    - `mediaAudioType`: string — Instagram only: audio type of the media (MUSIC or ORIGINAL_SOUND). Absent when the platform did not report it.
    - `source` (required): enum(external) — Always "external". Distinguishes these from Zernio-originated post.* events.
    - `deletedAt`: string|null — Detection time of deletion. Present on post.external.deleted; null/absent otherwise.
  - `account` (required): object
    - `id` (required): string
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): string
    - `username` (required): string
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### lead.received
Lead received event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(lead.received)
  - `lead` (required): object
    - `id` (required): string — Zernio lead ID (AdLead document ID)
    - `leadgenId` (required): string — Meta lead ID (the platform's leadgen_id)
    - `formId` (required): string — Lead Gen form ID the lead was submitted against
    - `formName`: string|null — Human-readable form name (best-effort; may be null)
    - `adId`: string|null — Meta ad ID that drove the lead (null for organic/test leads)
    - `adsetId`: string|null
    - `campaignId`: string|null
    - `fields` (required): object — Flattened question key -> answer map. For multiple-choice questions the value is the option key (e.g. "k1"), not the display label.
    - `isOrganic` (required): boolean — True when the lead came from an organic post rather than a paid ad
    - `createdAt` (required): string — Meta's lead creation time (ISO 8601)
  - `account` (required): object
    - `id` (required): string — Account ID (the facebook account owning the Page)
    - `accountId`: string — Account ID (same as id); canonical field for account filtering.
    - `platform` (required): enum(facebook)
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### ad.status_changed
Ad status changed event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(ad.status_changed)
  - `account` (required): object — The connected ad-platform account that owns the ad object.
    - `accountId` (required): string — Internal Zernio account ID (same as used in /v1/accounts/{accountId}).
    - `profileId` (required): string — Internal Zernio profile ID this account belongs to.
    - `platform` (required): string — Ad platform identifier. Currently always `metaads`.
    - `username` (required): string — Display username of the connected ad-platform account.
    - `displayName`: string — Human-readable display name of the account, when available.
  - `adObject` (required): object — The ad-platform object the status change applies to.
    - `level` (required): enum(CAMPAIGN|AD_SET|AD) — Hierarchy level the status applies to. Mirrors Meta's `level`. Creative-level events are not forwarded.
    - `platformId` (required): string — Platform-native ID of the campaign / ad set / ad. For Meta this is the bare numeric ID (e.g. `120244894077860689`).
    - `platformAdAccountId` (required): string — Platform-native ad-account ID. For Meta this uses the `act_<id>` shape.
  - `status` (required): object — Status info. Branch on `status.raw` to handle each transition.
    - `raw` (required): string — Platform-native status string, forwarded verbatim. For Meta this is `status_name` from `in_process_ad_objects` (e.g. `ACTIVE`, `PAUSED`, `PENDING_REVIEW`, `ARCHIVED`, `DELETED`, `DISAPPROVED`), or `WITH_ISSUES` when sour
  - `error`: object — Optional. Present on most `WITH_ISSUES` events, carrying the platform's error diagnostics. May be absent on some `WITH_ISSUES` events (Meta does not always include diagnostics). Always absent for any other `status.raw` v
    - `code` (required): string — Platform-native error code, forwarded verbatim. For Meta this is `error_code` as a string. Use as the stable discriminator, since `summary` and `message` are localized.
    - `summary`: string — Short human-readable summary (Meta `error_summary`). Localized to the ad-account owner's Meta locale. Display only, do not match on it.
    - `message`: string — Full human-readable error message (Meta `error_message`). Localized, display only.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### whatsapp.template.status_updated
WhatsApp template status updated event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(whatsapp.template.status_updated)
  - `account` (required): object
    - `accountId` (required): string
    - `profileId` (required): string
    - `platform` (required): enum(whatsapp)
    - `username` (required): string
    - `displayName`: string
  - `template` (required): object
    - `templateId` (required): string — Meta's `message_template_id`, returned as a string.
    - `name` (required): string — Meta's `message_template_name`.
    - `language` (required): string — Meta's `message_template_language` (e.g. `en_US`).
    - `status` (required): enum(APPROVED|REJECTED|PENDING|PAUSED|DISABLED|IN_APPEAL|PENDING_DELETION) — New status. Forwarded verbatim from Meta's `event` field. `PENDING_DELETION` is the 24h-grace state after a delete request before the template is actually removed.
    - `reason` (required): string — Meta's free-form reason for the transition. `"NONE"` on approval; an explanation string on rejection.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### whatsapp.template.category_updated
WhatsApp template category updated event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(whatsapp.template.category_updated)
  - `account` (required): object
    - `accountId` (required): string
    - `profileId` (required): string
    - `platform` (required): enum(whatsapp)
    - `username` (required): string
    - `displayName`: string
  - `template` (required): object
    - `templateId` (required): string — Meta's `message_template_id`, returned as a string.
    - `name` (required): string — Meta's `message_template_name`.
    - `language` (required): string — Meta's `message_template_language` (e.g. `en_US`).
    - `changeType` (required): enum(scheduled|applied) — `scheduled` is Meta's 24h advance notice of an upcoming reclassification; `applied` is the change taking effect.
    - `category` (required): enum(UTILITY|MARKETING|AUTHENTICATION) — The category right now, regardless of changeType.
    - `previousCategory`: enum(UTILITY|MARKETING|AUTHENTICATION) — Present only when changeType is `applied`. The category before this change.
    - `scheduledCategory`: enum(UTILITY|MARKETING|AUTHENTICATION) — Present only when changeType is `scheduled`. The category that will take effect at `effectiveAt`.
    - `effectiveAt`: string — Present only when changeType is `scheduled`. ISO-8601 timestamp when the scheduled category takes effect.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### whatsapp.account.name_status_updated
WhatsApp display-name review outcome event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(whatsapp.account.name_status_updated)
  - `account` (required): object
    - `accountId` (required): string
    - `profileId` (required): string
    - `platform` (required): enum(whatsapp)
    - `username` (required): string
    - `displayName`: string
  - `name` (required): object
    - `status` (required): enum(APPROVED|DECLINED|PENDING_REVIEW) — Normalized from Meta's `decision` (REJECTED -> DECLINED, DEFERRED -> PENDING_REVIEW; the review is still open on DEFERRED, not a rejection).
    - `requestedName` (required): string|null — The display name Meta reviewed. Null if Meta did not send one.
    - `rejectionReason` (required): string|null — Meta's free-form decline reason. Null on approval, or when Meta sends the literal string "NONE".
    - `displayPhoneNumber` (required): string|null — The phone number this review is for, as Meta reported it.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### whatsapp.automatic_event
WhatsApp automatic event detected
  - `id`: string
  - `event`: enum(whatsapp.automatic_event)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `accountId`: string — SocialAccount id of the WhatsApp number whose conversation was flagged.
  - `conversationId`: string — Zernio conversation id, when the thread could be resolved.
  - `platformMessageId`: string — The wamid of the message Meta's analysis flagged.
  - `eventName`: string — Meta-detected event: `LeadSubmitted` | `Purchase`.
  - `ctwaClid`: string — Meta's CTWA click id, the Conversions API match key.
  - `customData`: object — Purchase events may carry the detected amount.
    - `currency`: string
    - `value`: number
  - `detectedAt`: string

### whatsapp.number.activated
WhatsApp number activated event
  - `id`: string
  - `event`: enum(whatsapp.number.activated)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string

### whatsapp.number.declined
WhatsApp number declined event
  - `id`: string
  - `event`: enum(whatsapp.number.declined)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string
  - `reason`: string|null

### whatsapp.number.action_required
WhatsApp number action required event
  - `id`: string
  - `event`: enum(whatsapp.number.action_required)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `reason`: string
  - `requirements`: object[] — Every requirement on the order with the reviewer's current verdict. Omitted when the order's requirements could not be read.
    - `requirementId`: string — Same id as fields[].requirementId on the remediation endpoint.
    - `label`: string
    - `status`: enum(approved|pending|declined)
  - `reviewedAt`: string — When the reviewer last commented on the order. Omitted when there is no reviewer comment.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string

### whatsapp.number.verification_required
WhatsApp number verification-required event
  - `id`: string
  - `event`: enum(whatsapp.number.verification_required)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string
  - `verificationUrl`: string

### whatsapp.number.suspended
WhatsApp number suspended event
  - `id`: string
  - `event`: enum(whatsapp.number.suspended)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string
  - `reason`: string|null

### whatsapp.number.reactivated
WhatsApp number reactivated event
  - `id`: string
  - `event`: enum(whatsapp.number.reactivated)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string

### whatsapp.number.released
WhatsApp number released event
  - `id`: string
  - `event`: enum(whatsapp.number.released)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string
  - `reason`: string|null

### whatsapp.number.kyc_submitted
WhatsApp number KYC submitted event
  - `id`: string
  - `event`: enum(whatsapp.number.kyc_submitted|verification.approved|verification.failed)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `number`: object
    - `id`: string
    - `phoneNumber`: string
    - `country`: string
    - `profileId`: string

### phone_number.stock_available
Phone-number stock available event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(phone_number.stock_available)
  - `stock` (required): object
    - `country` (required): string — ISO 3166-1 alpha-2 country code of the watched country.
    - `types` (required): object[] — Number types deliverable at sweep time. Only types with stock are listed.
      - `numberType` (required): string — local, mobile, national or toll_free.
      - `availableCount` (required): integer — Deliverable numbers at sweep time; first come, first served.
    - `areaCode`: string — Set when the watch named an area: the area code (NDC) that is back in stock.
    - `areaName`: string — The name of that area, when known.
  - `timestamp` (required): string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.

### verification.approved
Verification approved event
  - `id`: string
  - `event`: enum(verification.approved)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `verification`: object
    - `verificationId`: string
    - `channel`: enum(sms)
    - `to`: string

### verification.failed
Verification failed event
  - `id`: string
  - `event`: enum(verification.failed)
  - `timestamp`: string — UTC time at which Zernio generated this event (set once when the event payload is built, before delivery is queued). Retries and redeliveries keep the original value, so it reflects the event, not the delivery attempt.
  - `verification`: object
    - `verificationId`: string
    - `channel`: enum(sms)
    - `to`: string
  - `reason`: enum(max_attempts_reached)

### webhook.test
Webhook test event
  - `id` (required): string — Stable webhook event ID
  - `event` (required): enum(webhook.test)
  - `message` (required): string — Human-readable test message
  - `timestamp` (required): string — UTC time at which Zernio generated this test event (set once when the payload is built). Test fires are sent synchronously as a single attempt; a later redelivery of this event keeps the original value.