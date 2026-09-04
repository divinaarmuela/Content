# Zernio posting options — network → option → field

Derived once, from Zernio's own docs (verified 3 Sep 2026) and pinned by
`tests/publish-core.test.ts` and `tests/schedule-options-parity.test.ts`. It is
here so nobody has to work it out again from the composer.

**How to read it.** The first column is the network. The second is the control
the composer shows and the words on it. The third is the field the app carries
it in (`PostOptions` in `app/lib/publish-core.ts`, collected per channel as
`ChannelExtras` in `app/lib/schedule-compose-core.ts`). The fourth is what
Zernio is actually sent.

**The one table that decides where a field may go** is `FIELD_PLATFORMS` in
`app/lib/publish-core.ts`; `toPlatformData` writes through it. Meta answers an
unknown field with a 400 naming it — so a YouTube title sent to Instagram is
not ignored, it is a post that never happens.

**Where things sit in the body.** Everything below lands in
`platformSpecificData` for its target, EXCEPT:

- `tiktokSettings` — TOP LEVEL of the body. Zernio's one special case.
- a YouTube thumbnail — it rides on the MEDIA (`mediaItems[].thumbnail`), which
  is the only way to give one channel its own cover without changing
  everybody's. Shorts have no custom thumbnail, so none is attached to one.
- a channel's own words — `customContent`; its own media — `customMedia`.

