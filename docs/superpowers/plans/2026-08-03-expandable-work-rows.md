# Expandable Work Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Homepage "Selected Work" rows expand in place (Lama Lama style) with description, View case / Visit website buttons, and a horizontal media gallery, backed by two new `projects` columns editable in the dashboard CMS.

**Architecture:** A new migration adds `gallery_urls text[]` and `website_url text` to `projects`. `getSiteProjects()` maps them into `SiteProject`. `LamaWork` (server) passes data to a new `LamaWorkRows` (client) that owns accordion state. The CMS edit form gains a gallery editor (append via upload/URL, reorder, remove) and a website-URL input; reorder logic is a pure, unit-tested helper.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v3.4, shadcn classic (Radix), Supabase (service-role, server-only), vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-expandable-work-rows-design.md`

## Global Constraints

- Tailwind is **v3.4** — no v4 syntax, no Base UI shadcn components.
- `app/globals.css` must not gain bare element selectors (dashboard leak trap).
- Business logic pure and unit-tested (`workflow-core.ts` pattern); wrappers do I/O.
- Service-role key server-only; browser never touches Supabase directly.
- Authorization enforced in API routes via `guard()` — already present; keep it.
- Before claiming done: `npm test`, `npx tsc --noEmit`, `npm run build` all pass.
- Migrations are idempotent `.sql` files in `supabase/`, run by hand in the SQL editor.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration file

**Files:**
- Create: `supabase/project_gallery.sql`

**Interfaces:**
- Produces: `projects.gallery_urls text[] not null default '{}'`, `projects.website_url text` (nullable). All later tasks assume these columns exist in prod after the user runs the file.

- [ ] **Step 1: Write the migration**

```sql
-- ═══ Project gallery: expandable homepage work rows ═══
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).

-- Gallery media for the expanded homepage row. Array order is display
-- order. Each entry is an image or video URL (the site renders <video>
-- for .mp4/.webm/.mov), same convention as card_media_url.
alter table projects add column if not exists gallery_urls text[] not null default '{}';

-- The client's real site, for the VISIT WEBSITE button in the expanded
-- row. Null = button hidden.
alter table projects add column if not exists website_url text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/project_gallery.sql
git commit -m "feat(cms): migration for project gallery_urls and website_url

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note for the final report: the user must run this file in the Supabase SQL editor before CMS saves of the new fields succeed. Code tasks proceed regardless.

---

### Task 2: Pure gallery helpers + tests

**Files:**
- Create: `app/lib/website-gallery-core.ts`
- Test: `tests/website-gallery-core.test.ts`

**Interfaces:**
- Produces:
  - `moveItem<T>(arr: readonly T[], index: number, delta: number): T[]` — returns a NEW array with `arr[index]` shifted by `delta` positions; out-of-range moves clamp to the ends; invalid `index` returns a copy unchanged.
  - `normalizeUrls(value: unknown): string[]` — returns trimmed non-empty strings from an array input; anything that isn't an array (or isn't a string entry) is dropped; non-array input returns `[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/website-gallery-core.test.ts
import { describe, expect, it } from 'vitest'
import { moveItem, normalizeUrls } from '../app/lib/website-gallery-core'

describe('moveItem', () => {
  it('moves an item down by one', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })
  it('moves an item up by one', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })
  it('clamps moves past the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 5)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, -5)).toEqual(['b', 'a', 'c'])
  })
  it('returns an unchanged copy for an invalid index', () => {
    expect(moveItem(['a', 'b'], 7, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
  })
  it('does not mutate the input', () => {
    const arr = ['a', 'b']
    moveItem(arr, 0, 1)
    expect(arr).toEqual(['a', 'b'])
  })
})

describe('normalizeUrls', () => {
  it('trims entries and drops empties and non-strings', () => {
    expect(normalizeUrls([' https://x/a.jpg ', '', 3, null, 'b.mp4'])).toEqual([
      'https://x/a.jpg', 'b.mp4',
    ])
  })
  it('returns [] for non-array input', () => {
    expect(normalizeUrls(undefined)).toEqual([])
    expect(normalizeUrls('nope')).toEqual([])
    expect(normalizeUrls({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/website-gallery-core.test.ts`
Expected: FAIL — cannot resolve `../app/lib/website-gallery-core`.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/website-gallery-core.ts
// Pure helpers for the project gallery editor — no I/O (workflow-core pattern).

/** Return a new array with arr[index] shifted by delta positions.
 *  Moves past either end clamp; an invalid index returns a copy unchanged. */
