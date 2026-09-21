# Zernio API 1.17.0 — extracted 2026-09-21


## TAG: Messages
Unified inbox API for managing conversations and direct messages across all connected accounts. All endpoints aggregate data from multiple accounts in a single API call. Requires Inbox addon.

### GET /v1/inbox/conversations
List conversations — Fetch conversations (DMs) from all connected messaging accounts in a single API call. Supports filtering by profile and platform. Results are aggregated and deduplicated. Supported platforms: Facebook, Instagram, X, Blue
Params:
  - `profileId` (query): string — Filter by profile ID
  - `platform` (query): enum(facebook|instagram|twitter|bluesky|reddit|telegram|whatsapp) — Filter by platform
  - `status` (query): enum(active|archived) — Filter by conversation status
  - `sortOrder` (query): enum(asc|desc) default desc — Sort order by updated time
  - `limit` (query): integer default 50 — Maximum number of conversations to return
  - `cursor` (query): string — Pagination cursor for next page
  - `accountId` (query): string — Filter by specific account ID
Returns:
  - `data`: object[]
    - `id`: string — Opaque conversation identifier. Pass it back verbatim to any /v1/inbox/conversations/{conversationId} route; do not assume a fixed format.
    - `platform`: string
    - `accountId`: string
    - `accountUsername`: string
    - `participantId`: string
    - `participantName`: string
    - `participantPicture`: string|null
    - `participantVerifiedType`: enum(blue|government|business|none) — X verified badge type. Only present for X conversations.
    - `lastMessage`: string
    - `updatedTime`: string
    - `status`: enum(active|archived)
    - `unreadCount`: integer|null — Number of unread messages
    - `threadControl`: enum(app|ai_agent|other) — WhatsApp only, present once Meta Business Agent has touched the thread. ai_agent: the agent answers and new inbound arrive flagged metadata.standby; app: you hold control; other: another partner app does. Change it with 
    - `url`: string|null — Direct link to open the conversation on the platform (if available)
    - `instagramProfile`: object|null — Instagram profile data for the participant. Only present for Instagram conversations.
      - `isFollower`: boolean|null — Whether the participant follows your Instagram business account
      - `isFollowing`: boolean|null — Whether your Instagram business account follows the participant
      - `followerCount`: integer|null — The participant's follower count on Instagram
      - `isVerified`: boolean|null — Whether the participant is a verified Instagram user
      - `fetchedAt`: string|null — When this profile data was last fetched from Instagram
    - `metadata`: object|null — Click attribution for a conversation that started from a Meta ad or a ref-tagged ig.me / m.me link. Absent when the conversation did not originate from an attributable click. Captured from the referral Meta delivers for 
      - `ctwa_clid`: string — WhatsApp only. Meta's click identifier, the value to forward to the Meta Conversions API for Business Messaging. Meta omits it on some numbers, so a WhatsApp referral can arrive without it.
      - `ctwa_source_id`: string — WhatsApp only. The Meta ad ID the user clicked. This is the WhatsApp equivalent of meta_ad_id.
      - `ctwa_source_type`: string — WhatsApp only. What the user clicked, as supplied by Meta (for example ad or post).
      - `ctwa_source_url`: string — WhatsApp only. Meta's URL for the ad that was clicked, normally an fb.me short link.
      - `ctwa_headline`: string — WhatsApp only. Headline of the ad creative at click time.
      - `ctwa_captured_at`: string — WhatsApp only. When Zernio stored this referral. Always present when a WhatsApp referral was captured.
      - `meta_ad_id`: string — Instagram and Facebook only. The Meta ad ID the user clicked. Present for ad clicks; absent when the capture came from an ig.me / m.me ref link.
      - `meta_ad_source`: string — Instagram and Facebook only. Meta-supplied source identifier: ADS for ad clicks; SHORTLINK, SHORTLINKS or IGME-SOURCE-LINK for ref links (treat as opaque).
      - `meta_ad_type`: string — Instagram and Facebook only. Meta-supplied referral type, for example OPEN_THREAD.
      - `meta_ad_ref`: string — Instagram and Facebook only. The ref parameter passed through from the ad creative or the ig.me / m.me link.
      - `meta_ad_title`: string — Instagram and Facebook only. Title of the ad creative at click time.
      - `meta_ad_photo_url`: string — Instagram and Facebook only. Image of the ad creative at click time.
      - `meta_ad_video_url`: string — Instagram and Facebook only. Video of the ad creative at click time.
      - `meta_ad_post_id`: string — Instagram and Facebook only. The organic post the ad promoted, when the ad was a boosted post.
      - `meta_ad_product_id`: string — Instagram and Facebook only. The catalogue product the user clicked, for product ads.
      - `meta_ad_flow_id`: string — Instagram and Facebook only. The Meta flow the ad launched, for flow ads.
      - `meta_ad_captured_at`: string — Instagram and Facebook only. When Zernio stored this referral. Always present when an Instagram or Facebook referral was captured.
  - `pagination`: object
    - `hasMore`: boolean
    - `nextCursor`: string|null
  - `meta`: object
    - `accountsQueried`: integer
    - `accountsFailed`: integer
    - `failedAccounts`: object[]
      - `accountId`: string
      - `accountUsername`: string|null
      - `platform`: string
      - `error`: string
      - `code`: string|null — Error code if available
      - `retryAfter`: integer|null — Seconds to wait before retry (rate limits)
    - `lastUpdated`: string
    - `accountsSkipped`: object[] — Connected accounts that were not queried: their platform does not support this feature, or the account is not enabled for it
      - `accountId`: string
      - `platform`: string