| Network | The control, and what it says | Our field | Zernio |
|---|---|---|---|
| Instagram | `firstComment` — "Add first comment" | `firstComment` | `platformSpecificData.firstComment` (never on a Story) |
| Instagram | `collaborators` — "Invite collaborator" | `collaborators` | `collaborators` (max 3) |
| Instagram | `shareToFeed` — "Also show the Reel in the feed" | `shareToFeed` | `shareToFeed` |
| Instagram | `location` — "Add location" (saved places + Page ID box) | `locationId` | `locationId` (never on a Story) |
| Instagram | `trialReel` — "Trial Reel" (Off / we decide / Instagram decides) | `trialGraduation` | `trialParams.graduationStrategy` (Reels only) |
| Instagram | `audioName` — "Name the sound" | `audioName` | `audioName` (Reels only) |
| YouTube | `ytTitle` — "Video title" | `title` | `title` (clamped to 100) |
| YouTube | `ytVisibility` — "Who can watch" | `visibility` | `visibility` |
| YouTube | `ytCategory` — "Category" (13 plain names) | `categoryId` | `categoryId` |
| YouTube | `ytPlaylist` — "Add to a playlist" (fetched) | `playlistId` | `playlistId` |
| YouTube | `ytTags` — "Search tags" | `tags` | `tags` (de-duplicated, `#` stripped) |
| YouTube | `ytKids` — "Made for children" | `madeForKids` | `madeForKids` |
| YouTube | `ytThumbnail` — "Cover picture" (not on a Short) | `thumbnailUrl` | `mediaItems[0].thumbnail` — see above |
| YouTube | `ytSynthetic` — "Made with AI…" | `containsSyntheticMedia` | `containsSyntheticMedia` |
| YouTube | `firstComment` | `firstComment` | `firstComment` |
| LinkedIn | `liOrganization` — "Post as a company page" (fetched) | `organizationUrn` | `organizationUrn` |
| LinkedIn | `liLinkPreview` — "Hide the link preview" | `disableLinkPreview` | `disableLinkPreview` |
| LinkedIn | `liDocumentTitle` — "Name for the PDF" | `documentTitle` | `documentTitle` |
| LinkedIn | `firstComment` | `firstComment` | `firstComment` |
| Facebook | `fbPage` — "Which Page" (fetched) | `pageId` | `pageId` |
| Facebook | `fbTitle` — "Reel title" (Reels only) | `title` | `title` |
| Facebook | `fbDraft` — "Save it in Facebook as a draft…" | `facebookDraft` | `facebookSettings.draft` |
| Facebook | `firstComment`, `shareToFeed`, post type | `firstComment`, `shareToFeed`, `kind` | `firstComment`, `shareToFeed`, `contentType: 'reel'\|'story'` |
| TikTok | `ttPrivacy` — "Who can see it" (creator's own list, else the four documented) | `privacyLevel` | `tiktokSettings.privacy_level` |
| TikTok | `ttComments` / `ttDuet` / `ttStitch` (default on; stitch on video only) | `allowComment` / `allowDuet` / `allowStitch` | `allow_comment` / `allow_duet` / `allow_stitch` |
| TikTok | `ttCommercial` — "Is this a promotion?" (Not a promotion / Promoting our own brand / Paid partnership) | `commercialContentType` | `commercial_content_type` |
| TikTok | `ttAi` — "Made with AI" | `videoMadeWithAi` | `video_made_with_ai` |
| TikTok | `ttDraft` — "Send it to the TikTok inbox as a draft…" | `tiktokDraft` | `draft` |
| TikTok | `ttMusic` — "Let TikTok add music" (photo posts) | `autoAddMusic` | `auto_add_music` |
| TikTok | `ttCover` — "Cover frame" (seconds → ms) | `videoCoverTimestampMs` | `video_cover_timestamp_ms` |
| TikTok | (no control yet — carried) | `videoCoverImageUrl` | `video_cover_image_url` (**wins over** the timestamp) |
| TikTok | (no control yet — carried) | `photoCoverIndex` | `photo_cover_index` |
| TikTok | `ttDescription` — "Words for the pictures" (photo posts) | `tiktokDescription` | `description` (clamped to 4,000) |
| TikTok | `ttConsent` — the tick | `tiktokConsent` | **never sent as itself**; it is what `content_preview_confirmed` / `express_consent_given: true` assert |
| X | (no control) | `longVideo` | `longVideo` |
| all | post type — Feed / Reel / Story / Carousel | `kind` | `contentType: 'story'`, `'reel'` (Facebook), otherwise nothing |
| all | this channel's own words | `caption` | `customContent` |
| all | this channel's own media | `media` | `customMedia` |

## The lists the composer fetches per account

Read through `publisher.channelOptions(accountId, platform)`; under
`PUBLISH_DRY_RUN=1` they are answered without a socket.

| Network | Zernio | Comes back as | What it draws |
|---|---|---|---|
| YouTube | `GET /accounts/{id}/youtube-playlists` | `playlists` | the playlist picker |
| LinkedIn | `GET /accounts/{id}/linkedin-organizations` | `organizations` | the company-page picker |
| Facebook | `GET /accounts/{id}/facebook-page` | `pages` | the Page picker |
| TikTok | `GET /accounts/{id}` (creator info) | `privacy`, `interactions`, `commercial` | who can see it, and which interactions the ACCOUNT allows |

## Defaults, so a post can go out untouched

- **TikTok** (`TIKTOK_DEFAULTS`): public, comments/duets/stitches on, and both
  consent flags true — which is why the tick is REQUIRED. `content_preview_
  confirmed` and `express_consent_given` are a legal assertion that a human saw
  the preview and agreed to TikTok's terms, so no path may send them without
  somebody having actually ticked the box.
- **YouTube** (`youtubeDefaults(caption)`): `title` (the caption's first line,
  ≤ 100), `visibility: 'public'`, `categoryId: '22'`, `madeForKids: false` —
  merged UNDER anything actually chosen.

## The refusals, before the network gets a chance to

`optionProblems` runs on the way out (`validatePost`) and while somebody is
still typing (`validateComposition`), so the composer never approves of a post
the publisher would refuse:

- Instagram Story + a place, or + a first comment, or + collaborators
- YouTube title > 100, tags > 500 together, first comment > 10,000
- YouTube with no title and no caption
- TikTok without the tick
- TikTok paid partnership + "only the account itself"
- TikTok description > 4,000, or a cover picture that is not one of the post's
- LinkedIn document name with no PDF in the post

## The cover picture

`asset_versions.cover_url`, chosen in the image editor, becomes the post's
`thumbnailUrl` at booking time (`coverForSlide` → `targetsFor` in
`app/lib/social-schedule.ts`) — under anything typed into a channel's own
"Cover picture" box, never over it. TikTok's `video_cover_image_url` /
`video_cover_timestamp_ms` are separate fields and are carried in the
per-channel extras.