export function moveItem<T>(arr: readonly T[], index: number, delta: number): T[] {
  const next = [...arr]
  if (index < 0 || index >= arr.length) return next
  const target = Math.min(arr.length - 1, Math.max(0, index + delta))
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

/** Sanitize a client-supplied gallery list: keep trimmed non-empty strings. */
export function normalizeUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/website-gallery-core.test.ts`
Expected: PASS (7 tests). Then run the full suite: `npm test` — all pass (58 existing + 7).

- [ ] **Step 5: Commit**

```bash
git add app/lib/website-gallery-core.ts tests/website-gallery-core.test.ts
git commit -m "feat(cms): pure gallery helpers — moveItem, normalizeUrls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: API routes accept the new fields

**Files:**
- Modify: `app/api/website/projects/route.ts` (POST insert object, ~line 30)
- Modify: `app/api/website/projects/[id]/route.ts` (PATCH `allowed` list, ~line 12)

**Interfaces:**
- Consumes: `normalizeUrls` from `app/lib/website-gallery-core`.
- Produces: POST/PATCH persist `gallery_urls: string[]` and `website_url: string | null`; GET already returns `*` so no change there.

- [ ] **Step 1: POST — add fields to the insert**

In `app/api/website/projects/route.ts`, add the import:

```ts
import { normalizeUrls } from '@/app/lib/website-gallery-core'
```

and inside the `.insert({ ... })` object, after `hero_media_url`:

```ts
      gallery_urls: normalizeUrls(body.gallery_urls),
      website_url: body.website_url || null,
```

- [ ] **Step 2: PATCH — allow and sanitize the fields**

In `app/api/website/projects/[id]/route.ts`, add the same `normalizeUrls` import, add `'gallery_urls', 'website_url'` to the `allowed` array, and after the copy loop sanitize:

```ts
  if ('gallery_urls' in patch) patch.gallery_urls = normalizeUrls(patch.gallery_urls)
  if ('website_url' in patch) patch.website_url = patch.website_url || null
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/website/projects/route.ts "app/api/website/projects/[id]/route.ts"
git commit -m "feat(cms): persist gallery_urls and website_url through the projects API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Site data mapping

**Files:**
- Modify: `app/lib/websiteData.ts`

**Interfaces:**
- Produces: `SiteProject` gains `galleryUrls: string[]` and `websiteUrl: string | null`. Fallback projects yield `[]` / `null`. Task 5 consumes these.

- [ ] **Step 1: Extend the type and both mappers**

In `SiteProject`, after `heroMedia: string`:

```ts
  galleryUrls: string[]
  websiteUrl: string | null
```

In `fromFallback`, after `heroMedia: ...`:

```ts
  galleryUrls: [],
  websiteUrl: null,
```

In `ProjectRow`, after `hero_media_url: string`:

```ts
  gallery_urls: string[] | null
  website_url: string | null
```

(`| null` because rows created before the migration ran may predate the default — the mapper must not trust it.)

In `fromRow`, after `heroMedia: ...`:

```ts
  galleryUrls: r.gallery_urls ?? [],
  websiteUrl: r.website_url || null,
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — clean. Run: `npm test` — all pass.

- [ ] **Step 3: Commit**

```bash
git add app/lib/websiteData.ts
git commit -m "feat(site): map gallery_urls and website_url into SiteProject

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Expandable rows on the homepage

**Files:**
- Create: `app/components/lama/LamaWorkRows.tsx` (client)
- Modify: `app/components/lama/LamaWork.tsx` (server — becomes a thin data wrapper)

**Interfaces:**
- Consumes: `SiteProject` (with `galleryUrls`, `websiteUrl`), `SiteMedia`, `Reveal`, `Scramble`, `getSiteProjects`.
- Produces: `<LamaWorkRows projects={SiteProject[]} />`, default export, client component.

**Key decisions locked in the spec:**
- Row header is a `<button>` (aria-expanded), never a link. The expanded panel is a **sibling** of the button — links must not nest inside a button.
- One row open at a time (`openSlug: string | null`); clicking the open row closes it.
- `( + )` flips to `( − )` when open.
- Height animation: CSS grid-rows trick — outer `grid transition-[grid-template-rows] duration-500 ease-in-out` toggling `grid-rows-[0fr]` / `grid-rows-[1fr]`, inner `overflow-hidden min-h-0`. No JS measurement.
- Panel content mounts on first open and stays mounted (an `opened` set), so the close animation has content and gallery videos don't all load upfront. `SiteMedia` videos autoplay muted — acceptable once a row has been opened.
- Gallery strip renders **only when `galleryUrls.length > 0`** (spec decision: no card-media fallback).
- VISIT WEBSITE renders only when `websiteUrl` is set; it opens in a new tab with `rel="noopener noreferrer"`.

- [ ] **Step 1: Write `LamaWorkRows.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import Reveal from './Reveal'
import { Scramble } from './Scramble'
import SiteMedia from '../SiteMedia'
import type { SiteProject } from '../../lib/websiteData'

// Lama Lama case-row accordion. The header keeps the collapsed 12-col
// anatomy (name 2/12, pills 3/12, ( + ) 1/12, media right) but is a button:
// clicking toggles the panel below — navigation only happens through the
// VIEW CASE / VISIT WEBSITE links inside it. One row open at a time.
export default function LamaWorkRows({ projects }: { projects: SiteProject[] }) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  // once a panel has been opened its content stays mounted, so the close
  // animation has something to collapse and media doesn't all load upfront
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const toggle = (slug: string) => {
    setOpenSlug(cur => (cur === slug ? null : slug))
    setOpened(cur => (cur.has(slug) ? cur : new Set(cur).add(slug)))
  }

  return (
    <section data-lama-title="SELECTED WORK" className="!pt-0 !pb-6">
      {projects.map((c, i) => {
        const isOpen = openSlug === c.slug
        return (
          <Reveal key={c.slug} delay={Math.min(i * 60, 240)}>
            <div className="relative">
              <div aria-hidden="true" className="absolute left-0 right-0 top-0 h-px bg-cream opacity-20" />
              <button
                type="button"
                onClick={() => toggle(c.slug)}
                aria-expanded={isOpen}
                className="group relative flex w-full flex-col text-left lg:flex-row lg:items-center gap-4 lg:gap-6 px-6 sm:px-10 py-5 lg:py-6 hover:bg-cream/5 transition-colors"
              >
                {/* mobile: stacked card — full-width media on top, then the name
                    row with the toggle pushed right, tags wrapping below */}
                <SiteMedia
                  src={c.cardMedia}
                  alt=""
                  className="lg:hidden w-full aspect-video object-cover bg-ink"
                />
                <span className="flex items-baseline justify-between lg:block lg:w-2/12">
                  <span className="font-lamah text-cream text-lg sm:text-xl">{c.name}</span>
                  <span className="font-lamam text-xs text-cream-dim lg:hidden">{isOpen ? '( - )' : '( + )'}</span>
                </span>
                <span className="flex flex-wrap gap-1 lg:w-3/12">
                  {c.services.slice(0, 3).map((s, j) => (
                    <span key={s} className="bg-cream/10 px-2 py-1 font-lamam text-[10px] uppercase tracking-wider text-cream whitespace-nowrap">
                      <Scramble text={s} delay={j * 120} />
                    </span>
                  ))}
                </span>
                <span className="hidden lg:block font-lamam text-xs text-cream-dim lg:w-1/12">{isOpen ? '( - )' : '( + )'}</span>
                <span className="hidden lg:flex justify-end lg:flex-1">
                  <SiteMedia
                    src={c.cardMedia}
                    alt={c.name}
                    className="h-[90px] sm:h-[120px] w-auto object-cover bg-ink opacity-75 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
                  />
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-500 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
                <div className="min-h-0 overflow-hidden">
                  {opened.has(c.slug) && (
                    <div className="flex flex-col gap-6 px-6 pb-8 sm:px-10 lg:gap-8">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={`/work/${c.slug}`}
                            className="border border-cream/25 px-5 py-3 font-lamam text-[11px] uppercase tracking-wider text-cream no-underline transition-colors hover:bg-cream/10"
                          >
                            View case ↗
                          </Link>
                          {c.websiteUrl && (
                            <a
                              href={c.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="border border-cream/25 px-5 py-3 font-lamam text-[11px] uppercase tracking-wider text-cream no-underline transition-colors hover:bg-cream/10"
                            >
                              Visit website ↗
                            </a>
                          )}
                        </div>
                        {c.desc && (
                          <p className="max-w-prose font-lamam text-sm leading-relaxed text-cream-dim lg:w-5/12">
                            {c.desc}
                          </p>
                        )}
                      </div>
                      {c.galleryUrls.length > 0 && (
                        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 sm:-mx-10 sm:px-10">
                          {c.galleryUrls.map(url => (
                            <SiteMedia
                              key={url}
                              src={url}
                              alt={c.name}
                              className="h-[220px] w-auto flex-none object-cover bg-ink sm:h-[300px] lg:h-[400px]"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Reveal>
        )
      })}
    </section>
  )
}
```

- [ ] **Step 2: Rewrite `LamaWork.tsx` as the server wrapper**

Replace the whole file with:

```tsx
import LamaWorkRows from './LamaWorkRows'
import { getSiteProjects } from '../../lib/websiteData'

// Case rows mirroring the reference's js-case-item anatomy. Data comes from
// the CMS (dashboard → Supabase) with the hardcoded list as fallback; the
// interactive accordion lives in LamaWorkRows (client).
export default async function LamaWork() {
  const projects = await getSiteProjects()
  return <LamaWorkRows projects={projects} />
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — clean. Run: `npm run build` — passes (homepage is static; `LamaWorkRows` must carry `'use client'` or the build fails on `useState`).

- [ ] **Step 4: Visual check in dev**

Run `npm run dev`, open `http://localhost:3000/`. Verify: rows render as before collapsed; click expands with the height animation and flips `( + )` → `( - )`; a second row's click closes the first; VIEW CASE navigates to `/work/<slug>`; no VISIT WEBSITE button and no gallery strip yet (no data); reduced-motion still shows content (grid-rows still toggles — acceptable).

- [ ] **Step 5: Commit**

```bash
git add app/components/lama/LamaWorkRows.tsx app/components/lama/LamaWork.tsx
git commit -m "feat(home): expandable work rows with gallery, view case and visit buttons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CMS gallery editor + website URL field

**Files:**
- Modify: `app/dashboard/website/page.tsx`

**Interfaces:**
- Consumes: `moveItem` from `app/lib/website-gallery-core`; existing `MediaThumb`, `UploadField` upload flow, `/api/website/upload`.
- Produces: edit form reads/writes `editing.gallery_urls` and `editing.website_url`; API (Task 3) persists them.

- [ ] **Step 1: Extend the local `Project` type and `EMPTY`**

In the `type Project` block, after `hero_media_url: string`:

```ts
  gallery_urls: string[]
  website_url: string | null
```

In `EMPTY`, after `hero_media_url: ''`:

```ts
  gallery_urls: [], website_url: null,
```

- [ ] **Step 2: Add a `GalleryField` component**

Add after the `UploadField` component (it reuses the same upload endpoint; icons `ChevronDown`, `ChevronUp`, `X` join the existing lucide import; `moveItem` imported from `@/app/lib/website-gallery-core`):

```tsx
function GalleryField({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const append = (url: string) => {
    const clean = url.trim()
    if (clean) onChange([...urls, clean])
  }

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'gallery')
      const res = await fetch('/api/website/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      append(json.url)
      toast.success('Gallery media uploaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label>Gallery</Label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Media strip shown when the homepage row is expanded, in this order. Images or videos.
      </p>
      {urls.length > 0 && (
        <div className="flex flex-col gap-2">
          {urls.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-3">
              <MediaThumb url={url} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{url}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled={i === 0}
                onClick={() => onChange(moveItem(urls, i, -1))} aria-label="Move up">
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled={i === urls.length - 1}
                onClick={() => onChange(moveItem(urls, i, 1))} aria-label="Move down">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                type="button" onClick={() => onChange(urls.filter((_, j) => j !== i))} aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Input
          value={draft}
          placeholder="Paste a URL and press Add, or upload →"
          onChange={e => setDraft(e.target.value)}
          className="flex-1"
        />
        <Button variant="outline" type="button" disabled={!draft.trim()}
          onClick={() => { append(draft); setDraft('') }}>
          Add
        </Button>
        <Button variant="outline" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the two fields into the edit form**

After the Hero media `UploadField` block (the `<div className="sm:col-span-2">` ending around line 243), insert:

```tsx
            <div className="sm:col-span-2">
              <GalleryField
                urls={editing.gallery_urls ?? []}
                onChange={gallery_urls => set({ gallery_urls })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Website URL <span className="text-xs text-zinc-400 dark:text-zinc-500">(optional — adds a “Visit website” button to the homepage row)</span></Label>
              <Input
                value={editing.website_url ?? ''}
                placeholder="https://client-site.com"
                onChange={e => set({ website_url: e.target.value || null })}
              />
            </div>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean. Run: `npm run build` — passes.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/website/page.tsx
git commit -m "feat(cms): gallery editor and website URL on the project form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification

**Files:** none new.

- [ ] **Step 1: Run the full gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: 65 tests pass (58 + 7 new), type check clean, build succeeds. Do not report completion unless all three pass.

- [ ] **Step 2: End-to-end smoke (dev)**

With `npm run dev`: in `/dashboard/website`, edit a project → add a website URL and 2 gallery items (paste URLs) → Save. If the migration hasn't been run, save fails with a Postgres unknown-column error — expected; remind the user to run `supabase/project_gallery.sql`. After it runs: reload `/`, expand the row → gallery strip and VISIT WEBSITE button render.

- [ ] **Step 3: Report**

State test/type/build results verbatim, and remind: run `supabase/project_gallery.sql` in the Supabase SQL editor (idempotent).