### POST /v1/inbox/conversations
Create conversation — Start a direct message conversation with a user. If a conversation with that recipient already exists, the message is added to the existing thread. Supported platforms: X, Bluesky, Reddit, WhatsApp, SMS, and Slack. Other
Body:
  - `accountId` (required): string — The account ID to send from
  - `participantId`: string — Recipient identifier. For X this is the numeric user ID; for WhatsApp and SMS, the recipient phone number in international format (digits, country code included); for Slack, the workspace member id (e.g. U01ABCDEF). Prov
  - `participantUsername`: string — Recipient handle/username, an X or Bluesky handle (with or without @) or a Reddit username (with or without u/). Resolved via lookup. Provide either this or participantId.
  - `message`: string — Text content of the message. At least one of message, attachment, or (for WhatsApp) templateName is required. Required when category is set (a Direct Send utility message is a text message).
  - `skipDmCheck`: boolean — X only. Skip the receives_your_dm eligibility check before sending. Use if you have already verified the recipient accepts DMs.
  - `templateName`: string — WhatsApp only. Name of the approved template to start the conversation with. Required for WhatsApp unless category is used instead (Direct Send). Cannot be combined with category.
  - `category`: enum(utility) — WhatsApp only (Meta Direct Send). Combined with message and without templateName, starts the conversation with a business-initiated UTILITY message and no pre-approved template; Meta matches or auto-creates a template as
  - `linkPreview`: boolean — WhatsApp only. Set false to send the Direct Send (category: 'utility') text message without a link-preview thumbnail for the first URL in the text. Defaults to true, which is how every WhatsApp text has been sent to date
  - `templateLanguage`: string — WhatsApp only. Template language code (e.g. en_US).
  - `templateParams`: string[] — WhatsApp only. Template variable values as one flat array, in the order the variables appear across the whole template: text-header variables first, then body variables, then one value per dynamic URL button (in button o
  - `templateButtonParams`: object[] — WhatsApp only. Values for template buttons that carry one at send time, each addressed by the button's position in the approved template. This is the only way to send a copy-code button's payload (a Pix payment code, a c
    - `index` (required): integer — Zero-based position of the button in the approved template's buttons.
    - `subType` (required): enum(url|copy_code|flow) — The button kind, which decides how the value is sent: copy_code sends it as the coupon_code payload, flow as the flow token, url as the dynamic suffix appended to the button's base URL.
    - `value` (required): string — The value to send (e.g. the Pix copy-and-paste code for a copy_code button).
  - `templateCards`: object[] — WhatsApp only. Per-card overrides for a CAROUSEL template, each addressed by the card's card_index. Carousel card body variables restart at {{1}} per card, so they cannot be expressed in the flat templateParams slot orde
    - `cardIndex` (required): integer — The card's card_index in the approved template.
    - `params`: string[] — Values for this card's own body variables, in the card's own {{1}}, {{2}}, ... order (or named-slot order of appearance).
    - `headerMedia`: object — Overrides this card's header asset for THIS send. Without it, the card's approved sample asset is sent.
      - `type` (required): enum(image|video|document) — Must match the card header's media type.
      - `link`: string — Public URL of the asset to send. Must be reachable without auth.
      - `id`: string — A Meta media id (from the media upload endpoint), as an alternative to link.
    - `buttons`: object[] — Values for this card's own buttons, each addressed by the button's index within the card.
      - `index` (required): integer — Zero-based position of the button within the card's buttons.
      - `subType` (required): enum(quick_reply|url) — The button kind, which decides how the value is sent.
      - `value` (required): string — The value to send (quick_reply payload, or the URL dynamic suffix).
  - `headerMedia`: object — WhatsApp only. Overrides a media-header template's header asset for THIS send, so a template with an image/video/document header can carry a different asset per message (e.g. each recipient their own invoice PDF). Withou
    - `type` (required): enum(image|video|document) — Must match the template header's media type.
    - `link`: string — Public URL of the asset to send. Must be reachable without auth.
    - `id`: string — A Meta media id (from the media upload endpoint), as an alternative to link.
    - `filename`: string — Document display name shown to the recipient (e.g. "Factura 0001-123.pdf"). document type only; ignored for image/video.
  - `headerLocation`: object — WhatsApp only. Required to send a template whose approved header format is LOCATION: Meta only accepts the location's lat/long at send time, never at template creation, so there is nothing to fill in automatically. Canno
    - `latitude` (required): number — Latitude in decimal degrees.
    - `longitude` (required): number — Longitude in decimal degrees.
    - `name`: string — Location name shown to the recipient (e.g. a business name).
    - `address`: string — Location address shown to the recipient.
Returns:
  - `success`: boolean
  - `data`: object
    - `messageId`: string — Platform message ID (dm_event_id)
    - `conversationId`: string — Platform conversation ID (dm_conversation_id). For WhatsApp, this is Zernio's internal conversation id (24-character hex) which matches the id returned by the list-conversations endpoint and the conversationId in the mes
    - `participantId`: string — X numeric user ID of the recipient
    - `participantName`: string|null — Display name of the recipient
    - `participantUsername`: string|null — X username of the recipient

### GET /v1/inbox/conversations/search
Search conversations — Search your conversations two ways at once, and get back the matching conversations, most-recent match first: - Message text: matches words inside message bodies. Case-insensitive and accent-insensitive, exact tokens onl
Params:
  - `query` (query, required): string — Text to search for, in message content and in the contact's name, username, or phone number
  - `direction` (query): enum(incoming|outgoing) — Only match messages sent to you (incoming) or by you (outgoing). Contact-identity matching is not applied when this is set.
  - `profileId` (query): string — Filter by profile ID
  - `platform` (query): enum(facebook|instagram|telegram|whatsapp|sms|slack) — Filter by platform (searchable platforms only)
  - `accountId` (query): string — Filter by specific account ID
  - `limit` (query): integer default 20 — Maximum number of conversations to return
  - `cursor` (query): string — Opaque pagination cursor. Pass back pagination.nextCursor verbatim; do not construct one.
Returns:
  - `data`: object[]
    - `conversation`: object
      - `id`: string — Conversation ID, usable with the conversation messages endpoints
      - `platform`: string
      - `accountId`: string
      - `participantName`: string|null
      - `participantUsername`: string|null
      - `participantPicture`: string|null
      - `status`: enum(active|archived)
      - `lastMessage`: string|null — The conversation's most recent message preview
      - `lastMessageAt`: string|null
    - `matchCount`: integer — Number of matching messages in this conversation. 0 when the conversation matched only on contact identity (name, username, or phone number), not on message text.
    - `matches`: object[] — Up to 3 most-recent matching messages (empty for an identity-only match)
      - `id`: string
      - `text`: string|null
      - `direction`: enum(incoming|outgoing)
      - `timestamp`: string
  - `pagination`: object
    - `hasMore`: boolean
    - `nextCursor`: string|null
  - `meta`: object
    - `accountsQueried`: integer
    - `accountsFailed`: integer
    - `failedAccounts`: object[]
      - `accountId`: string
      - `accountUsername`: string|null
      - `platform`: string
      - `error`: string
    - `lastUpdated`: string
    - `accountsSkipped`: object[] — Connected messaging accounts that cannot be searched (live-fetched platforms)
      - `accountId`: string
      - `platform`: string

### GET /v1/inbox/conversations/{conversationId}
Get conversation — Retrieve details and metadata for a specific conversation. Requires accountId query parameter.
Params:
  - `conversationId` (path, required): string — Opaque conversation identifier, accepted verbatim from the list endpoint or from the conversationId on inbox webhooks. Format not to be assumed.
  - `accountId` (query, required): string — The account ID
Returns:
  - `data`: object
    - `id`: string
    - `accountId`: string
    - `accountUsername`: string
    - `platform`: string
    - `status`: enum(active|archived)
    - `participantName`: string
    - `participantId`: string
    - `participantVerifiedType`: enum(blue|government|business|none) — X verified badge type. Only present for X conversations.
    - `lastMessage`: string
    - `lastMessageAt`: string
    - `updatedTime`: string
    - `participants`: object[]
      - `id`: string
      - `name`: string
    - `instagramProfile`: object|null — Instagram profile data for the participant. Only present for Instagram conversations.
      - `isFollower`: boolean|null — Whether the participant follows your Instagram business account
      - `isFollowing`: boolean|null — Whether your Instagram business account follows the participant
      - `followerCount`: integer|null — The participant's follower count on Instagram
      - `isVerified`: boolean|null — Whether the participant is a verified Instagram user
      - `fetchedAt`: string|null — When this profile data was last fetched from Instagram
    - `metadata`: object|null — Ad-click attribution for a conversation that started from a Meta ad. Absent when the conversation did not originate from an ad click. Captured once, on the first inbound message after the click, and never overwritten. If
      - `meta_ad_id`: string — The Meta ad ID the user clicked. Always present when a referral was captured.
      - `meta_ad_source`: string — Meta-supplied source identifier, for example ADS.
      - `meta_ad_type`: string — Meta-supplied referral type, for example OPEN_THREAD.
      - `meta_ad_ref`: string — The ref parameter passed through from the ad creative.
      - `meta_ad_title`: string — Title of the ad creative at click time.
      - `meta_ad_photo_url`: string — Image of the ad creative at click time.
      - `meta_ad_video_url`: string — Video of the ad creative at click time.
      - `meta_ad_post_id`: string — The organic post the ad promoted, when the ad was a boosted post.
      - `meta_ad_product_id`: string — The catalogue product the user clicked, for product ads.
      - `meta_ad_flow_id`: string — The Meta flow the ad launched, for flow ads.
      - `meta_ad_captured_at`: string — When Zernio stored this referral. Always present when a referral was captured.

### PUT /v1/inbox/conversations/{conversationId}
Update conversation status — Archive or activate a conversation. Requires accountId in request body.
Params:
  - `conversationId` (path, required): string — Opaque conversation identifier, accepted verbatim from the list endpoint or from the conversationId on inbox webhooks. Format not to be assumed.
Body:
  - `accountId` (required): string — Account ID
  - `status` (required): enum(active|archived)
Returns:
  - `success`: boolean
  - `data`: object
    - `id`: string
    - `accountId`: string
    - `status`: enum(active|archived)
    - `platform`: string
    - `updatedAt`: string

### GET /v1/inbox/conversations/{conversationId}/messages
List messages — Fetch messages for a specific conversation, with cursor-based pagination and ordering control. Pagination: pass `pagination.nextCursor` from a prior response back as the `cursor` query param to fetch the next page. The c
Params:
  - `conversationId` (path, required): string — Opaque conversation identifier, accepted verbatim from the list endpoint or from the conversationId on inbox webhooks. Format not to be assumed.
  - `accountId` (query, required): string — Account ID
  - `limit` (query): integer default 100 — Number of messages to return per page. Default 100, max 100.
  - `cursor` (query): string — Opaque pagination cursor. Pass `pagination.nextCursor` from a prior response verbatim: a cursor we cannot parse returns 400 rather than silently restarting from the first page.
  - `sortOrder` (query): enum(asc|desc) default asc — Order of returned messages. Default `asc` (oldest first, chat style). X, Instagram, Telegram, WhatsApp and Reddit honor this order across cursor pages. For Facebook and Bluesky, only intra-page ordering is affected. Page
Returns:
  - `status`: string
  - `pagination`: object
    - `hasMore`: boolean — Whether more messages are available beyond this page.
    - `nextCursor`: string|null — Opaque cursor to fetch the next page. `null` on the last page.
  - `sortOrderApplied`: enum(asc|desc) — Sort order actually applied to the returned page. May differ from the requested `sortOrder` for Facebook and Bluesky (always `desc` regardless of request).
  - `messages`: object[]
    - `id`: string — The platform's own message id: the `wamid` on WhatsApp, the `mid` on Instagram and Facebook Messenger. This is what `metadata.quotedMessageId` points at, the value to pass as `replyTo` on the platforms that support quote
    - `conversationId`: string
    - `accountId`: string
    - `platform`: string
    - `message`: string
    - `senderId`: string
    - `senderName`: string|null
    - `senderVerifiedType`: enum(blue|government|business|none) — X verified badge type. Only present for X messages.
    - `direction`: enum(incoming|outgoing)
    - `createdAt`: string
    - `attachments`: object[]
      - `id`: string
      - `type`: enum(image|video|audio|file|sticker|share|template)
      - `originalType`: string — Instagram and Facebook only, and present only when it differs from `type`. Meta's own type before normalization: `ig_reel` and `reel` become `video`, while `ig_post`, `post`, `ig_story` and `story_mention` become `share`
      - `url`: string — Direct media link. On Instagram and Facebook this is a signed Meta CDN url that EXPIRES: use it now, do not store it. Persist `refreshUrl` instead.
      - `refreshUrl`: string|null — Instagram and Facebook only. Endpoint that resolves this attachment to a working url every time, re-minting it from Meta when the stored one has expired. Safe to store and render indefinitely.
      - `filename`: string|null
      - `previewUrl`: string|null
      - `payload`: object — Template content (title, subtitle, image, buttons) when type is template
    - `subject`: string|null — Reddit message subject
    - `storyReply`: boolean|null — Instagram story reply
    - `isStoryMention`: boolean|null — Instagram story mention
    - `isEdited`: boolean — True if the sender has edited this message at least once.
    - `editedAt`: string|null — When the most recent edit happened.
    - `editCount`: integer — Total number of edits applied.
    - `editHistory`: object[] — Every prior version of the message, oldest first.
      - `text` (required): string|null
      - `attachments` (required): object[]
      - `editedAt` (required): string
    - `isDeleted`: boolean — True if the sender has deleted (unsent) this message. The original message and attachments fields remain populated.
    - `deletedAt`: string|null
    - `deliveryStatus`: enum(sent|delivered|read|failed|deleted) — Lifecycle status for outgoing messages. Not all platforms emit every state (see webhook support matrix).
    - `deliveredAt`: string|null
    - `readAt`: string|null
    - `sentAt`: string|null — Original send time for outgoing messages (used for Messenger watermark queries).
    - `deliveryError`: object|null — Populated when deliveryStatus === "failed".
      - `code`: integer
      - `title`: string
      - `message`: string
      - `details`: string — Platform's extended detail for `code` (WhatsApp: Meta's `error_data.details`), when the platform sent one. Absent on SMS.
      - `href`: string — Link to the platform's documentation for `code`, when the platform sent one.
    - `reactions`: object[] — Emoji reactions on this message (WhatsApp / Telegram). At most one per party in a 1:1 thread.
      - `emoji`: string
      - `fromMe`: boolean — true if the connected account reacted, false if the contact did.
      - `reactedAt`: string
    - `metadata`: object — Platform-specific extras. Free-form, but commonly includes: `quotedMessageId` (the `id` of the message this one replies to, delivered as `message.platformMessageId` on webhooks), `waInteractive` (a compact descriptor of 
    - `sentVia`: enum(human|api|broadcast|sequence|workflow|comment_automation|bulk-api|) — Which Zernio surface produced this outgoing message: `human` (an operator in the Zernio inbox), `api` (a call to this API), `broadcast`, `sequence`, `workflow`, `comment_automation`, or `bulk-api` (POST /v1/whatsapp/bulk
  - `lastUpdated`: string

### POST /v1/inbox/conversations/{conversationId}/messages
Send message — Send a message in a conversation. Supports text, attachments, quick replies, buttons, templates, and message tags. Attachment and interactive message support varies by platform. WhatsApp per-recipient rate limit: WhatsAp
Params:
  - `conversationId` (path, required): string — Opaque conversation identifier, accepted verbatim from the list endpoint or from the conversationId on inbox webhooks. Format not to be assumed.
  - `Idempotency-Key` (header): string — Optional client-generated unique key (e.g. a UUID) that makes retries safe. Same key + same body replays the original response; same key + different body → 422; key still processing → 409.
Body:
  - `accountId` (required): string — Account ID
  - `message`: string — Message text
  - `attachmentUrl`: string — URL of the attachment to send (image, video, audio, or file). The URL must be publicly accessible. For binary file uploads, use multipart/form-data instead. On WhatsApp, combining an image, video, or file with `buttons` 
  - `category`: enum(utility) — WhatsApp only (Meta Direct Send). Sends this message as a business-initiated UTILITY message without an approved template, for example outside the 24-hour customer service window; Meta matches or auto-creates a template 
  - `linkPreview`: boolean — WhatsApp only. Set false to send the message without a link-preview thumbnail for the first URL in the text. Defaults to true, which is how every WhatsApp text has been sent to date. Ignored on other platforms. Accepted 
  - `attachmentType`: enum(image|video|audio|file) — Type of attachment. Defaults to file if not specified.
  - `attachmentName`: string — WhatsApp only. Display name for a document sent via attachmentUrl with attachmentType: file (e.g. "Report.pdf"). Maps to the recipient's file name; without it WhatsApp derives the name from the URL and shows "Untitled". 
  - `voiceNote`: boolean — WhatsApp only. When `true` on an audio attachment, the message is sent as a voice message (PTT): the recipient sees the waveform + voice-note UI instead of a basic audio attachment. The audio file MUST be `.ogg` encoded 
  - `quickReplies`: object[] — Quick reply buttons. Mutually exclusive with buttons. Max 13 items.
    - `title` (required): string — Button label (max 20 chars)
    - `payload` (required): string — Payload sent back on tap
    - `imageUrl`: string — Optional icon URL (Meta only)
  - `buttons`: object[] — Action buttons. Mutually exclusive with quickReplies. Max 3 items. Instagram / Facebook: also mutually exclusive with `template`. A Meta message carries one body shape, so sending both is a 400 rather than a silent drop 
    - `type` (required): enum(url|postback|phone) — Button type. phone is Facebook only. Ignored on WhatsApp (buttons always render as reply buttons).
    - `title` (required): string — Button label (max 20 chars)
    - `url`: string — URL for url-type buttons (Facebook/Instagram only)
    - `payload`: string — Payload for postback-type buttons. On WhatsApp, this is the reply ID returned on the message.received webhook when the button is tapped.
    - `phone`: string — Phone number for phone-type buttons (Facebook only)
  - `template`: object — Platform-dependent template payload. Ignored on Telegram. Instagram / Facebook: a generic template (carousel). Set `type: generic` and provide up to 10 `elements`, each with a `title` (required) and optional `subtitle`, 
    - `type`: enum(generic) — Template type. Required for Instagram/Facebook generic templates; ignored on WhatsApp.
    - `imageAspectRatio`: enum(horizontal|square) — Facebook only. Aspect ratio Messenger renders element images at: horizontal (1.91:1, default) or square (1:1). A 400 on Instagram.
    - `elements`: object[]
      - `title`: string — Element title (max 80 chars). Required for Instagram/Facebook generic templates.
      - `subtitle`: string — Element subtitle (Instagram/Facebook only)
      - `imageUrl`: string — Element image URL (Instagram/Facebook only)
      - `buttons`: object[] — Element buttons (Instagram/Facebook only)
      - `name`: string — WhatsApp only. Name of the approved template to send.
      - `language`: string — WhatsApp only. Template language code (e.g. en_US).
      - `components`: object[] — WhatsApp only. Meta Cloud API send-shape components array, forwarded to Meta verbatim.
  - `interactive`: object — WhatsApp-only. Rich interactive payload for list messages, CTA URL buttons, Flow prompts, location requests, voice-call buttons, and commerce messages (single product, product list, catalog, and carousel). When set, take
    - `type` (required): enum(list|cta_url|flow|location_request_message|request_contact_info|voice_call|product|product_list|catalog_message|carousel|address_message) — Which interactive layout to render.
    - `header`: object — Optional header shown above the body. Required with `type: "text"` for `product_list`; not allowed for `product` or `carousel`.
      - `type`: enum(text|image|video|document)
      - `text`: string — Required when header type is text.
      - `image`: object
      - `video`: object
      - `document`: object
    - `body`: object — Required for every type except `product`, where it is optional.
      - `text` (required): string — Main body text.
    - `footer`: object — Optional footer shown below the action.
      - `text`: string
    - `action`: object | object | object | object | object | object | object | object | object | object | object
  - `replyMarkup`: object — Telegram-native keyboard markup. Ignored on other platforms.
    - `type`: enum(inline_keyboard|reply_keyboard) — Keyboard type
    - `keyboard`: object[][] — Array of rows, each row is an array of buttons
    - `oneTime`: boolean — Hide keyboard after use (reply_keyboard only)
  - `messagingType`: enum(RESPONSE|UPDATE|MESSAGE_TAG) — Facebook messaging type. Required when using messageTag.
  - `messageTag`: enum(CONFIRMED_EVENT_UPDATE|POST_PURCHASE_UPDATE|ACCOUNT_UPDATE|HUMAN_AGENT) — Facebook message tag for messaging outside 24h window. Requires messagingType MESSAGE_TAG. Instagram only supports HUMAN_AGENT.
  - `replyTo`: string — Platform message ID to quote-reply to. For WhatsApp, pass the wamid; for Telegram, the Telegram message ID (delivered as message.platformMessageId on webhooks, and as `id` on each entry of the list-messages endpoint). On
  - `location`: object — WhatsApp-only. Send a location pin.
    - `latitude` (required): number — Latitude in decimal degrees.
    - `longitude` (required): number — Longitude in decimal degrees.
    - `name`: string — Optional location name.
    - `address`: string — Optional street address.
  - `contacts`: object[] — WhatsApp-only. Send one or more contact cards.
    - `name` (required): object
      - `formatted_name` (required): string — Full display name.
      - `first_name`: string
      - `last_name`: string
    - `phones`: object[]
      - `phone`: string
      - `type`: string — e.g. CELL, WORK, HOME.
    - `emails`: object[]
      - `email`: string
      - `type`: string
Returns:
  - `success`: boolean
  - `warnings`: object[] — Present when a successful send ignored replyTo on Instagram or Facebook Messenger. The message was sent without a quote; do not retry it to apply the reply.
    - `code` (required): enum(ignored_field)
    - `param` (required): enum(replyTo)
    - `message` (required): string — Human-readable explanation of the ignored field.
  - `data`: object
    - `messageId`: string — Platform id of the sent message (not returned for Reddit). For WhatsApp this is the raw Meta wamid, the same id delivered as message.platformMessageId on webhooks and delivery-status updates, and the value to pass as rep
    - `conversationId`: string — Zernio conversation id, echoed so the thread can be read back or replied to. It equals the id the list-conversations endpoint returns for Telegram, WhatsApp, SMS and Slack; for Facebook, Instagram, Bluesky and Reddit tha
    - `attachments`: object[] — Echo of the sent attachment with its resolved public URL, when one is available (Facebook, Instagram, Telegram, WhatsApp).
      - `type`: string
      - `url`: string
    - `messageIds`: string[] — Facebook/Instagram only. Present when an attachment and text were both requested: Meta has no single body shape for both, so the send is two Meta messages under the hood. First element === messageId (the attachment); sec
    - `partialFailure`: object — Facebook/Instagram only. The attachment was delivered but the follow-up text message was rejected by Meta and was not stored; the response is still a 200 because the attachment send succeeded.
      - `part`: enum(text)
      - `error`: string
      - `platformError`: object — Meta's own diagnostic fields for the rejected follow-up, same shape as the 400 response's platformError.

### PATCH /v1/inbox/conversations/{conversationId}/messages/{messageId}
Edit message — Edit the text and/or reply markup of a previously sent Telegram message. Only supported for Telegram. Returns 400 for other platforms.
Params:
  - `conversationId` (path, required): string — The conversation ID
  - `messageId` (path, required): string — The Telegram message ID to edit
Body:
  - `accountId` (required): string — Account ID
  - `text`: string — New message text
  - `replyMarkup`: object — New inline keyboard markup
    - `type`: enum(inline_keyboard)
    - `keyboard`: object[][]
Returns:
  - `success`: boolean
  - `data`: object
    - `messageId`: integer

### DELETE /v1/inbox/conversations/{conversationId}/messages/{messageId}
Delete message — Delete a message from a conversation. Platform support varies: - Telegram: Full delete (bot's own messages anytime, others if admin) - X: Full delete (own DM events only) - Bluesky: Delete for self only (recipient still 
Params:
  - `conversationId` (path, required): string — The conversation ID
  - `messageId` (path, required): string — The platform message ID to delete
  - `accountId` (query, required): string — Account ID
Returns:
  - `success`: boolean

### POST /v1/inbox/conversations/{conversationId}/typing
Send typing indicator — Show a typing indicator in a conversation. Platform support: - Facebook Messenger: Shows "Page is typing..." for 20 seconds - Instagram: Shows "typing..." to the recipient (works for both Instagram Login and Facebook Log
Params:
  - `conversationId` (path, required): string — The conversation ID
Body:
  - `accountId` (required): string — Account ID
Returns:
  - `success`: boolean

### POST /v1/inbox/conversations/{conversationId}/thread-control
Hand a conversation to or from Meta Business Agent — WhatsApp only, on numbers with Meta Business Agent enabled. Wraps Meta's thread control: - `release`: hand the conversation back to the agent so it resumes answering. You must currently hold control (sending any message 
Params:
  - `conversationId` (path, required): string — The conversation ID
Body:
  - `accountId` (required): string — Social account ID
  - `action` (required): enum(release|take|pass)
  - `target`: enum(ai_agent) — With action pass: send control to Meta Business Agent instead of the escalation partner.
  - `metadata`: string — Free-form note forwarded verbatim to the app receiving control (its messaging_handovers webhook).
Returns:
  - `success`: boolean
  - `control`: object
    - `owner`: enum(app|ai_agent|other)

### POST /v1/inbox/conversations/{conversationId}/read
Mark a conversation as read — Marks all unread incoming messages in the conversation as read. For WhatsApp, this also sends read receipts (blue ticks) to the contact, EXCEPT on coexistence accounts (where the WhatsApp Business app on the customer's p
Params:
  - `conversationId` (path, required): string — The conversation ID
Body:
  - `accountId` (required): string — Account ID
Returns:
  - `success`: boolean
  - `markedCount`: integer — Number of messages marked read by this call

### POST /v1/inbox/conversations/{conversationId}/messages/{messageId}/reactions
Add reaction — Add an emoji reaction to a message. Platform support: - Telegram: Supports a subset of Unicode emoji reactions - WhatsApp: Supports any standard emoji (one reaction per message per sender) - Instagram and Facebook Messen
Params:
  - `conversationId` (path, required): string — The conversation ID
  - `messageId` (path, required): string — The platform message ID (as returned by GET /messages) or the Zernio message ID (as returned by the reaction webhook)
Body:
  - `accountId` (required): string — Account ID
  - `emoji` (required): string — Emoji character (e.g. "👍", "❤️")
Returns:
  - `success`: boolean
  - `messageId`: string — The Zernio message ID the reaction was resolved against
  - `platformMessageId`: string — The platform message ID the reaction was sent for

### DELETE /v1/inbox/conversations/{conversationId}/messages/{messageId}/reactions
Remove reaction — Remove a reaction from a message. Platform support: - Telegram: Send empty reaction array to clear - WhatsApp: Send empty emoji to remove - Instagram and Facebook Messenger: Sends Meta's `unreact` action; the emoji does 
Params:
  - `conversationId` (path, required): string — The conversation ID
  - `messageId` (path, required): string — The platform message ID (as returned by GET /messages) or the Zernio message ID (as returned by the reaction webhook)
  - `accountId` (query, required): string — Account ID
Returns:
  - `success`: boolean
  - `messageId`: string — The Zernio message ID the removal was resolved against
  - `platformMessageId`: string — The platform message ID the removal was sent for

### POST /v1/media/upload-direct
Upload media file — Upload a media file using API key authentication and get back a publicly accessible URL. The URL can be used as attachmentUrl when sending inbox messages. Files are stored in temporary storage and auto-delete after 7 day
Body:
  - `file` (required): string — The file to upload (max 25MB)
  - `contentType`: string — Override MIME type (e.g. "image/jpeg"). Auto-detected from file if not provided.
Returns:
  - `url`: string — Publicly accessible URL for the uploaded file
  - `filename`: string — Generated unique filename
  - `contentType`: string — MIME type of the file
  - `size`: integer — File size in bytes

### GET /v1/inbox/conversations/{conversationId}/messages/{messageId}/attachments/{index}
Resolve message attachment — Resolve one attachment on a message to a media url that works right now. Instagram and Facebook sign DM media urls per request and expire them, so the `url` on a message is a snapshot: it works when you read the message 
Params:
  - `conversationId` (path, required): string — The conversation ID (Zernio id or platform conversation id)
  - `messageId` (path, required): string — The message id as returned by the list-messages endpoint (the platform message id)
  - `index` (path, required): integer — Zero-based position of the attachment in the message's attachments array
  - `accountId` (query, required): string — Account ID. Required: without it the request returns 400 missing_required_field.
  - `format` (query): enum(redirect|json) default redirect — `redirect` (default) answers 302 to the media; `json` returns the url in the body
Returns:
  - `status`: string
  - `url`: string — Live media url. Short-lived; re-request this endpoint rather than storing it.
  - `refreshed`: boolean — True when the stored url had expired and was re-minted from the platform.

## TAG: Comments
Unified inbox API for managing comments on posts across all connected accounts. Supports commenting on third-party posts for platforms that allow it (YouTube, X, Reddit, Bluesky, Threads). All endpoints aggregate data fr

### GET /v1/inbox/comments
List commented posts — Returns posts with comment counts from all connected accounts. Aggregates data across multiple accounts. Responses are cached for up to 10 minutes, so the feed may lag new comments by that window. Do not poll this endpoi
Params:
  - `profileId` (query): string — Filter by profile ID
  - `platform` (query): enum(facebook|instagram|twitter|bluesky|threads|youtube|linkedin|reddit|tiktok|metaads) — Filter by platform. `metaads` is a synthetic value meaning the user's ads (boosted/dark posts) only; `facebook`/`instagram` return organic posts only. `tiktok` covers accounts connected through the TikTok Business app on
  - `minComments` (query): integer — Minimum comment count
  - `since` (query): string — Posts created after this date
  - `sortBy` (query): enum(date|comments) default date — Sort field
  - `sortOrder` (query): enum(asc|desc) default desc — Sort order
  - `limit` (query): integer default 50
  - `cursor` (query): string
  - `accountId` (query): string — Filter by specific account ID
Returns:
  - `data`: object[]
    - `id`: string
    - `platform`: string
    - `accountId`: string
    - `accountUsername`: string
    - `content`: string — The post text/caption. On ad rows (isAd: true) this is the AD NAME, not the underlying post's caption. The creative text isn't exposed here.
    - `picture`: string|null — Post media thumbnail. On ad rows this is the ad creative thumbnail.
    - `permalink`: string|null — Public URL of the post. On ad rows: the Facebook dark-post URL (facebook placement) or the IG media permalink (instagram placement); may be null when unknown.
    - `createdTime`: string
    - `commentCount`: integer
    - `likeCount`: integer — Not fetched for ad rows (always 0 there).
    - `cid`: string|null — Bluesky content identifier
    - `subreddit`: string|null — Reddit subreddit name
    - `isAd`: boolean — True when this row is an ad (boosted/dark post). `platform` is then the placement (facebook = the Page dark post / instagram = the IG media), `id` is `{adId}:{placement}`, and the thread is at GET /v1/ads/{adId}/comments
    - `adId`: string — Internal Zernio ad id, only on ad rows.
    - `placement`: enum(facebook|instagram) — Which side of the ad this row's comments are on, only on ad rows.
  - `pagination`: object
    - `hasMore`: boolean
    - `nextCursor`: string|null
  - `meta`: object
    - `accountsQueried`: integer
    - `accountsFailed`: integer
    - `failedAccounts`: object[]
      - `accountId`: string
      - `accountUsername`: string|null
      - `platform`: string
      - `error`: string
      - `code`: string|null — Error code if available (e.g. TOKEN_EXPIRED, or X_INBOX_NOT_ENABLED for an X account whose owner has not enabled X inbox)
      - `retryAfter`: integer|null — Seconds to wait before retry (rate limits)
    - `lastUpdated`: string
    - `accountsSkipped`: object[] — Connected accounts that were not queried: their platform does not support this feature, or the account is not enabled for it
      - `accountId`: string
      - `platform`: string

### GET /v1/inbox/comments/{postId}
Get post comments — Fetch comments for a specific post. Requires accountId query parameter. On Facebook and Instagram, passing a COMMENT id as `postId` is also supported and returns that comment's replies instead of the post's top-level com
Params:
  - `postId` (path, required): string — Zernio post ID or platform-specific post ID. Zernio IDs are auto-resolved. LinkedIn third-party posts accept full activity URN or numeric ID. On Facebook and Instagram, a comment ID is also accepted here and returns that
  - `accountId` (query, required): string
  - `subreddit` (query): string — (Reddit only) Subreddit name
  - `limit` (query): integer default 25 — Maximum number of comments to return
  - `cursor` (query): string — Pagination cursor, returned by a previous call as `pagination.cursor`. This is the platform's own opaque paging value passed through verbatim: never construct, decode or validate it client-side.
  - `commentId` (query): string — (Reddit and TikTok only) Get replies to a specific comment
Returns:
  - `status`: string
  - `comments`: object[]
    - `id`: string
    - `message`: string
    - `createdTime`: string
    - `from`: object
      - `id`: string
      - `name`: string
      - `username`: string
      - `picture`: string|null
      - `isOwner`: boolean
      - `verifiedType`: enum(blue|government|business|none) — X verified badge type. Only present for X comments.
    - `likeCount`: integer
    - `replyCount`: integer — The platform's own reply count, which includes hidden and deleted replies. Can exceed replies[].length even when repliesHasMore is false or absent.
    - `platform`: string — The platform this comment is from
    - `url`: string|null — Direct link to the comment on the platform (if available)
    - `replies`: object[]
    - `repliesHasMore`: boolean — Facebook only. True when replies[] (capped at 10) does not hold the comment's full reply thread; fetch the rest by passing the comment id as postId to GET /v1/inbox/comments/{postId}. Absent (not false) on every other pl
    - `canReply`: boolean
    - `canDelete`: boolean
    - `canHide`: boolean — Whether this comment can be hidden (Facebook, Instagram, Threads)
    - `canLike`: boolean — Whether this comment can be liked (Facebook, X, Bluesky, Reddit, LinkedIn)
    - `isHidden`: boolean — Whether the comment is currently hidden
    - `isLiked`: boolean — Whether the current user has liked this comment
    - `likeUri`: string|null — Bluesky like URI for unliking
    - `cid`: string|null — Bluesky content identifier
    - `parentId`: string|null — ID of the parent comment. Present on entries inside replies[] for Facebook, Instagram and X. On X it is also present on top-level entries, where it holds the ID of the post replied to. Omitted entirely (key absent, not n
    - `rootUri`: string|null — Bluesky root post URI
    - `rootCid`: string|null — Bluesky root post CID
  - `post`: object|null — (Reddit only) Metadata for the target post, returned alongside the comments in Reddit's single round-trip. Lets integrators render a preview of the post the user is commenting on without an additional request. Absent for
    - `id`: string — Reddit post base36 id (e.g. "1tjtj26")
    - `fullname`: string — Fullname with type prefix (e.g. "t3_1tjtj26")
    - `title`: string
    - `selftext`: string — Body text for self-posts (empty for link posts)
    - `author`: string — Reddit username, without the u/ prefix
    - `subreddit`: string — Subreddit name, without the r/ prefix
    - `permalink`: string — Absolute URL to the post on reddit.com
    - `url`: string — For link posts, the external URL; for self-posts, the Reddit permalink
    - `score`: integer — Net upvotes (upvotes minus downvotes)
    - `numComments`: integer
    - `createdUtc`: integer — Unix timestamp in seconds
    - `over18`: boolean
    - `stickied`: boolean
    - `flairText`: string|null — Link flair text if any
    - `isGallery`: boolean — True if the post is a Reddit gallery (multiple images)
  - `pagination`: object
    - `hasMore`: boolean
    - `cursor`: string|null — Only present when hasMore is true. Absent on the last page, so treat its absence as the end of the thread.
  - `meta`: object
    - `platform`: string
    - `postId`: string
    - `accountId`: string
    - `subreddit`: string|null — (Reddit only) Subreddit name
    - `lastUpdated`: string
    - `adComments`: object|null — (Facebook/Instagram only) Present when this post has no organic comments but is a boosted post: the engagement lives on the ad. Use the ad-comments endpoint instead.
      - `adId`: string — Internal Zernio ad ID
      - `adCommentsUrl`: string — Path to fetch the ad's comments (GET /v1/ads/{adId}/comments)

### POST /v1/inbox/comments/{postId}
Reply to comment — Post a reply to a post or specific comment. Requires accountId in request body. **Idempotency:** send an `Idempotency-Key` header to make retries safe (e.g. after a client-side timeout where delivery is unknown): same ke
Params:
  - `postId` (path, required): string — Zernio post ID or platform-specific post ID. LinkedIn third-party posts accept full activity URN or numeric ID.
  - `Idempotency-Key` (header): string — Optional client-generated unique key (e.g. a UUID) that makes retries safe. Same key + same body replays the original response; same key + different body → 422; key still processing → 409.
Body:
  - `accountId` (required): string
  - `message` (required): string
  - `attachmentUrl`: string — (Facebook only) URL of an image to attach, publishing a photo comment alongside the text. The URL must be publicly accessible so Meta can fetch it. Returns 400 for other platforms.
  - `commentId`: string — Reply to specific comment (optional)
  - `parentCid`: string — (Bluesky only) Parent content identifier
  - `rootUri`: string — (Bluesky only) Root post URI
  - `rootCid`: string — (Bluesky only) Root post CID
Returns:
  - `success`: boolean
  - `data`: object
    - `commentId`: string
    - `isReply`: boolean
    - `cid`: string|null — Bluesky CID

### DELETE /v1/inbox/comments/{postId}
Delete comment — Delete a comment on a post. Supported by Facebook, Instagram, Threads, LinkedIn, Reddit, Bluesky, X (Twitter), YouTube, and TikTok (accounts connected through the TikTok for Business app). Not supported on Google Busines
Params:
  - `postId` (path, required): string — Zernio post ID or platform-specific post ID. LinkedIn third-party posts accept full activity URN or numeric ID.
  - `accountId` (query, required): string
  - `commentId` (query, required): string — For LinkedIn, accepts either the numeric comment ID or the composite comment URN returned by the comments listing (e.g. urn:li:comment:(threadUrn,id))
Returns:
  - `success`: boolean
  - `data`: object
    - `message`: string

### PATCH /v1/inbox/comments/{postId}/{commentId}
Edit comment — Edit the body of a comment the connected account posted. Supported on Reddit only. Reddit keeps the same comment id after an edit. Reddit exposes no API to edit a post title, and a link post has no editable body. To edit
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
Body:
  - `accountId` (required): string — The account ID
  - `platform` (required): enum(reddit) — Only Reddit supports editing a comment
  - `content` (required): string — The new comment body
Returns:
  - `status`: string
  - `commentId`: string
  - `platform`: string

### POST /v1/inbox/comments/{postId}/{commentId}/moderation
Set comment moderation status — Set a comment's moderation status. Supported on YouTube only. Use this to work a moderation queue: approve a held comment (`published`), reject it (`rejected`), or send it back for review (`heldForReview`). The request m
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
Body:
  - `accountId` (required): string — The account ID
  - `platform` (required): enum(youtube) — Only YouTube supports comment moderation
  - `moderationStatus` (required): enum(published|rejected|heldForReview) — published approves the comment, rejected removes it, heldForReview returns it to the queue.
  - `banAuthor`: boolean — Also ban the comment's author, auto-rejecting their future comments. Only valid when moderationStatus is "rejected"; any other pairing is a 400.
Returns:
  - `success`: boolean

### POST /v1/inbox/comments/{postId}/{commentId}/hide
Hide comment — Hide a comment on a post. Supported by Facebook, Instagram, Threads, X, and TikTok (accounts connected through the TikTok for Business app). Hidden comments are only visible to the commenter and page admin. For X, the re
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
Body:
  - `accountId` (required): string — The account ID
Returns:
  - `status`: string
  - `commentId`: string
  - `hidden`: boolean
  - `platform`: string

### DELETE /v1/inbox/comments/{postId}/{commentId}/hide
Unhide comment — Unhide a previously hidden comment. Supported by Facebook, Instagram, Threads, X, and TikTok (accounts connected through the TikTok for Business app).
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
  - `accountId` (query, required): string
Returns:
  - `status`: string
  - `commentId`: string
  - `hidden`: boolean
  - `platform`: string

### POST /v1/inbox/comments/{postId}/{commentId}/pin
Pin comment — Pin a top-level comment to the top of a post's comment section. TikTok accounts connected through the TikTok for Business app only; every other platform returns 400.
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
Body:
  - `accountId` (required): string — The social account ID
Returns:
  - `status`: string
  - `commentId`: string
  - `pinned`: boolean
  - `platform`: string

### DELETE /v1/inbox/comments/{postId}/{commentId}/pin
Unpin comment — Unpin a previously pinned comment. TikTok accounts connected through the TikTok for Business app only.
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
  - `accountId` (query, required): string
Returns:
  - `status`: string
  - `commentId`: string
  - `pinned`: boolean
  - `platform`: string

### POST /v1/inbox/comments/{postId}/{commentId}/like
Like comment — Like or upvote a comment on a post. Supported platforms: Facebook, X, Bluesky, Reddit, LinkedIn, and Instagram in limited release (see below). For Bluesky, the cid (content identifier) is required in the request body. Fo
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
Body:
  - `accountId` (required): string — The account ID
  - `reactionType`: enum(LIKE|PRAISE|EMPATHY|INTEREST|APPRECIATION|ENTERTAINMENT) — (LinkedIn only) Reaction to create. Defaults to LIKE; ignored on other platforms.
  - `cid`: string — (Bluesky only) Content identifier for the comment
Returns:
  - `status`: string
  - `commentId`: string
  - `liked`: boolean
  - `likeUri`: string — (Bluesky only) URI to use for unliking
  - `alreadyReacted`: boolean — LinkedIn only: the account already had this exact reaction, so nothing was created
  - `reactionType`: string — LinkedIn only: the reaction type now in effect
  - `platform`: string

### DELETE /v1/inbox/comments/{postId}/{commentId}/like
Unlike comment — Remove a like from a comment. Supported platforms: Facebook, X, Bluesky, Reddit, LinkedIn, and Instagram in limited release. For Bluesky, the likeUri query parameter is required. Instagram has the same limited release, F
Params:
  - `postId` (path, required): string
  - `commentId` (path, required): string
  - `accountId` (query, required): string
  - `likeUri` (query): string — (Bluesky only) The like URI returned when liking
Returns:
  - `status`: string
  - `commentId`: string
  - `liked`: boolean
  - `platform`: string

### POST /v1/inbox/posts/{postId}/like
Like post — Like (or react to) a post as a connected account. Supported platforms: LinkedIn, X, Facebook, YouTube, Bluesky, and Instagram in limited release (see below). Threads, TikTok and Pinterest expose no like endpoint in their
Params:
  - `postId` (path, required): string — Zernio post ID or the platform's native post ID
Body:
  - `accountId` (required): string — The account acting as the liker
  - `reactionType`: enum(LIKE|PRAISE|EMPATHY|INTEREST|APPRECIATION|ENTERTAINMENT) — (LinkedIn only) Reaction to create. Defaults to LIKE; ignored on other platforms.
  - `cid`: string — (Bluesky only) Content identifier of the post
Returns:
  - `status`: string
  - `postId`: string — The resolved native post ID
  - `platform`: string
  - `liked`: boolean
  - `likeUri`: string — (Bluesky only) URI to use for unliking
  - `alreadyReacted`: boolean — LinkedIn only: the account already had this exact reaction, so nothing was created
  - `reactionType`: string — LinkedIn only: the reaction type now in effect

### DELETE /v1/inbox/posts/{postId}/like
Unlike post — Remove this account's like from a post. Supported platforms: LinkedIn, X, Facebook, YouTube, Bluesky, and Instagram in limited release. On YouTube this clears the rating. Instagram has the same limited release, Facebook 
Params:
  - `postId` (path, required): string — Zernio post ID or the platform's native post ID
  - `accountId` (query, required): string
  - `likeUri` (query): string — (Bluesky only) The like URI returned when liking
Returns:
  - `status`: string
  - `postId`: string — The resolved native post ID
  - `platform`: string
  - `liked`: boolean

### POST /v1/inbox/comments/{postId}/{commentId}/private-reply
Send private reply — Send a direct message to the author of a comment. Supported on Instagram and Facebook only. One reply per comment, must be sent within 7 days. Optionally attach interactive elements: `quickReplies` (chips above the keybo
Params:
  - `postId` (path, required): string — The media/post ID (Instagram media ID or Facebook post ID)
  - `commentId` (path, required): string — The comment ID to send a private reply to
Body:
  - `accountId` (required): string — The account ID (Instagram or Facebook)
  - `message` (required): string — The message text to send as a private DM
  - `quickReplies`: object[] — Optional quick-reply chips appended to the message. Visible only in the Instagram and Messenger apps (not on web). Maximum 13 entries. Mutually exclusive with `buttons`. Note: chips do NOT render in the Instagram Message
    - `title` (required): string — Label shown on the chip. Truncated by Meta beyond 20 characters.
    - `payload` (required): string — Opaque value returned in the inbound webhook when the user taps the chip.
    - `imageUrl`: string — Optional thumbnail shown next to the chip title.
  - `buttons`: object | object | object[] — Optional 1-3 inline buttons rendered as part of the same message bubble via Meta's button_template. Visible in the Instagram Message Requests folder (unlike quick replies). Mutually exclusive with `quickReplies`.
Returns:
  - `status`: string
  - `messageId`: string — The ID of the sent message
  - `commentId`: string — The comment ID that was replied to
  - `platform`: enum(instagram|facebook)

## TAG: Reviews
Unified inbox API for managing reviews on Facebook Pages and Google Business Profile accounts. All endpoints aggregate data from multiple accounts in a single API call. Requires Inbox addon.

### GET /v1/inbox/reviews
List reviews — Fetch reviews from all connected Facebook Pages and Google Business Profile accounts. Aggregates data with filtering and sorting options. Supported platforms: Facebook, Google Business Profile.
Params:
  - `profileId` (query): string
  - `platform` (query): enum(facebook|googlebusiness)
  - `minRating` (query): integer
  - `maxRating` (query): integer
  - `hasReply` (query): boolean — Filter by reply status
  - `sortBy` (query): enum(date|rating) default date
  - `sortOrder` (query): enum(asc|desc) default desc
  - `limit` (query): integer default 25
  - `cursor` (query): string
  - `accountId` (query): string — Filter by specific account ID
Returns:
  - `status`: string
  - `data`: object[]
    - `id`: string — Review identifier. For Google Business Profile this is the full review resource name (accounts/{accountId}/locations/{locationId}/reviews/{reviewId}), so it also encodes the location.
    - `platform`: string
    - `accountId`: string
    - `accountUsername`: string
    - `locationId`: string — Bare Google Business Profile location id the review belongs to. Google Business Profile only; absent for other platforms.
    - `locationName`: string|null — Human-readable Google Business Profile location display name. Google Business Profile only; absent for other platforms.
    - `reviewer`: object
      - `id`: string|null
      - `name`: string
      - `profileImage`: string|null
    - `rating`: integer
    - `text`: string
    - `created`: string
    - `hasReply`: boolean
    - `hasPhotos`: boolean — Whether the review has at least one photo. Google Business Profile only; always false for other platforms.
    - `photoCount`: integer — Number of photos attached to the review (photos only; videos are not counted). Google Business Profile only; 0 for other platforms.
    - `photos`: object[] — Photos attached to the review. Google Business Profile only; always an empty array for other platforms.
      - `url`: string
    - `reply`: object|null
      - `id`: string
      - `text`: string
      - `created`: string
    - `reviewUrl`: string|null
  - `pagination`: object
    - `hasMore`: boolean
    - `nextCursor`: string|null
  - `meta`: object
    - `accountsQueried`: integer
    - `accountsFailed`: integer
    - `failedAccounts`: object[]
      - `accountId`: string
      - `accountUsername`: string|null
      - `platform`: string
      - `error`: string
      - `code`: string|null — Error code if available
      - `retryAfter`: integer|null — Seconds to wait before retry (rate limits)
    - `lastUpdated`: string
    - `accountsSkipped`: object[] — Connected accounts that were not queried: their platform does not support this feature, or the account is not enabled for it
      - `accountId`: string
      - `platform`: string
  - `summary`: object
    - `totalReviews`: integer
    - `averageRating`: number|null

### POST /v1/inbox/reviews/{reviewId}/reply
Reply to review — Post a reply to a review. Requires accountId in request body. **Idempotency:** send an `Idempotency-Key` header to make retries safe (e.g. after a client-side timeout where delivery is unknown): same key + same body repl
Params:
  - `reviewId` (path, required): string — Review ID (URL-encoded for Google Business Profile)
  - `Idempotency-Key` (header): string — Optional client-generated unique key (e.g. a UUID) that makes retries safe. Same key + same body replays the original response; same key + different body → 422; key still processing → 409.
Body:
  - `accountId` (required): string
  - `message` (required): string
Returns:
  - `status`: string
  - `reply`: object
    - `id`: string
    - `text`: string
    - `created`: string
  - `platform`: string

### DELETE /v1/inbox/reviews/{reviewId}/reply
Delete review reply — Delete a reply to a review (Google Business Profile only). Requires accountId in request body.
Params:
  - `reviewId` (path, required): string
Body:
  - `accountId` (required): string
Returns:
  - `status`: string
  - `message`: string
  - `platform`: string

## TAG: Mentions
Unified inbox API for managing mentions across connected accounts. Currently supports LinkedIn organization mentions. Requires Inbox addon.

### GET /v1/inbox/mentions
List mentions — Returns mentions of your connected organization accounts, delivered via platform webhooks. Currently supports LinkedIn organization mentions. Requires Inbox addon.
Params:
  - `accountId` (query): string — Filter by account ID
  - `profileId` (query): string — Filter by profile ID
  - `sortOrder` (query): enum(asc|desc) default desc — Sort order by publishedAt
  - `limit` (query): integer default 25
  - `cursor` (query): string — Cursor for pagination (ID of the last item from the previous page)
Returns:
  - `data`: object[]
    - `id`: string — Mention document ID
    - `platform`: enum(linkedin)
    - `accountId`: string
    - `accountUsername`: string
    - `content`: string — Text of the post that mentioned you
    - `permalink`: string|null — URL to the source post on LinkedIn
    - `authorUrn`: string|null — LinkedIn URN of the person who mentioned you
    - `authorName`: string|null — Display name of the author, resolved from authorUrn. Null when LinkedIn does not allow resolving the profile.
    - `authorUsername`: string|null — LinkedIn vanity name of the author (the slug in their profile URL)
    - `authorPicture`: string|null — Profile picture URL of the author. LinkedIn CDN URLs expire after some time, so fetch promptly rather than storing long-term.
    - `organizationalEntity`: string — URN of the organization that was mentioned
    - `publishedAt`: string
    - `createdAt`: string
  - `pagination`: object
    - `hasMore`: boolean
    - `cursor`: string|null
  - `meta`: object
    - `total`: integer
    - `sortOrder`: enum(asc|desc)

### POST /v1/inbox/mentions/reply
Reply to a mention — Reply to a mention of the connected account. Supported on Instagram only. Two shapes, selected by whether `commentId` is present: - **Comment mention** (someone @mentioned the account inside a comment): pass both `mediaI
Body:
  - `accountId` (required): string — The Instagram account ID
  - `mediaId` (required): string — The ID of the media the account was mentioned in
  - `commentId`: string — The mentioning comment's ID. Omit for a caption mention.
  - `message` (required): string — The reply text
Returns:
  - `success`: boolean
  - `id`: string — ID of the created reply or comment

## TAG: Contacts
Cross-platform contact management (CRM). Contacts are unified identities linked to platform-specific channels (phone, IGSID, etc.). Created automatically when messages arrive, or manually via API.

### GET /v1/contacts
List contacts — List and search contacts for a profile. Supports filtering by tags, platform, subscription status, and text search on name, email and company.
Params:
  - `profileId` (query): string — Filter by profile. Omit to list across all profiles. Matches the profile recorded on the contact itself, which is set when the contact is created and is independent of the profile its account currently belongs to. Filter
  - `accountId` (query): string — Filter by the SocialAccount that owns the contact channel. Contacts are resolved through their channels, so the profileId contact filter is not applied while accountId is set. A profileId sent alongside is still access-c
  - `search` (query): string — Case-insensitive substring match on the contact name, email and company. Phone numbers and other platform identifiers are not matched: they live on the contact channel, not on the contact. To reach a contact from an inbo
  - `tag` (query): string
  - `tags` (query): string — Comma-separated tags, matches contacts carrying any of them
  - `platform` (query): enum(instagram|facebook|telegram|twitter|bluesky|reddit|whatsapp|slack|sms)
  - `isSubscribed` (query): enum(true|false)
  - `limit` (query): integer default 50
  - `skip` (query): integer default 0
Returns:
  - `success`: boolean
  - `contacts`: object[]
    - `id`: string
    - `name`: string
    - `email`: string
    - `company`: string
    - `avatarUrl`: string
    - `tags`: string[]
    - `isSubscribed`: boolean
    - `isBlocked`: boolean
    - `lastMessageSentAt`: string
    - `lastMessageReceivedAt`: string
    - `messagesSentCount`: integer
    - `messagesReceivedCount`: integer
    - `customFields`: object
    - `notes`: string
    - `createdAt`: string
    - `platform`: string
    - `platformIdentifier`: string
    - `displayIdentifier`: string
  - `filters`: object
    - `tags`: string[]
  - `pagination`: object
    - `total`: integer
    - `limit`: integer
    - `skip`: integer
    - `hasMore`: boolean

### POST /v1/contacts
Create contact — Create a new contact. Optionally create a platform channel in the same request by providing accountId, platform, and platformIdentifier.
Body:
  - `profileId` (required): string
  - `name` (required): string
  - `email`: string
  - `company`: string
  - `tags`: string[]
  - `isSubscribed`: boolean
  - `notes`: string
  - `accountId`: string — Optional. Creates a channel if provided with platform + platformIdentifier
  - `platform`: enum(instagram|facebook|telegram|twitter|bluesky|reddit|whatsapp|slack|sms) — Channel platform. Only the enum values support contact channels; any other platform is rejected with code platform_not_supported.
  - `platformIdentifier`: string
  - `displayIdentifier`: string
Returns:
  - `success`: boolean
  - `contact`: object
    - `id`: string
    - `name`: string
    - `email`: string
    - `company`: string
    - `tags`: string[]
    - `isSubscribed`: boolean
    - `isBlocked`: boolean
    - `customFields`: object
    - `notes`: string
    - `createdAt`: string
  - `channel`: object — Created when accountId, platform, and platformIdentifier are provided
    - `id`: string
    - `platform`: string
    - `platformIdentifier`: string
    - `displayIdentifier`: string
  - `warning`: string

### GET /v1/contacts/{contactId}
Get contact — Returns a contact with all associated messaging channels.
Params:
  - `contactId` (path, required): string
Returns:
  - `success`: boolean
  - `contact`: object
    - `id`: string
    - `name`: string
    - `email`: string
    - `company`: string
    - `avatarUrl`: string
    - `tags`: string[]
    - `isSubscribed`: boolean
    - `isBlocked`: boolean
    - `messagesSentCount`: integer — Messages sent to the contact, derived live from message history across all linked conversations.
    - `messagesReceivedCount`: integer — Messages received from the contact, derived live from message history across all linked conversations.
    - `lastMessageSentAt`: string|null — Timestamp of the most recent outgoing message, or null if none.
    - `lastMessageReceivedAt`: string|null — Timestamp of the most recent incoming message, or null if none.
    - `customFields`: object
    - `notes`: string
    - `conversationIds`: string[]
    - `createdAt`: string
    - `updatedAt`: string
  - `channels`: object[]
    - `id`: string
    - `accountId`: string
    - `platform`: string
    - `platformIdentifier`: string
    - `displayIdentifier`: string
    - `isSubscribed`: boolean
    - `conversationId`: string
    - `lastActiveAt`: string|null — Most recent message (either direction) in this channel's conversation, or null if none.
    - `createdAt`: string

### PATCH /v1/contacts/{contactId}
Update contact — Update one or more fields on a contact. Only provided fields are changed.
Params:
  - `contactId` (path, required): string
Body:
  - `name`: string
  - `email`: string
  - `company`: string
  - `avatarUrl`: string
  - `tags`: string[]
  - `isSubscribed`: boolean
  - `isBlocked`: boolean
  - `notes`: string
Returns:
  - `success`: boolean
  - `contact`: object
    - `id`: string
    - `name`: string
    - `email`: string
    - `company`: string
    - `avatarUrl`: string
    - `tags`: string[]
    - `isSubscribed`: boolean
    - `isBlocked`: boolean
    - `notes`: string
    - `updatedAt`: string

### DELETE /v1/contacts/{contactId}
Delete contact — Permanently deletes a contact and all associated channels.
Params:
  - `contactId` (path, required): string

### GET /v1/contacts/{contactId}/channels
List channels for a contact — Returns all messaging channels linked to a contact (e.g. Instagram DM, Telegram, WhatsApp).
Params:
  - `contactId` (path, required): string
Returns:
  - `success`: boolean
  - `channels`: object[]
    - `id`: string
    - `accountId`: string
    - `platform`: string
    - `platformIdentifier`: string
    - `displayIdentifier`: string
    - `isSubscribed`: boolean
    - `conversationId`: string
    - `metadata`: object
    - `createdAt`: string

### POST /v1/contacts/bulk
Bulk create contacts — Import up to 1000 contacts at a time. Skips duplicates, merging any new tags onto the existing contact. accountId is required whenever contacts carry a platformIdentifier (or a row-level accountId); platform is always de
Body:
  - `profileId` (required): string
  - `accountId`: string — Required when contacts carry channel data (platformIdentifier or a row-level accountId). Omit for a plain CRM import with no channels.
  - `platform`: string — Ignored when accountId is set: the platform is derived from the resolved account. Only relevant to disambiguate accountId lookup; a mismatch 404s.
  - `contacts` (required): object[]
    - `name` (required): string
    - `platformIdentifier`: string — Required when the top-level accountId is set (channel mode). A row missing it in that mode is rejected individually and reported in errors[], not a 400 for the whole import.
    - `displayIdentifier`: string
    - `email`: string
    - `company`: string
    - `tags`: string[]
Returns:
  - `success`: boolean
  - `created`: integer
  - `skipped`: integer
  - `errors`: string[] — Per-contact failures, e.g. an identifier that is not a valid phone number
  - `total`: integer

## TAG: Custom Fields
Custom field definitions for contacts. Define fields (text, number, date, boolean, select) that can be set on any contact for segmentation and personalization.

### PUT /v1/contacts/{contactId}/fields/{slug}
Set custom field value — Set or overwrite a custom field value on a contact. The value type must match the field definition.
Params:
  - `contactId` (path, required): string
  - `slug` (path, required): string
Body:
  - `value` (required): object — Field value (type depends on field definition)

### DELETE /v1/contacts/{contactId}/fields/{slug}
Clear custom field value — Remove a custom field value from a contact. The field definition is not affected.
Params:
  - `contactId` (path, required): string
  - `slug` (path, required): string

### GET /v1/custom-fields
List custom field definitions — Returns all custom field definitions. Optionally filter by profile.
Params:
  - `profileId` (query): string — Filter by profile. Omit to list across all profiles
Returns:
  - `success`: boolean
  - `fields`: object[]
    - `id`: string
    - `name`: string
    - `slug`: string
    - `type`: enum(text|number|date|boolean|select)
    - `options`: string[]
    - `createdAt`: string

### POST /v1/custom-fields
Create custom field — Create a new custom field definition. Supported types are text, number, date, boolean, and select.
Body:
  - `profileId` (required): string
  - `name` (required): string
  - `slug`: string — Auto-generated from name if not provided
  - `type` (required): enum(text|number|date|boolean|select)
  - `options`: string[] — Required for select type
Returns:
  - `success`: boolean
  - `field`: object
    - `id`: string
    - `name`: string
    - `slug`: string
    - `type`: enum(text|number|date|boolean|select)
    - `options`: string[]
    - `createdAt`: string

### PATCH /v1/custom-fields/{fieldId}
Update custom field — Update a custom field definition. The field type cannot be changed after creation.
Params:
  - `fieldId` (path, required): string
Body:
  - `name`: string
  - `options`: string[]
Returns:
  - `success`: boolean
  - `field`: object
    - `id`: string
    - `name`: string
    - `slug`: string
    - `type`: string
    - `options`: string[]

### DELETE /v1/custom-fields/{fieldId}
Delete custom field — Delete a custom field definition and remove its values from all contacts.
Params:
  - `fieldId` (path, required): string

## TAG: Inbox Analytics

### GET /v1/analytics/inbox/volume
Get inbox messaging volume — Daily inbox messaging volume + breakdowns. Folds the raw messaging events into three projections so the client can render the volume chart, KPI strip, and per-platform stacked bar from a single call. Max date range is 36
Params:
  - `fromDate` (query, required): string — Inclusive lower bound (YYYY-MM-DD). Required.
  - `toDate` (query): string — Inclusive upper bound (YYYY-MM-DD). Defaults to today.
  - `profileId` (query): string
  - `platform` (query): string — Filter by single platform (facebook, instagram, twitter, etc.).
  - `accountId` (query): string
  - `source` (query): string — Filter by metadata.source lineage (human, workflow, sequence, broadcast, comment_automation, api, contact, platform).
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `summary`: object
    - `received`: integer
    - `sent`: integer
    - `read`: integer
    - `failed`: integer
    - `uniqueConversations`: integer
  - `timeseries`: object[]
    - `date`: string
    - `sent`: integer
    - `received`: integer
    - `read`: integer
    - `failed`: integer
  - `byPlatform`: object[]
    - `platform`: string
    - `sent`: integer
    - `received`: integer
    - `read`: integer
    - `failed`: integer

### GET /v1/analytics/inbox/heatmap
Get day × hour heatmap — Day-of-week × hour-of-day breakdown of inbox messages. Buckets are sparse: only cells with at least one event are returned; clients zero-fill the rest to render the full 7×24 grid. The `dow` field follows ClickHouse's `t
Params:
  - `fromDate` (query, required): string
  - `toDate` (query): string
  - `profileId` (query): string
  - `platform` (query): string
  - `accountId` (query): string
  - `source` (query): string
  - `action` (query): enum(message.received|message.sent|message.read|all) — Narrow to a single event type. "all" or omitted means no filter.
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `buckets`: object[]
    - `dow`: integer — 1 = Monday, 7 = Sunday
    - `hour`: integer
    - `received`: integer
    - `sent`: integer
    - `read`: integer

### GET /v1/analytics/inbox/source-breakdown
Get inbox source breakdown — Breakdown of inbox messages by their lineage source (the `metadata.source` field set at ingest time: human / workflow / sequence / broadcast / comment_automation / api / contact / platform). Each source row also carries 
Params:
  - `fromDate` (query, required): string
  - `toDate` (query): string
  - `profileId` (query): string
  - `platform` (query): string
  - `accountId` (query): string
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `sources`: object[]
    - `source`: string
    - `received`: integer
    - `sent`: integer
    - `read`: integer
    - `byPlatform`: object[]
      - `platform`: string
      - `received`: integer
      - `sent`: integer
      - `read`: integer

### GET /v1/analytics/inbox/response-time
Get inbox response-time stats — Time-to-first-response stats. Pairs each received message with the next sent message in the same conversation and reports the delta as both summary statistics and a fixed-bucket histogram suited for the analytics page's 
Params:
  - `fromDate` (query, required): string
  - `toDate` (query): string
  - `profileId` (query): string
  - `platform` (query): string
  - `accountId` (query): string
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `summary`: object
    - `sampleSize`: integer
    - `medianSeconds`: integer
    - `p90Seconds`: integer
    - `p99Seconds`: integer
    - `meanSeconds`: integer
    - `fastestSeconds`: integer
    - `slowestSeconds`: integer
  - `histogram`: object[]
    - `bucket`: string — Human label (0-1m, 1-5m, 5-15m, 15-60m, 1-4h, 4-24h, 1d+)
    - `lowerSeconds`: integer
    - `upperSeconds`: integer|null — null on the open-ended last bucket
    - `count`: integer

### GET /v1/analytics/inbox/top-accounts
Get top accounts by inbox volume — Leaderboard of accounts by inbox message volume. Decorates each row with display labels from the live SocialAccount record (so the UI shows username + displayName, not only an ID). Accounts that no longer map to a Social
Params:
  - `fromDate` (query, required): string
  - `toDate` (query): string
  - `profileId` (query): string
  - `platform` (query): string
  - `source` (query): string
  - `limit` (query): integer default 10 — Cap on returned rows. Lower than the posting listing's 100 because each row triggers a SocialAccount Mongo lookup.
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `accounts`: object[]
    - `accountId`: string
    - `platform`: string
    - `displayName`: string — (disconnected) when the SocialAccount no longer exists
    - `username`: string
    - `received`: integer
    - `sent`: integer
    - `total`: integer
    - `conversations`: integer
    - `medianResponseSeconds`: integer
    - `repliedCount`: integer — Distinguishes 'instant replies' from 'no replies at all' so a zero medianResponseSeconds with repliedCount=0 renders as an em dash instead of '0s'

### GET /v1/analytics/inbox/conversations
List conversation analytics — Per-conversation listing with per-row totals + first/last message timestamps. The inbox analog of GET /v1/analytics (posts listing): same filter shape, same pagination, same sort/order semantics. Use as the entry point f
Params:
  - `fromDate` (query, required): string
  - `toDate` (query): string
  - `profileId` (query): string
  - `platform` (query): string
  - `accountId` (query): string
  - `source` (query): string
  - `limit` (query): integer default 50
  - `page` (query): integer default 1
  - `sortBy` (query): enum(lastMessageAt|firstMessageAt|totalMessages|received|sent|read|failed) default lastMessageAt
  - `order` (query): enum(asc|desc) default desc
Returns:
  - `success`: boolean
  - `from`: string
  - `to`: string|null
  - `items`: object[]
    - `conversationId`: string — The platformConversationId (the same identity used by metadata.conversationId)
    - `mongoId`: string|null — The Conversation document _id, when a matching doc exists
    - `accountId`: string
    - `platform`: string
    - `participantName`: string|null
    - `participantUsername`: string|null
    - `participantPicture`: string|null
    - `lastMessage`: string|null — Cached preview from the Conversation doc
    - `totalMessages`: integer
    - `received`: integer
    - `sent`: integer
    - `read`: integer
    - `failed`: integer
    - `firstMessageAt`: string
    - `lastMessageAt`: string
  - `pagination`: object
    - `page`: integer
    - `limit`: integer
    - `total`: integer
    - `totalPages`: integer
    - `hasMore`: boolean

### GET /v1/analytics/inbox/conversations/{conversationId}
Get conversation analytics — Per-conversation inbox analytics. The inbox analog of /v1/analytics/post-timeline: one conversation, daily totals, source mix. The {conversationId} path param accepts EITHER the Mongo `_id` of the Conversation document O
Params:
  - `conversationId` (path, required): string — Mongo _id or platformConversationId.
  - `fromDate` (query, required): string
  - `toDate` (query): string
Returns:
  - `success`: boolean
  - `conversationId`: string — The platformConversationId
  - `mongoId`: string
  - `platform`: string|null
  - `from`: string
  - `to`: string|null
  - `summary`: object
    - `received`: integer
    - `sent`: integer
    - `read`: integer
    - `failed`: integer
    - `totalMessages`: integer
    - `firstMessageAt`: string|null
    - `lastMessageAt`: string|null
  - `timeseries`: object[]
    - `date`: string
    - `sent`: integer
    - `received`: integer
    - `read`: integer
    - `failed`: integer
  - `bySource`: object[]
    - `source`: string — (unspecified) for legacy rows with no metadata.source
    - `count`: integer

## TAG: Comment Automations
Comment-to-DM growth automations. Set up keyword triggers on Instagram/Facebook so commenters automatically receive a DM. Scope per post or account-wide (omit `platformPostId` to match comments on every post on the accou

### GET /v1/comment-automations
List comment-to-DM automations — List all comment-to-DM automations for a profile. Returns automations with their stats.
Params:
  - `profileId` (query): string — Filter by profile. Omit to list across all profiles
Returns:
  - `success`: boolean
  - `automations`: object[]
    - `id`: string
    - `name`: string
    - `platform`: enum(instagram|facebook)
    - `trigger`: enum(comment|story_reply)
    - `accountId`: string
    - `platformPostId`: string
    - `postTitle`: string
    - `keywords`: string[]
    - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
    - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
    - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
    - `dmMessage`: string
    - `buttons`: object[] — Inline DM buttons (up to 3). Omitted when none are set.
      - `type` (required): enum(url|postback|phone)
      - `title` (required): string — Button label (20 chars max)
      - `url`: string — Target URL (required when type is url)
      - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
      - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
    - `template`: object — A Meta generic template (product card) sent as the automation's first DM. It REPLACES the plain `dmMessage` bubble: a Meta message carries one body shape, and a comment gets exactly one private reply, so the card and the
      - `type` (required): enum(generic)
      - `imageAspectRatio`: enum(horizontal|square) — Facebook only. How Messenger renders each element imageUrl: horizontal (1.91:1, the default) or square (1:1). Instagram has no such setting, so an Instagram automation carrying it is a 400.
      - `elements` (required): object[]
    - `commentReply`: string
    - `dmMessageVariations`: string[] — Alternate DM texts rotated at random with dmMessage. Omitted when none.
    - `commentReplyVariations`: string[] — Alternate public replies rotated at random with commentReply. Omitted when none.
    - `linkTracking`: boolean — Whether link buttons in the DM are wrapped in a tracked redirect to count clicks.
    - `clickTag`: string — Tag applied to a contact when they click a tracked link.
    - `dmDelaySeconds`: integer — Seconds waited after the trigger before the DM is sent. Absent when the DM goes out immediately.
    - `commentReplyDelaySeconds`: integer — Seconds waited before the public reply is posted. Absent when it follows the DM immediately.
    - `alsoMatchInDms`: boolean — Whether these keywords also fire on a plain inbound DM.
    - `isActive`: boolean
    - `stats`: object
      - `triggered`: integer
      - `dmsSent`: integer
      - `dmsFailed`: integer
      - `uniqueContacts`: integer
      - `trackedSends`: integer — DMs sent with a trackable (wrapped) link. CTR denominator: divide clicks by this, not dmsSent. Lags dmsSent for campaigns that predate click tracking.
      - `linkClicks`: integer — Total clicks on tracked links (bots/prefetch excluded).
      - `uniqueClicks`: integer — Distinct people who clicked a tracked link.
      - `delivered`: integer — DMs confirmed delivered (Messenger; IG emits no delivery receipt).
      - `read`: integer — DMs confirmed read (IG messaging_seen / Messenger message_reads).
    - `createdAt`: string

### POST /v1/comment-automations
Create comment-to-DM automation — Create a keyword-triggered DM automation on an Instagram or Facebook account. When someone comments a matching keyword (or, with `trigger: story_reply`, replies to your Instagram story with one), they automatically recei
Body:
  - `profileId` (required): string
  - `accountId` (required): string — Instagram or Facebook account ID
  - `trigger`: enum(comment|story_reply) — What fires the automation. 'comment' (keyword comment on a post) or 'story_reply' (keyword reply to an Instagram story). For 'story_reply', platformPostId is the story media id (omit for any story).
  - `platformPostId`: string — Platform media/post ID (or story media id when trigger=story_reply). Omit for an account-wide (any-post / any-story) automation.
  - `postId`: string — Zernio post ID (24 hexadecimal characters); platform IDs return 400. Optional and never required. Use it INSTEAD of platformPostId to bind a per-post automation to a not-yet-published Zernio post: the automation stays pe
  - `postTitle`: string — Post content snippet for display
  - `name` (required): string — Automation label
  - `keywords`: string[] — Trigger keywords (empty = any comment triggers)
  - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
  - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
  - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
  - `dmMessage` (required): string — DM text to send to commenter. Max 640 chars when buttons are set, otherwise ~1000.
  - `buttons`: object[] — Optional inline DM buttons (1-3). Phone buttons are Facebook-only. Omit or pass [] for a plain-text DM.
    - `type` (required): enum(url|postback|phone)
    - `title` (required): string — Button label (20 chars max)
    - `url`: string — Target URL (required when type is url)
    - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
    - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
  - `template`: object — Optional product card sent INSTEAD of the plain dmMessage bubble. Mutually exclusive with buttons. dmMessage stays required: it is what gets sent the moment the card is cleared.
    - `type` (required): enum(generic)
    - `imageAspectRatio`: enum(horizontal|square) — Facebook only. How Messenger renders each element imageUrl: horizontal (1.91:1, the default) or square (1:1). Instagram has no such setting, so an Instagram automation carrying it is a 400.
    - `elements` (required): object[]
      - `title` (required): string — Card headline (80 chars max). Also used as the Inbox preview for the sent DM.
      - `subtitle`: string — Card description, e.g. the price or a short pitch (80 chars max).
      - `imageUrl`: string — Publicly reachable http(s) image rendered large above the card.
      - `buttons`: object[] — Up to 3 card buttons. A generic template has NO phone button, on either platform. `url` buttons are click-tracked when linkTracking is on.
  - `commentReply`: string — Optional public reply to the comment
  - `dmMessageVariations`: string[] — Optional alternate DM texts for random rotation. When set, each triggered comment sends one picked at random from [dmMessage, ...dmMessageVariations], so repeat commenters get slightly different DMs (helps avoid identica
  - `commentReplyVariations`: string[] — Optional alternate public replies, rotated at random alongside commentReply (picked independently of the DM). Up to 5.
  - `linkTracking`: boolean — Wrap link buttons in the DM in a tracked redirect so clicks are counted (Link Clicks / CTR). Pass false to send links exactly as written. Defaults to on.
  - `clickTag`: string — Optional tag applied to a contact when they click a tracked link (requires linkTracking). Lets you segment clickers for broadcasts/sequences.
  - `dmDelaySeconds`: integer — Seconds to wait after the trigger before sending the DM. Omit or send 0 to reply immediately (the default). Max 86400 (24h). The trigger is still matched and deduplicated the moment the comment arrives, so a delay only m
  - `commentReplyDelaySeconds`: integer — Seconds to wait before posting the public comment reply. Omit or send 0 to post it right after the DM (the default). The reply never goes out before the DM, so a value below dmDelaySeconds is raised to it. Ignored when t
  - `alsoMatchInDms`: boolean — Also fire these keywords on a plain inbound DM, so the automation answers people who message the keyword instead of commenting it. Requires at least one keyword (an empty keyword list means 'match anything', which would 
  - `audience`: object — Who a comment automation answers. Instagram only - Meta exposes the follow relationship on no other platform, and only for people who have MESSAGED the account (a comment grants no consent). `whenUnknown` is therefore th
    - `followerStatus`: enum(any|follower|non_follower)
    - `minFollowerCount`: integer — Skip commenters with fewer followers than this. Omit for no size rule.
    - `whenUnknown`: enum(send|skip|verify) — What to do when Instagram will not reveal the follow relationship. * `send` (default) - deliver the DM anyway (fails open). * `skip` - stay silent. * `verify` - send `followGate.message` with a confirm button. Tapping it
  - `followGate`: object — Copy for the follow gate. Sensible defaults are used for any field left empty.
    - `message`: string — Confirmation DM sent when whenUnknown=verify.
    - `buttonLabel`: string — Confirm button label. Defaults to "I'm following".
    - `notFollowingMessage`: string — Sent to a commenter we know does not follow (followerStatus=follower). Omit to stay silent on a keyword comment; a confirm tap always gets an answer.
Returns:
  - `success`: boolean
  - `automation`: object
    - `id`: string
    - `name`: string
    - `platform`: string
    - `trigger`: enum(comment|story_reply)
    - `platformPostId`: string
    - `keywords`: string[]
    - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
    - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
    - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
    - `dmMessage`: string
    - `buttons`: object[] — Inline DM buttons (up to 3). Omitted when none are set.
      - `type` (required): enum(url|postback|phone)
      - `title` (required): string — Button label (20 chars max)
      - `url`: string — Target URL (required when type is url)
      - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
      - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
    - `template`: object — A Meta generic template (product card) sent as the automation's first DM. It REPLACES the plain `dmMessage` bubble: a Meta message carries one body shape, and a comment gets exactly one private reply, so the card and the
      - `type` (required): enum(generic)
      - `imageAspectRatio`: enum(horizontal|square) — Facebook only. How Messenger renders each element imageUrl: horizontal (1.91:1, the default) or square (1:1). Instagram has no such setting, so an Instagram automation carrying it is a 400.
      - `elements` (required): object[]
    - `commentReply`: string
    - `dmMessageVariations`: string[] — Alternate DM texts rotated at random with dmMessage. Omitted when none.
    - `commentReplyVariations`: string[] — Alternate public replies rotated at random with commentReply. Omitted when none.
    - `linkTracking`: boolean
    - `clickTag`: string
    - `dmDelaySeconds`: integer — Seconds waited after the trigger before the DM is sent. Absent when the DM goes out immediately.
    - `commentReplyDelaySeconds`: integer — Seconds waited before the public reply is posted. Absent when it follows the DM immediately.
    - `audience`: object — Who a comment automation answers. Instagram only - Meta exposes the follow relationship on no other platform, and only for people who have MESSAGED the account (a comment grants no consent). `whenUnknown` is therefore th
      - `followerStatus`: enum(any|follower|non_follower)
      - `minFollowerCount`: integer — Skip commenters with fewer followers than this. Omit for no size rule.
      - `whenUnknown`: enum(send|skip|verify) — What to do when Instagram will not reveal the follow relationship. * `send` (default) - deliver the DM anyway (fails open). * `skip` - stay silent. * `verify` - send `followGate.message` with a confirm button. Tapping it
    - `followGate`: object — Copy for the follow gate. Sensible defaults are used for any field left empty.
      - `message`: string — Confirmation DM sent when whenUnknown=verify.
      - `buttonLabel`: string — Confirm button label. Defaults to "I'm following".
      - `notFollowingMessage`: string — Sent to a commenter we know does not follow (followerStatus=follower). Omit to stay silent on a keyword comment; a confirm tap always gets an answer.
    - `alsoMatchInDms`: boolean — Whether these keywords also fire on a plain inbound DM.
    - `isActive`: boolean
    - `stats`: object
      - `totalTriggered`: integer
      - `totalSent`: integer
      - `totalFailed`: integer
    - `createdAt`: string

### GET /v1/comment-automations/{automationId}
Get automation details — Returns an automation with its configuration, stats, and recent trigger logs.
Params:
  - `automationId` (path, required): string
Returns:
  - `success`: boolean
  - `automation`: object
    - `id`: string
    - `name`: string
    - `platform`: string
    - `trigger`: enum(comment|story_reply)
    - `accountId`: string
    - `platformPostId`: string
    - `postId`: string
    - `postTitle`: string
    - `keywords`: string[]
    - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
    - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
    - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
    - `dmMessage`: string
    - `buttons`: object[] — Inline DM buttons (up to 3). Omitted when none are set.
      - `type` (required): enum(url|postback|phone)
      - `title` (required): string — Button label (20 chars max)
      - `url`: string — Target URL (required when type is url)
      - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
      - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
    - `template`: object — A Meta generic template (product card) sent as the automation's first DM. It REPLACES the plain `dmMessage` bubble: a Meta message carries one body shape, and a comment gets exactly one private reply, so the card and the
      - `type` (required): enum(generic)
      - `imageAspectRatio`: enum(horizontal|square) — Facebook only. How Messenger renders each element imageUrl: horizontal (1.91:1, the default) or square (1:1). Instagram has no such setting, so an Instagram automation carrying it is a 400.
      - `elements` (required): object[]
    - `commentReply`: string
    - `dmMessageVariations`: string[] — Alternate DM texts rotated at random with dmMessage. Omitted when none.
    - `commentReplyVariations`: string[] — Alternate public replies rotated at random with commentReply. Omitted when none.
    - `linkTracking`: boolean
    - `clickTag`: string
    - `dmDelaySeconds`: integer — Seconds waited after the trigger before the DM is sent. Absent when the DM goes out immediately.
    - `commentReplyDelaySeconds`: integer — Seconds waited before the public reply is posted. Absent when it follows the DM immediately.
    - `audience`: object — Who a comment automation answers. Instagram only - Meta exposes the follow relationship on no other platform, and only for people who have MESSAGED the account (a comment grants no consent). `whenUnknown` is therefore th
      - `followerStatus`: enum(any|follower|non_follower)
      - `minFollowerCount`: integer — Skip commenters with fewer followers than this. Omit for no size rule.
      - `whenUnknown`: enum(send|skip|verify) — What to do when Instagram will not reveal the follow relationship. * `send` (default) - deliver the DM anyway (fails open). * `skip` - stay silent. * `verify` - send `followGate.message` with a confirm button. Tapping it
    - `followGate`: object — Copy for the follow gate. Sensible defaults are used for any field left empty.
      - `message`: string — Confirmation DM sent when whenUnknown=verify.
      - `buttonLabel`: string — Confirm button label. Defaults to "I'm following".
      - `notFollowingMessage`: string — Sent to a commenter we know does not follow (followerStatus=follower). Omit to stay silent on a keyword comment; a confirm tap always gets an answer.
    - `alsoMatchInDms`: boolean — Whether these keywords also fire on a plain inbound DM.
    - `isActive`: boolean
    - `stats`: object
      - `totalTriggered`: integer
      - `totalSent`: integer
      - `totalFailed`: integer
    - `createdAt`: string
    - `updatedAt`: string
  - `logs`: object[]
    - `id`: string
    - `commentId`: string
    - `commenterId`: string
    - `commenterName`: string
    - `commentText`: string
    - `source`: enum(comment|story_reply|dm) — Which door triggered this send. Absent on rows written before this field existed (all of those are comment-triggered).
    - `status`: enum(pending|sent|failed|skipped|gated) — DM outcome. 'pending' = the automation has a dmDelaySeconds and the response is queued but not sent yet. 'gated' = the follow-gate confirmation DM went out and we are waiting for the tap; it flips to 'sent' or 'skipped' 
    - `audienceOutcome`: enum(passed|blocked|gate_sent|gate_passed|gate_failed) — How the audience rule resolved. Absent on automations without one.
    - `commenterIsFollower`: boolean — Follow relationship at decision time. Absent when Instagram would not tell us (the commenter never messaged the account).
    - `commenterFollowerCount`: integer
    - `error`: string — DM error message if status is failed
    - `platformError`: object — Platform error codes of the failed DM (Meta `code` and `error_subcode`), when the platform sent them. Absent on successful rows and on rows written before this field existed.
      - `code`: integer
      - `subcode`: integer
    - `privateReplyConsumed`: boolean — True when the failed send spent the comment's single Instagram private reply (subcode 1545133 or 2534023), the same rule as `details.privateReplyConsumed` on the private-reply endpoint. Absent on direct DMs, on Facebook,
    - `commentReplyStatus`: enum(sent|failed|skipped) — Outcome of the optional public reply on the triggering comment. 'skipped' if no commentReply was configured or if the DM failed (the public reply is not attempted in that case).
    - `commentReplyError`: string — Public-reply error message if commentReplyStatus is failed
    - `nextDueAt`: string — When the next queued send fires. Present only while something is still pending.
    - `createdAt`: string

### PATCH /v1/comment-automations/{automationId}
Update automation settings — Update an automation's keywords, DM message, inline buttons, comment reply, or active status. Pass `buttons: []` to clear all buttons. When `buttons` is non-empty, `dmMessage` (the new one if you're changing it, otherwis
Params:
  - `automationId` (path, required): string
Body:
  - `name`: string
  - `trigger`: enum(comment|story_reply) — What fires the automation. Changing it detaches the automation from its bound post or story (a post id and a story id are different objects), unless this same request sets a new binding. 'story_reply' is Instagram only.
  - `keywords`: string[]
  - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
  - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
  - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
  - `dmMessage`: string
  - `buttons`: object[] — Inline DM buttons (1-3). Pass [] to clear all buttons.
    - `type` (required): enum(url|postback|phone)
    - `title` (required): string — Button label (20 chars max)
    - `url`: string — Target URL (required when type is url)
    - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
    - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
  - `template`: object | null — Product card sent instead of the plain dmMessage bubble. Pass null to clear it and fall back to dmMessage. Mutually exclusive with buttons, including with the buttons already stored on the automation.
  - `commentReply`: string
  - `dmMessageVariations`: string[] — Alternate DM texts for random rotation (see create). Pass [] to clear.
  - `commentReplyVariations`: string[] — Alternate public replies for random rotation. Pass [] to clear.
  - `linkTracking`: boolean — Wrap link buttons in a tracked redirect to count clicks. Pass false to send links untouched.
  - `clickTag`: string — Tag applied to a contact when they click a tracked link (requires linkTracking). Empty string clears it.
  - `alsoMatchInDms`: boolean — Also fire these keywords on a plain inbound DM. Enabling it requires the automation to end up with at least one keyword (this request's keywords if you send them, otherwise the stored ones) and is rejected on story_reply
  - `dmDelaySeconds`: integer — Seconds to wait after the trigger before sending the DM. Send 0 to clear the delay and reply immediately.
  - `commentReplyDelaySeconds`: integer — Seconds to wait before posting the public comment reply. Send 0 to clear it. The reply never goes out before the DM.
  - `audience`: object — Who a comment automation answers. Instagram only - Meta exposes the follow relationship on no other platform, and only for people who have MESSAGED the account (a comment grants no consent). `whenUnknown` is therefore th
    - `followerStatus`: enum(any|follower|non_follower)
    - `minFollowerCount`: integer — Skip commenters with fewer followers than this. Omit for no size rule.
    - `whenUnknown`: enum(send|skip|verify) — What to do when Instagram will not reveal the follow relationship. * `send` (default) - deliver the DM anyway (fails open). * `skip` - stay silent. * `verify` - send `followGate.message` with a confirm button. Tapping it
  - `followGate`: object — Copy for the follow gate. Sensible defaults are used for any field left empty.
    - `message`: string — Confirmation DM sent when whenUnknown=verify.
    - `buttonLabel`: string — Confirm button label. Defaults to "I'm following".
    - `notFollowingMessage`: string — Sent to a commenter we know does not follow (followerStatus=follower). Omit to stay silent on a keyword comment; a confirm tap always gets an answer.
  - `isActive`: boolean
Returns:
  - `success`: boolean
  - `automation`: object
    - `id`: string
    - `name`: string
    - `keywords`: string[]
    - `matchMode`: enum(exact|contains|word) — How a keyword is compared with the comment. 'contains' (default) matches anywhere, even inside another word (keyword 'app' fires on 'happy'). 'word' matches the keyword only as a standalone word. 'exact' requires the who
    - `excludeKeywords`: string[] — Comments containing one of these never trigger the automation, even when a trigger keyword also matches. Compared using the same matchMode.
    - `typoTolerance`: boolean — Only with matchMode=word: also fire on close misspellings of a keyword (one edit for 4-7 character keywords, two from 8 up). Keywords shorter than 4 characters are never fuzzy-matched.
    - `dmMessage`: string
    - `buttons`: object[] — Inline DM buttons (up to 3). Omitted when none are set.
      - `type` (required): enum(url|postback|phone)
      - `title` (required): string — Button label (20 chars max)
      - `url`: string — Target URL (required when type is url)
      - `payload`: string — Postback payload delivered via the messaging_postbacks webhook (required when type is postback)
      - `phone`: string — Phone number, e.g. +14155551234 (required when type is phone; Facebook only)
    - `template`: object — A Meta generic template (product card) sent as the automation's first DM. It REPLACES the plain `dmMessage` bubble: a Meta message carries one body shape, and a comment gets exactly one private reply, so the card and the
      - `type` (required): enum(generic)
      - `imageAspectRatio`: enum(horizontal|square) — Facebook only. How Messenger renders each element imageUrl: horizontal (1.91:1, the default) or square (1:1). Instagram has no such setting, so an Instagram automation carrying it is a 400.
      - `elements` (required): object[]
    - `commentReply`: string
    - `dmMessageVariations`: string[] — Alternate DM texts rotated at random with dmMessage. Omitted when none.
    - `commentReplyVariations`: string[] — Alternate public replies rotated at random with commentReply. Omitted when none.
    - `audience`: object — Who a comment automation answers. Instagram only - Meta exposes the follow relationship on no other platform, and only for people who have MESSAGED the account (a comment grants no consent). `whenUnknown` is therefore th
      - `followerStatus`: enum(any|follower|non_follower)
      - `minFollowerCount`: integer — Skip commenters with fewer followers than this. Omit for no size rule.
      - `whenUnknown`: enum(send|skip|verify) — What to do when Instagram will not reveal the follow relationship. * `send` (default) - deliver the DM anyway (fails open). * `skip` - stay silent. * `verify` - send `followGate.message` with a confirm button. Tapping it
    - `followGate`: object — Copy for the follow gate. Sensible defaults are used for any field left empty.
      - `message`: string — Confirmation DM sent when whenUnknown=verify.
      - `buttonLabel`: string — Confirm button label. Defaults to "I'm following".
      - `notFollowingMessage`: string — Sent to a commenter we know does not follow (followerStatus=follower). Omit to stay silent on a keyword comment; a confirm tap always gets an answer.
    - `alsoMatchInDms`: boolean — Whether these keywords also fire on a plain inbound DM.
    - `isActive`: boolean
    - `updatedAt`: string

### DELETE /v1/comment-automations/{automationId}
Delete automation — Permanently delete an automation and all its trigger logs.
Params:
  - `automationId` (path, required): string

### GET /v1/comment-automations/{automationId}/logs
List automation logs — Paginated list of every comment that triggered this automation, with send status and commenter info.
Params:
  - `automationId` (path, required): string
  - `status` (query): enum(pending|sent|failed|skipped|gated) — Filter by result status
  - `limit` (query): integer default 50
  - `skip` (query): integer default 0
Returns:
  - `success`: boolean
  - `logs`: object[]
    - `id`: string
    - `commentId`: string
    - `commenterId`: string
    - `commenterName`: string
    - `commentText`: string
    - `source`: enum(comment|story_reply|dm) — Which door triggered this send. Absent on rows written before this field existed (all of those are comment-triggered).
    - `status`: enum(pending|sent|failed|skipped|gated) — DM outcome. 'pending' = the automation has a dmDelaySeconds and the response is queued but not sent yet. 'gated' = the follow-gate confirmation DM went out and we are waiting for the tap; it flips to 'sent' or 'skipped' 
    - `audienceOutcome`: enum(passed|blocked|gate_sent|gate_passed|gate_failed) — How the audience rule resolved. Absent on automations without one.
    - `commenterIsFollower`: boolean — Follow relationship at decision time. Absent when Instagram would not tell us (the commenter never messaged the account).
    - `commenterFollowerCount`: integer
    - `error`: string — DM error message if status is failed
    - `platformError`: object — Platform error codes of the failed DM (Meta `code` and `error_subcode`), when the platform sent them. Absent on successful rows and on rows written before this field existed.
      - `code`: integer
      - `subcode`: integer
    - `privateReplyConsumed`: boolean — True when the failed send spent the comment's single Instagram private reply (subcode 1545133 or 2534023), the same rule as `details.privateReplyConsumed` on the private-reply endpoint. Absent on direct DMs, on Facebook,
    - `commentReplyStatus`: enum(sent|failed|skipped) — Outcome of the optional public reply on the triggering comment. 'skipped' if no commentReply was configured or if the DM failed (the public reply is not attempted in that case).
    - `commentReplyError`: string — Public-reply error message if commentReplyStatus is failed
    - `nextDueAt`: string — When the next queued send fires. Present only while something is still pending.
    - `createdAt`: string
  - `pagination`: object
    - `total`: integer
    - `limit`: integer
    - `skip`: integer
    - `hasMore`: boolean
  - `misses`: object — Comments that reached this automation but matched none of its keywords. These produce no log entry, so this is the only signal that a keyword is catching nothing. Retained for a short window, then dropped.
    - `total`: integer — Number of non-matching comments in the retention window
    - `retentionDays`: integer — How many days of non-matching comments the total covers
    - `samples`: object[] — A few of the most recent non-matching comments, for diagnosing a keyword setup.
      - `commentText`: string
      - `commenterName`: string
      - `excludedBy`: string — Set when an exclusion keyword vetoed an otherwise matching comment
      - `at`: string

## TAG: Sequences
Drip campaign sequences. Send a series of messages to enrolled contacts with configurable delays between steps. Supports auto-exit on reply or unsubscribe.

### GET /v1/sequences
List sequences — Returns sequences with enrollment stats. Filter by status, platform, or profile.
Params:
  - `profileId` (query): string — Filter by profile. Omit to list across all profiles
  - `status` (query): enum(draft|active|paused)
  - `limit` (query): integer default 50
  - `skip` (query): integer default 0
Returns:
  - `success`: boolean
  - `sequences`: object[]
    - `id`: string
    - `name`: string
    - `description`: string
    - `platform`: string
    - `accountId`: string
    - `accountName`: string — Display name of the sending account
    - `messagePreview`: string — First step template name or message text snippet
    - `status`: enum(draft|active|paused)
    - `stepsCount`: integer
    - `exitOnReply`: boolean
    - `exitOnUnsubscribe`: boolean
    - `totalEnrolled`: integer
    - `totalCompleted`: integer
    - `totalExited`: integer
    - `createdAt`: string
  - `pagination`: object
    - `total`: integer
    - `limit`: integer
    - `skip`: integer
    - `hasMore`: boolean

### POST /v1/sequences
Create sequence — Create a multi-step messaging sequence. Each step has a delay and a message or WhatsApp template.
Body:
  - `profileId` (required): string
  - `accountId` (required): string
  - `platform` (required): enum(instagram|facebook|telegram|twitter|bluesky|reddit|whatsapp|slack)
  - `name` (required): string
  - `description`: string
  - `steps`: object[]
    - `order` (required): integer
    - `delayMinutes` (required): integer
    - `message`: object
      - `text`: string
    - `template`: object
      - `name`: string
      - `language`: string
      - `variableMapping`: object — Maps template variable positions to contact fields. Keys are position strings ("1", "2"), values are objects with field and optional customValue
  - `exitOnReply`: boolean
  - `exitOnUnsubscribe`: boolean
Returns:
  - `success`: boolean
  - `sequence`: object
    - `id`: string
    - `name`: string
    - `description`: string
    - `platform`: string
    - `status`: string
    - `stepsCount`: integer
    - `createdAt`: string

### GET /v1/sequences/{sequenceId}
Get sequence with steps — Returns a sequence with all its steps and enrollment stats.
Params:
  - `sequenceId` (path, required): string
Returns:
  - `success`: boolean
  - `sequence`: object
    - `id`: string
    - `name`: string
    - `description`: string
    - `platform`: string
    - `accountId`: string
    - `status`: enum(draft|active|paused)
    - `steps`: object[]
      - `order`: integer
      - `delayMinutes`: integer
      - `message`: object
      - `template`: object
    - `exitOnReply`: boolean
    - `exitOnUnsubscribe`: boolean
    - `totalEnrolled`: integer
    - `totalCompleted`: integer
    - `totalExited`: integer
    - `createdAt`: string
    - `updatedAt`: string

### PATCH /v1/sequences/{sequenceId}
Update sequence — Update a sequence's name, steps, or exit conditions. Steps can only be modified while the sequence is draft or paused.
Params:
  - `sequenceId` (path, required): string
Body:
  - `name`: string
  - `description`: string
  - `steps`: object[] — Replace the full step list. Only allowed while the sequence is draft or paused.
    - `order` (required): integer
    - `delayMinutes` (required): integer
    - `message`: object
      - `text`: string
    - `template`: object
      - `name`: string
      - `language`: string
      - `variableMapping`: object
  - `exitOnReply`: boolean
  - `exitOnUnsubscribe`: boolean
Returns:
  - `success`: boolean
  - `sequence`: object
    - `id`: string
    - `name`: string
    - `description`: string
    - `status`: string
    - `steps`: object[]
    - `exitOnReply`: boolean
    - `exitOnUnsubscribe`: boolean
    - `updatedAt`: string

### DELETE /v1/sequences/{sequenceId}
Delete sequence — Permanently delete a sequence. Active enrollments are stopped.
Params:
  - `sequenceId` (path, required): string

### POST /v1/sequences/{sequenceId}/activate
Activate sequence — Start a draft or paused sequence. The sequence must have at least one step.
Params:
  - `sequenceId` (path, required): string
Returns:
  - `success`: boolean
  - `sequence`: object
    - `id`: string
    - `status`: string

### POST /v1/sequences/{sequenceId}/pause
Pause sequence — Pause an active sequence. Enrolled contacts stop receiving messages until the sequence is reactivated.
Params:
  - `sequenceId` (path, required): string
Returns:
  - `success`: boolean
  - `sequence`: object
    - `id`: string
    - `status`: string

### POST /v1/sequences/{sequenceId}/enroll
Enroll contacts in a sequence — Enroll one or more contacts into a sequence. Contacts already enrolled are skipped.
Params:
  - `sequenceId` (path, required): string
Body:
  - `contactIds` (required): string[]
  - `channelIds`: string[] — Optional. Auto-detected if not provided.
Returns:
  - `success`: boolean
  - `enrolled`: integer — Number of contacts successfully enrolled
  - `failed`: integer — Number that failed (already enrolled, or no subscribed channel on the sequence platform)
  - `results`: object[] — Per-contact outcome
    - `contactId`: string
    - `success`: boolean
    - `error`: string — Present when success is false

### DELETE /v1/sequences/{sequenceId}/enroll/{contactId}
Unenroll contact — Remove a contact from a sequence. No further messages will be sent to this contact.
Params:
  - `sequenceId` (path, required): string
  - `contactId` (path, required): string

### GET /v1/sequences/{sequenceId}/enrollments
List enrollments for a sequence — Returns enrolled contacts with their progress, status, and next scheduled step.
Params:
  - `sequenceId` (path, required): string
  - `status` (query): enum(active|completed|exited|paused)
  - `limit` (query): integer default 50
  - `skip` (query): integer default 0
Returns:
  - `success`: boolean
  - `enrollments`: object[]
    - `id`: string
    - `contactId`: string
    - `channelId`: string
    - `platformIdentifier`: string
    - `contactName`: string
    - `currentStepIndex`: integer
    - `status`: enum(active|completed|exited|paused)
    - `exitReason`: string|null
    - `nextStepAt`: string|null
    - `stepsSent`: integer
    - `lastStepSentAt`: string|null
    - `createdAt`: string
  - `pagination`: object
    - `total`: integer
    - `limit`: integer
    - `skip`: integer
    - `hasMore`: boolean