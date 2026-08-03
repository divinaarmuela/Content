# Expandable work rows on the homepage

**Date:** 2026-08-03
**Reference:** lamalama.com projects section (the design the `Lama*` components already mirror)

## What

The homepage "Selected Work" rows (`LamaWork`) become click-to-expand accordion
rows instead of links. Clicking a row expands a panel in place: project
description on the right, `VIEW CASE ↗` / `VISIT WEBSITE ↗` buttons on the
left, and a full-width horizontally scrolling media gallery below. One row open
at a time; opening another closes the previous. `( + )` flips to `( − )` while
open.

Observed reference behavior (verified in-browser): the row itself is a
`<button>`, never a link; navigation happens only through the buttons inside
the expanded panel; the gallery is ~400px tall, wider than the viewport, and
mixes images with muted looping videos.

## Data

New idempotent migration `supabase/project_gallery.sql` (run by hand in the
SQL editor, like the others):

- `projects.gallery_urls text[] not null default '{}'` — array order is
  display order (same pattern as `services`).
- `projects.website_url text` — nullable; the client's real site.

## CMS (`/dashboard/website`)

In the project edit dialog:

- **Gallery section:** current items as thumbnails with remove and up/down
  reorder controls (no drag-and-drop). Append via the existing
  paste-URL-or-upload control (`/api/website/upload`).
- **Website URL:** plain text input.
- Both columns added to the allowed-field list in
  `/api/website/projects` (POST) and `/api/website/projects/[id]` (PATCH).

## Site rendering

- `getSiteProjects()` maps the two new columns into `SiteProject`
  (`galleryUrls: string[]`, `websiteUrl: string | null`). The hardcoded
  fallback list yields `[]` / `null`.
- `LamaWork` stays a server component; it passes projects to a new client
  component `LamaWorkRows` that owns a single `openSlug` state (accordion).
- Collapsed row: today's exact layout, rendered as a `<button>`.
- Expanded panel (CSS height transition on a measured wrapper):
  - description (`desc`) top-right;
  - `VIEW CASE ↗` → `/work/[slug]`, always; `VISIT WEBSITE ↗` → `website_url`,
    only when set — bordered mono buttons under the name;
  - gallery strip **only when `gallery_urls` is non-empty** (no card-media
    fallback — decided): full-width, horizontal scroll, ~400px tall items,
    images or muted looping videos via existing `SiteMedia` / `isVideoUrl`.
- Mobile: same accordion; gallery stays a horizontal scroller (matches the
  services scroller pattern).
- `/work` and `/work/[slug]` are untouched.

## Error handling

Degrades to current behavior: missing gallery → no strip; missing website URL
→ no visit button; fallback projects expand with description + View case only.

## Out of scope

Multi-thumbnail strip in the *collapsed* state (the reference shows one; we
keep the single card image until galleries are populated).

## Verification

`npm test`, `npx tsc --noEmit`, `npm run build` all pass. Migration must be
run in the Supabase SQL editor before the new CMS fields will save.
