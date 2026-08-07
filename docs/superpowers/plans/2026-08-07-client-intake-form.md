# Client Intake Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super admin creates a per-client intake form, sends an unguessable no-login link, and the client fills it in over several sittings while every answer is saved against the client record.

**Architecture:** A pure, fully-tested core (`intake-core.ts`) owns the template shape, answer merging, completion counting and status transitions — no I/O, mirroring `workflow-core.ts`. A thin server layer does the database work. The public page is reached by token only, following the existing `/portal/<token>` pattern: `noindex`, `force-dynamic`, Clerk-free. Each form freezes its own copy of the template definition on creation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v3.4, Supabase, vitest.

## Global Constraints

- **Tailwind is v3.4, not v4.** Never install a shadcn component in `base-nova` / Base UI style — it compiles to nothing, silently.
- **shadcn is classic Radix.**
- Business logic lives in pure functions; wrappers do the database work.
- Authorization is enforced **server-side in the API route**. Hiding a button is presentation, not security.
- The service-role key is server-only. Browser code never touches Supabase directly.
- Route protection is an explicit allowlist in `middleware.ts`. Everything not listed is public.
- Tests live in `tests/*.test.ts` and import from `../app/lib/...`. Config is `vitest.config.mts`.
- Before claiming any task done: `npm test`, `npx tsc --noEmit`, and `npm run build` must all pass.
- Migrations are idempotent SQL in `supabase/`, run by hand in the SQL editor.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/intake-core.ts` | **Create.** Pure: types, answer merge, completion, status machine, validation. No imports beyond types. |
| `app/lib/intake-templates.ts` | **Create.** The three template definitions as data. No logic. |
| `app/lib/intake.ts` | **Create.** Database wrapper: create, load by token, save answers, submit, reopen, rotate. |
| `supabase/intake.sql` | **Create.** Idempotent migration: `intake_forms`, `intake_files`. |
| `app/api/intake/[token]/route.ts` | **Create.** Public GET + PATCH by token. No Clerk. |
| `app/api/intake/[token]/upload/route.ts` | **Create.** Token-gated presigned upload. |
| `app/api/intake/[token]/submit/route.ts` | **Create.** Public submit. Locks the form, notifies. |
| `app/api/clients/[id]/intake/route.ts` | **Create.** `super_admin`: create form, rotate token, reopen. |
| `app/intake/[token]/page.tsx` | **Create.** Public page shell. `noindex`, `force-dynamic`. |
| `app/intake/[token]/IntakeForm.tsx` | **Create.** Client component: renders blocks, autosaves. |
| `app/intake/[token]/blocks.tsx` | **Create.** One renderer per block type. Split from the form so neither file grows unwieldy. |
| `app/dashboard/clients/[id]/IntakePanel.tsx` | **Create.** Dashboard side: create, copy link, status, answers. |
| `tests/intake-core.test.ts` | **Create.** Covers every pure function. |

---

### Task 1: The pure core — types and answer merging

**Files:**
- Create: `app/lib/intake-core.ts`
- Test: `tests/intake-core.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BlockType`, `Block`, `Section`, `TemplateDefinition`, `TemplateKey`, `Answers`, `IntakeStatus`, `answerableBlocks(def): Block[]`, `mergeAnswers(def, current, patch): Answers`.

- [ ] **Step 1: Write the failing test**

Create `tests/intake-core.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { answerableBlocks, mergeAnswers, type TemplateDefinition } from '../app/lib/intake-core'

const DEF: TemplateDefinition = {
  key: 'rebrand',
  name: 'Rebrand intake',
  sections: [
    {
      id: 'brand', title: 'Brand snapshot',
      blocks: [
        { id: 'g1', type: 'guidance', label: 'Tell us who you are.' },
        { id: 'venue_name', type: 'short_text', label: 'Venue name' },
        { id: 'website', type: 'link', label: 'Website URL' },
      ],
    },
    {
      id: 'voice', title: 'Brand and voice',
      blocks: [
        { id: 'tone', type: 'select', label: 'Tone of voice', options: ['Warm', 'Premium', 'Both'] },
        { id: 'never', type: 'long_text', label: 'Three words it should never feel' },
      ],
    },
  ],
}

describe('answerableBlocks', () => {
  it('excludes guidance blocks — they are copy, not questions', () => {
    expect(answerableBlocks(DEF).map(b => b.id))
      .toEqual(['venue_name', 'website', 'tone', 'never'])
  })
})

describe('mergeAnswers', () => {
  it('merges a patch over existing answers without touching the rest', () => {
    const merged = mergeAnswers(DEF, { venue_name: 'The Emerald', tone: 'Both' }, { tone: 'Warm' })
    expect(merged).toEqual({ venue_name: 'The Emerald', tone: 'Warm' })
  })

  it('ignores keys that are not blocks in this template', () => {
    const merged = mergeAnswers(DEF, { venue_name: 'The Emerald' }, { evil: 'x', website: 'a.com' })
    expect(merged).toEqual({ venue_name: 'The Emerald', website: 'a.com' })
  })

  it('ignores guidance ids — copy can never hold an answer', () => {
    expect(mergeAnswers(DEF, {}, { g1: 'nope' })).toEqual({})
  })

  it('keeps an array answer for a multi-select and coerces other values to string', () => {
    const def: TemplateDefinition = {
      key: 'launch', name: 'x',
      sections: [{ id: 's', title: 's', blocks: [
        { id: 'pillars', type: 'multi_select', label: 'Pillars', options: ['a', 'b'] },
        { id: 'year', type: 'short_text', label: 'Year' },
      ] }],
    }
    expect(mergeAnswers(def, {}, { pillars: ['a', 'b'], year: 1985 as unknown as string }))
      .toEqual({ pillars: ['a', 'b'], year: '1985' })
  })

  it('an empty string clears an answer rather than storing blank', () => {
    expect(mergeAnswers(DEF, { venue_name: 'The Emerald' }, { venue_name: '' })).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/intake-core"`.

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/intake-core.ts`:

```ts
/**
 * Pure intake-form core — no imports, no I/O, fully unit-testable.
 * Owns the template shape, answer merging, completion counting and the status
 * machine. The server layer (intake.ts) executes these rules; nothing else
 * decides what a valid answer set looks like.
 */

export type TemplateKey = 'one_off' | 'launch' | 'rebrand'

/** `guidance` is copy, not a question — the italic "why we're asking" text that
 *  produces a considered answer instead of a one-liner. It never holds a value. */
export type BlockType =
  | 'guidance' | 'short_text' | 'long_text' | 'link'
  | 'select' | 'multi_select' | 'checkbox' | 'file'

export type Block = {
  /** stable — answers key off this, so relabelling a question never orphans one */
  id: string
  type: BlockType
  label: string
  help?: string
  options?: string[]
  placeholder?: string
}

export type Section = { id: string; title: string; intro?: string; blocks: Block[] }

export type TemplateDefinition = { key: TemplateKey; name: string; sections: Section[] }

export type Answers = Record<string, string | string[]>

export type IntakeStatus = 'draft' | 'sent' | 'in_progress' | 'submitted'

const MULTI: BlockType[] = ['multi_select', 'checkbox', 'file']

/** Every block that can hold an answer. Guidance is excluded by definition. */
export function answerableBlocks(def: TemplateDefinition): Block[] {
  return def.sections.flatMap(s => s.blocks).filter(b => b.type !== 'guidance')
}

/**
 * Apply a patch to an answer set.
 *
 * Autosave sends one field at a time, so this must never clobber the rest.
 * Keys absent from the template are dropped rather than stored: the public
 * route is unauthenticated, and a stray key would otherwise persist whatever
 * a caller invented.
 */
export function mergeAnswers(
  def: TemplateDefinition, current: Answers, patch: unknown,
): Answers {
  const known = new Map(answerableBlocks(def).map(b => [b.id, b]))
  const out: Answers = { ...current }
  if (!patch || typeof patch !== 'object') return out

  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const block = known.get(key)
    if (!block) continue

    if (MULTI.includes(block.type)) {
      const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : []
      if (list.length === 0) delete out[key]
      else out[key] = list
      continue
    }

    const value = raw == null ? '' : String(raw)
    // blank clears rather than storing "" — an empty answer and no answer are
    // the same thing, and storing both makes completion counting lie
    if (value.trim() === '') delete out[key]
    else out[key] = value
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/intake-core.ts tests/intake-core.test.ts
git commit -m "$(cat <<'EOF'
feat(intake): pure core — template types and answer merging

Autosave sends one field at a time, so merging must never clobber the
rest. Keys absent from the template are dropped: the public route is
unauthenticated and a stray key would otherwise persist whatever a caller
invented. Blank clears rather than storing "" — an empty answer and no
answer are the same thing, and storing both makes completion lie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Completion counting and the status machine

**Files:**
- Modify: `app/lib/intake-core.ts`
- Test: `tests/intake-core.test.ts`

**Interfaces:**
- Consumes: `TemplateDefinition`, `Answers`, `IntakeStatus`, `answerableBlocks` from Task 1.
- Produces: `completion(def, answers): Completion`, `Completion`, `SectionProgress`, `isWritable(status): boolean`, `nextStatus(current, event): IntakeStatus`, `IntakeEvent`.

- [ ] **Step 1: Write the failing test**

Append to `tests/intake-core.test.ts`:

```ts
import { completion, isWritable, nextStatus } from '../app/lib/intake-core'

describe('completion', () => {
  it('counts answered blocks overall and per section, ignoring guidance', () => {
    const c = completion(DEF, { venue_name: 'The Emerald', tone: 'Both' })
    expect(c.answered).toBe(2)
    expect(c.total).toBe(4)
    expect(c.sections).toEqual([
      { id: 'brand', title: 'Brand snapshot', answered: 1, total: 2 },
      { id: 'voice', title: 'Brand and voice', answered: 1, total: 2 },
    ])
  })

  it('counts an empty array as unanswered', () => {
    const def: TemplateDefinition = {
      key: 'launch', name: 'x',
      sections: [{ id: 's', title: 's', blocks: [
        { id: 'files', type: 'file', label: 'Logo files' },
      ] }],
    }
    expect(completion(def, { files: [] }).answered).toBe(0)
    expect(completion(def, { files: ['a.png'] }).answered).toBe(1)
  })
})

describe('isWritable', () => {
  it('allows writes until submitted', () => {
    expect(isWritable('draft')).toBe(true)
    expect(isWritable('sent')).toBe(true)
    expect(isWritable('in_progress')).toBe(true)
  })

  it('refuses writes once submitted — a forwarded link cannot rewrite history', () => {
    expect(isWritable('submitted')).toBe(false)
  })
})

describe('nextStatus', () => {
  it('marks in_progress on the first save, not on opening the link', () => {
    expect(nextStatus('sent', 'open')).toBe('sent')
    expect(nextStatus('sent', 'save')).toBe('in_progress')
  })

  it('does not move backwards once in progress', () => {
    expect(nextStatus('in_progress', 'save')).toBe('in_progress')
    expect(nextStatus('in_progress', 'open')).toBe('in_progress')
  })

  it('submits from any writable state', () => {
    expect(nextStatus('sent', 'submit')).toBe('submitted')
    expect(nextStatus('in_progress', 'submit')).toBe('submitted')
  })

  it('reopening returns to in_progress so the client can carry on', () => {
    expect(nextStatus('submitted', 'reopen')).toBe('in_progress')
  })

  it('a save against a submitted form changes nothing', () => {
    expect(nextStatus('submitted', 'save')).toBe('submitted')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: FAIL — `completion is not a function` (or an import error).

- [ ] **Step 3: Write minimal implementation**

Append to `app/lib/intake-core.ts`:

```ts
export type SectionProgress = { id: string; title: string; answered: number; total: number }
export type Completion = { answered: number; total: number; sections: SectionProgress[] }

function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' && value.trim() !== ''
}

/** Progress, for a client filling this in over three sittings. Never blocking —
 *  incomplete submission is explicitly allowed. */
export function completion(def: TemplateDefinition, answers: Answers): Completion {
  const sections = def.sections.map(s => {
    const blocks = s.blocks.filter(b => b.type !== 'guidance')
    return {
      id: s.id,
      title: s.title,
      answered: blocks.filter(b => isAnswered(answers[b.id])).length,
      total: blocks.length,
    }
  })
  return {
    answered: sections.reduce((n, s) => n + s.answered, 0),
    total: sections.reduce((n, s) => n + s.total, 0),
    sections,
  }
}

export type IntakeEvent = 'open' | 'save' | 'submit' | 'reopen'

/** Submitted forms are read-only. The token is the only credential, so a
 *  forwarded link must not be able to alter answers a shot list was built on. */
export function isWritable(status: IntakeStatus): boolean {
  return status !== 'submitted'
}

export function nextStatus(current: IntakeStatus, event: IntakeEvent): IntakeStatus {
  if (event === 'reopen') return current === 'submitted' ? 'in_progress' : current
  if (!isWritable(current)) return current
  if (event === 'submit') return 'submitted'
  // 'started' means they typed something, not that they opened the link
  if (event === 'save') return 'in_progress'
  return current
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: PASS — 14 tests total.

- [ ] **Step 5: Commit**

```bash
git add app/lib/intake-core.ts tests/intake-core.test.ts
git commit -m "$(cat <<'EOF'
feat(intake): completion counting and the status machine

in_progress is set by the first save, not by opening the link, so
"started" means they actually typed something. Submitted forms are
read-only: the token is the only credential, and a forwarded link must
not alter answers a shot list was built on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The three templates

**Files:**
- Create: `app/lib/intake-templates.ts`
- Test: `tests/intake-core.test.ts`

**Interfaces:**
- Consumes: `TemplateDefinition`, `TemplateKey`, `answerableBlocks` from Tasks 1–2.
- Produces: `TEMPLATES: Record<TemplateKey, TemplateDefinition>`, `templateFor(key): TemplateDefinition`.

- [ ] **Step 1: Write the failing test**

Append to `tests/intake-core.test.ts`:

```ts
import { TEMPLATES, templateFor } from '../app/lib/intake-templates'
import { answerableBlocks as blocksOf } from '../app/lib/intake-core'

describe('templates', () => {
  it('defines all three engagement types', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['launch', 'one_off', 'rebrand'])
  })

  it('gives every block a unique id within its template', () => {
    for (const def of Object.values(TEMPLATES)) {
      const ids = def.sections.flatMap(s => s.blocks).map(b => b.id)
      expect(new Set(ids).size, `duplicate block id in ${def.key}`).toBe(ids.length)
    }
  })

  it('gives every select and multi_select at least two options', () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const b of blocksOf(def)) {
        if (b.type === 'select' || b.type === 'multi_select') {
          expect((b.options ?? []).length, `${def.key}/${b.id}`).toBeGreaterThan(1)
        }
      }
    }
  })

  it('asks the rebrand client about heritage, and the one-off client not at all', () => {
    const rebrandIds = blocksOf(TEMPLATES.rebrand).map(b => b.id)
    expect(rebrandIds).toContain('history')
    expect(blocksOf(TEMPLATES.one_off).map(b => b.id)).not.toContain('history')
  })

  it('captures the approval contact in every template — production needs it', () => {
    for (const def of Object.values(TEMPLATES)) {
      expect(blocksOf(def).map(b => b.id), def.key).toContain('approval_contact')
    }
  })

  it('falls back to one_off for an unknown key rather than throwing', () => {
    expect(templateFor('nonsense' as never).key).toBe('one_off')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/intake-templates"`.

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/intake-templates.ts`. The `rebrand` template below is derived from the completed Emerald Receptions form — build `launch` and `one_off` by the same pattern, dropping the heritage section from `one_off` and replacing it with a launch-goals section for `launch`.

```ts
import type { TemplateDefinition, TemplateKey } from './intake-core'

/**
 * The three intake questionnaires, as data.
 *
 * Authored in code deliberately: there is one proven template (the Emerald
 * rebrand form) and building a dashboard form builder before the other two
 * exist would build the wrong abstraction. The shape is JSONB from the first
 * commit, so a builder is a later addition rather than a rewrite.
 *
 * Block ids are STABLE. Relabel freely; never rename an id — answers key off it.
 */

const APPROVALS = {
  id: 'approvals', title: 'Approvals and sign-off',
  intro: 'One approver keeps feedback consistent. Mixed feedback is what turns two revision rounds into five.',
  blocks: [
    { id: 'approval_contact', type: 'short_text' as const, label: 'Single approval contact', help: 'One person, to keep feedback consistent.' },
    { id: 'approval_turnaround', type: 'select' as const, label: 'Agreed feedback turnaround', options: ['24 hours', '48 hours', '3–5 business days'] },
    { id: 'approval_cc', type: 'short_text' as const, label: 'Anyone else who must see content before it goes out' },
    { id: 'claims_to_avoid', type: 'long_text' as const, label: 'Any claims or language to avoid', help: 'Capacity, pricing, completion dates not yet locked.' },
  ],
}

const GOALS = {
  id: 'goals', title: 'Goals and what success looks like',
  blocks: [
    { id: 'success_90', type: 'long_text' as const, label: 'At our 90-day review, what would make you say this was the best decision you made this year?' },
    { id: 'healthy_presence', type: 'long_text' as const, label: 'What does a healthy social presence look like to you?' },
    { id: 'signals', type: 'long_text' as const, label: 'Enquiry or booking signals worth tracking', help: 'Saves, shares, DMs, enquiry quality.' },
    { id: 'off_limits', type: 'long_text' as const, label: 'Anything you do NOT want covered or shown' },
  ],
}

const REBRAND: TemplateDefinition = {
  key: 'rebrand',
  name: 'Rebrand and rebuild intake',
  sections: [
    {
      id: 'intro', title: 'Welcome',
      blocks: [{
        id: 'welcome', type: 'guidance',
        label: 'This form is the foundation we build everything on — the brand, the shoot, the content, the ongoing strategy. The more you give us here, the sharper the work we hand back. Take your time. There are no wrong answers, only honest ones. Incomplete is fine — send what you have.',
      }],
    },
    {
      id: 'brand', title: 'Brand snapshot',
      blocks: [
        { id: 'public_name', type: 'short_text', label: 'Business name, as it appears publicly' },
        { id: 'website', type: 'link', label: 'Website URL' },
        { id: 'socials', type: 'short_text', label: 'Instagram / social handles' },
        { id: 'established', type: 'short_text', label: 'Year originally established' },
        { id: 'locations', type: 'short_text', label: 'Location(s)' },
        { id: 'reopening', type: 'short_text', label: 'Target reopening or launch date' },
        { id: 'booking_channels', type: 'multi_select', label: 'Primary booking channels', options: ['Enquiry form', 'Walk-in', 'Referral', 'Ads', 'Previous customers', 'Social media'] },
      ],
    },
    {
      id: 'people', title: 'The people',
      intro: 'Who we are working with, and who appears in the story.',
      blocks: [
        { id: 'primary_contact', type: 'long_text', label: 'Primary contact — full name and title as it should appear publicly' },
        { id: 'contact_mobile', type: 'short_text', label: 'Mobile (best for shoot day)' },
        { id: 'contact_email', type: 'short_text', label: 'Email' },
        { id: 'on_camera_family', type: 'long_text', label: 'Family or owners who can appear', help: 'Names, relationship to the business, comfort level on camera.' },
        { id: 'on_camera_team', type: 'long_text', label: 'Team members who can appear', help: 'Anyone customer-facing.' },
        { id: 'signs_creative', type: 'short_text', label: 'Who signs off on creative' },
        { id: 'signs_spend', type: 'short_text', label: 'Who signs off on spend' },
      ],
    },
    {
      id: 'story', title: 'The story',
      intro: 'Specific and named beats generic every time. The more honest you are here, the more powerful the footage.',
      blocks: [
        { id: 'history', type: 'long_text', label: 'Your history in your own words', help: 'How it started, and what it has meant to people over the years.' },
        { id: 'turning_point', type: 'long_text', label: 'The turning point that led to this rebuild', help: 'Only what you are comfortable sharing.' },
        { id: 'why_rebuild', type: 'long_text', label: 'Why you chose to rebuild rather than walk away', help: 'This is usually the emotional core of the story.' },
        { id: 'whats_better', type: 'long_text', label: 'What is different or better about the new space' },
        { id: 'design_decisions', type: 'long_text', label: 'Key design and material decisions worth explaining on camera' },
        { id: 'archival', type: 'long_text', label: 'Archival material available, and where it lives' },
        { id: 'milestones', type: 'long_text', label: 'Build milestones still ahead', help: 'So we can align filming with key moments before the reveal.' },
      ],
    },
    {
      id: 'voice', title: 'Brand and voice',
      blocks: [
        { id: 'three_words', type: 'short_text', label: 'Three words you should feel to a customer' },
        { id: 'never_words', type: 'short_text', label: 'Three words it should never feel' },
        { id: 'admired', type: 'long_text', label: 'Brands you admire (any industry) and why' },
        { id: 'perception', type: 'long_text', label: 'How you want to be perceived versus your competitors' },
        { id: 'tone', type: 'select', label: 'Tone of voice', options: ['Warm and family', 'Aspirational and premium', 'Both, balanced'] },
        { id: 'tagline', type: 'short_text', label: 'Tagline or signature phrase, if any' },
        { id: 'brand_files', type: 'file', label: 'Logo files, brand colours and fonts' },
      ],
    },
    {
      id: 'pillars', title: 'Content pillars and strategy',
      intro: 'Strategy and direction come from you; we execute to the brief. Without this we cannot build a shot list.',
      blocks: [
        { id: 'content_pillars', type: 'long_text', label: 'Your content pillars', help: 'Three to five themes you want to be known for.' },
        { id: 'pillar_meaning', type: 'long_text', label: 'What you want each pillar to communicate', help: 'Trust, detail, care, craft, legacy.' },
        { id: 'value_topics', type: 'long_text', label: 'Topics or value-led tips for your customers', help: 'The informational content that builds reach without selling.' },
      ],
    },
    {
      id: 'customer', title: 'The ideal customer',
      blocks: [
        { id: 'ideal_customer', type: 'long_text', label: 'Describe the customer you want to clone', help: 'Age, location, lifestyle, values, how they choose.' },
        { id: 'they_value', type: 'long_text', label: 'What do they value most when choosing?' },
        { id: 'they_fear', type: 'long_text', label: 'What do they fear or worry about — what would make them walk away?' },
        { id: 'booking_moment', type: 'long_text', label: 'The moment they decide to book' },
        { id: 'not_ideal', type: 'long_text', label: 'The customer you do NOT want more of' },
      ],
    },
    {
      id: 'competitors', title: 'Competitors and positioning',
      blocks: [
        { id: 'compared_to', type: 'short_text', label: 'Three businesses customers compare you to' },
        { id: 'their_edge', type: 'long_text', label: 'Where those competitors have an edge on you', help: 'Be honest — this is what lets us position you properly.' },
        { id: 'your_edge', type: 'long_text', label: 'Where you clearly beat them' },
        { id: 'surprising_feedback', type: 'long_text', label: 'The thing customers say afterwards that surprises you' },
      ],
    },
    {
      id: 'visual', title: 'Visual direction',
      blocks: [
        { id: 'refs_right', type: 'long_text', label: 'Three accounts whose content feels right', help: 'Paste links.' },
        { id: 'refs_wrong', type: 'long_text', label: 'Three that feel wrong, and why' },
        { id: 'existing_assets', type: 'long_text', label: 'Existing photography, renders or video we can use', help: 'Drive or Dropbox link is fine.' },
        { id: 'mood', type: 'select', label: 'Colour palette and mood for the shoot', options: ['Warm and intimate', 'Bright and airy', 'Cinematic', 'Follows brand palette'] },
        { id: 'visual_limits', type: 'long_text', label: 'Anything off limits visually' },
      ],
    },
    {
      id: 'logistics', title: 'Logistics and shoot day',
      blocks: [
        { id: 'best_days', type: 'short_text', label: 'Best days of the week to shoot' },
        { id: 'blackout_dates', type: 'long_text', label: 'Dates absolutely off limits in the next 90 days' },
        { id: 'locations', type: 'long_text', label: 'Confirmed filming locations' },
        { id: 'site_access', type: 'long_text', label: 'Site access', help: 'Safety requirements, induction, PPE, who escorts us.' },
        { id: 'parking', type: 'short_text', label: 'Parking for crew and gear' },
        { id: 'wardrobe', type: 'long_text', label: 'Wardrobe direction for anyone on camera' },
        { id: 'quirks', type: 'long_text', label: 'Acoustic, lighting or layout quirks we should plan for' },
      ],
    },
    APPROVALS,
    GOALS,
    {
      id: 'anything_else', title: 'Anything else',
      blocks: [
        { id: 'not_asked', type: 'long_text', label: 'What have we not asked that we should have?' },
        { id: 'nervous_about', type: 'long_text', label: 'What are you nervous about with this kind of marketing?' },
        { id: 'never_cross', type: 'long_text', label: 'The boundary we should never cross' },
      ],
    },
  ],
}

const LAUNCH: TemplateDefinition = {
  key: 'launch',
  name: 'Launch intake',
  sections: [
    REBRAND.sections[0], // welcome
    REBRAND.sections[1], // brand snapshot
    REBRAND.sections[2], // people
    {
      id: 'launch_plan', title: 'The launch',
      intro: 'What you are launching, and what has to be true on day one.',
      blocks: [
        { id: 'what_launching', type: 'long_text', label: 'What exactly are you launching?' },
        { id: 'launch_date', type: 'short_text', label: 'Target launch date' },
        { id: 'why_now', type: 'long_text', label: 'Why now — what changed?' },
        { id: 'day_one_success', type: 'long_text', label: 'What does a successful launch day look like?' },
        { id: 'pre_launch_assets', type: 'long_text', label: 'What exists already', help: 'Renders, samples, prototypes, a space we can film.' },
      ],
    },
    REBRAND.sections[4], // voice
    REBRAND.sections[5], // pillars
    REBRAND.sections[6], // customer
    REBRAND.sections[7], // competitors
    REBRAND.sections[8], // visual
    REBRAND.sections[9], // logistics
    APPROVALS,
    GOALS,
  ],
}

const ONE_OFF: TemplateDefinition = {
  key: 'one_off',
  name: 'One-off project intake',
  sections: [
    REBRAND.sections[0], // welcome
    REBRAND.sections[1], // brand snapshot
    {
      id: 'brief', title: 'The brief',
      blocks: [
        { id: 'deliverable', type: 'long_text', label: 'What are we making?' },
        { id: 'where_used', type: 'long_text', label: 'Where will it be used?', help: 'Socials, ads, website, in-venue screens.' },
        { id: 'deadline', type: 'short_text', label: 'Hard deadline, if there is one' },
        { id: 'brief_success', type: 'long_text', label: 'What does a good result look like?' },
      ],
    },
    REBRAND.sections[4], // voice
    REBRAND.sections[8], // visual
    REBRAND.sections[9], // logistics
    APPROVALS,
    GOALS,
  ],
}

export const TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  rebrand: REBRAND,
  launch: LAUNCH,
  one_off: ONE_OFF,
}

/** Never throws — an unrecognised key from a database row must not break the
 *  page, and one_off is the safe superset-free default. */
export function templateFor(key: TemplateKey): TemplateDefinition {
  return TEMPLATES[key] ?? TEMPLATES.one_off
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/intake-core.test.ts`
Expected: PASS — 20 tests total. If the duplicate-id test fails, two sections reused across templates share block ids — that is fine *across* templates but not *within* one; check the section reuse in `LAUNCH` and `ONE_OFF`.

- [ ] **Step 5: Commit**

```bash
git add app/lib/intake-templates.ts tests/intake-core.test.ts
git commit -m "$(cat <<'EOF'
feat(intake): the three engagement-type templates

Derived from the completed Emerald Receptions form. Authored as data in
code rather than a dashboard builder: there is one proven template, and
building the abstraction before the other two exist would build the wrong
one. Block ids are stable — relabel freely, never rename.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The migration

**Files:**
- Create: `supabase/intake.sql`

**Interfaces:**
- Consumes: `clients(id)`, `team_users(id)` from existing migrations.
- Produces: tables `intake_forms`, `intake_files`.

- [ ] **Step 1: Write the migration**

Create `supabase/intake.sql`:

```sql
-- ═══ Client intake form ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One form per client, sent once after the kickoff call. `definition` is a
-- FROZEN copy of the template taken at creation: editing a master template
-- must never change a form under a client who is halfway through it.

create table if not exists intake_forms (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  client_id       uuid        not null references clients(id) on delete cascade,
  template_key    text        not null check (template_key in ('one_off','launch','rebrand')),
  -- frozen at creation; never rewritten from intake-templates.ts
  definition      jsonb       not null,
  token           uuid        not null default gen_random_uuid(),
  status          text        not null default 'draft'
                              check (status in ('draft','sent','in_progress','submitted')),
  -- keyed by block id; a partial autosave merges rather than replaces
  answers         jsonb       not null default '{}'::jsonb,
  send_copy_to_client boolean not null default false,
  sent_at         timestamptz,
  first_opened_at timestamptz,
  submitted_at    timestamptz,
  reopened_at     timestamptz,
  created_by      uuid        references team_users(id) on delete set null
);

-- one form per client, enforced here rather than by the UI hiding a button
create unique index if not exists intake_forms_client_uidx on intake_forms (client_id);
create unique index if not exists intake_forms_token_uidx  on intake_forms (token);

-- A file block accepts several files and needs its own lifecycle, so uploads
-- are rows rather than entries inside answers.
create table if not exists intake_files (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  form_id     uuid        not null references intake_forms(id) on delete cascade,
  block_id    text        not null,
  filename    text        not null,
  url         text        not null,
  size_bytes  bigint      not null default 0
);
create index if not exists intake_files_form_idx on intake_files (form_id, block_id);

alter table intake_forms enable row level security;
alter table intake_files enable row level security;
```

- [ ] **Step 2: Verify it is idempotent**

Run it twice in the Supabase SQL editor. Expected: succeeds both times, no error on the second run.

- [ ] **Step 3: Commit**

```bash
git add supabase/intake.sql
git commit -m "$(cat <<'EOF'
feat(intake): migration for intake_forms and intake_files

definition is a frozen copy of the template taken at creation — editing a
master must never change a form under a client halfway through it. One
form per client is a unique index, enforced in the database rather than
by the UI hiding a button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The server layer

**Files:**
- Create: `app/lib/intake.ts`

**Interfaces:**
- Consumes: `templateFor` (Task 3); `mergeAnswers`, `nextStatus`, `isWritable`, `completion`, `Answers`, `TemplateKey`, `TemplateDefinition`, `IntakeStatus` (Tasks 1–2); `supabase` from `@/lib/supabase`.
- Produces:
  - `type IntakeForm = { id, client_id, template_key, definition, token, status, answers, send_copy_to_client, sent_at, first_opened_at, submitted_at, reopened_at }`
  - `createIntakeForm(clientId: string, key: TemplateKey, createdBy: string): Promise<IntakeForm>`
  - `getIntakeByToken(token: string): Promise<IntakeForm | null>`
  - `getIntakeForClient(clientId: string): Promise<IntakeForm | null>`
  - `saveIntakeAnswers(token: string, patch: unknown): Promise<{ answers: Answers; status: IntakeStatus } | null>`
  - `submitIntake(token: string): Promise<IntakeForm | null>`
  - `reopenIntake(formId: string): Promise<void>`
  - `rotateIntakeToken(formId: string): Promise<string>`
  - `markIntakeSent(formId: string): Promise<void>`
  - `addIntakeFile(formId: string, blockId: string, filename: string, url: string, size: number): Promise<void>`
  - `listIntakeFiles(formId: string): Promise<{ block_id: string; filename: string; url: string }[]>`

- [ ] **Step 1: Write the implementation**

Create `app/lib/intake.ts`:

```ts
import 'server-only'
import { supabase } from '@/lib/supabase'
import { templateFor } from './intake-templates'
import {
  mergeAnswers, nextStatus, isWritable,
  type Answers, type IntakeStatus, type TemplateKey, type TemplateDefinition,
} from './intake-core'

export type IntakeForm = {
  id: string
  client_id: string
  template_key: TemplateKey
  definition: TemplateDefinition
  token: string
  status: IntakeStatus
  answers: Answers
  send_copy_to_client: boolean
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  reopened_at: string | null
}

const COLS =
  'id, client_id, template_key, definition, token, status, answers, ' +
  'send_copy_to_client, sent_at, first_opened_at, submitted_at, reopened_at'

/** Create the one form this client gets. The template definition is COPIED in,
 *  not referenced — editing intake-templates.ts later must not alter a form a
 *  client is halfway through. */
export async function createIntakeForm(
  clientId: string, key: TemplateKey, createdBy: string,
): Promise<IntakeForm> {
  const def = templateFor(key)
  const { data, error } = await supabase
    .from('intake_forms')
    .insert({ client_id: clientId, template_key: def.key, definition: def, created_by: createdBy })
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return data as IntakeForm
}

export async function getIntakeByToken(token: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  // first open is recorded, but does NOT advance status — "started" means typed
  if (!data.first_opened_at) {
    await supabase.from('intake_forms')
      .update({ first_opened_at: new Date().toISOString() }).eq('id', data.id)
  }
  return data as IntakeForm
}

export async function getIntakeForClient(clientId: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS).eq('client_id', clientId).maybeSingle()
  return (data as IntakeForm) ?? null
}

/**
 * Merge one autosave patch.
 *
 * Read-modify-write on a JSONB column is a lost-update risk, but the writer here
 * is a single person typing in one form. The narrower guard that matters is the
 * status one: a submitted form silently accepts nothing.
 */
export async function saveIntakeAnswers(
  token: string, patch: unknown,
): Promise<{ answers: Answers; status: IntakeStatus } | null> {
  const { data } = await supabase
    .from('intake_forms').select('id, status, answers, definition')
    .eq('token', token).maybeSingle()
  if (!data) return null
  if (!isWritable(data.status as IntakeStatus)) {
    return { answers: data.answers as Answers, status: data.status as IntakeStatus }
  }

  const answers = mergeAnswers(data.definition as TemplateDefinition, data.answers as Answers, patch)
  const status = nextStatus(data.status as IntakeStatus, 'save')
  const { error } = await supabase
    .from('intake_forms').update({ answers, status }).eq('id', data.id)
  if (error) throw new Error(error.message)
  return { answers, status }
}

export async function submitIntake(token: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  if (!isWritable(data.status as IntakeStatus)) return data as IntakeForm

  // optimistic concurrency: only the caller who sees a writable status wins
  const { data: updated } = await supabase
    .from('intake_forms')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', data.id).neq('status', 'submitted')
    .select(COLS).maybeSingle()
  return ((updated ?? data) as IntakeForm)
}

export async function reopenIntake(formId: string): Promise<void> {
  const { error } = await supabase.from('intake_forms')
    .update({ status: 'in_progress', reopened_at: new Date().toISOString() })
    .eq('id', formId)
  if (error) throw new Error(error.message)
}

/** A forwarded link is a real scenario — rotating invalidates the old one. */
export async function rotateIntakeToken(formId: string): Promise<string> {
  const { data, error } = await supabase.from('intake_forms')
    .update({ token: crypto.randomUUID() }).eq('id', formId)
    .select('token').single()
  if (error) throw new Error(error.message)
  return data.token as string
}

export async function markIntakeSent(formId: string): Promise<void> {
  await supabase.from('intake_forms')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', formId).eq('status', 'draft')
}

export async function addIntakeFile(
  formId: string, blockId: string, filename: string, url: string, size: number,
): Promise<void> {
  const { error } = await supabase.from('intake_files')
    .insert({ form_id: formId, block_id: blockId, filename, url, size_bytes: size })
  if (error) throw new Error(error.message)
}

export async function listIntakeFiles(formId: string) {
  const { data } = await supabase.from('intake_files')
    .select('block_id, filename, url').eq('form_id', formId)
  return data ?? []
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/intake.ts
git commit -m "$(cat <<'EOF'
feat(intake): server layer

The template definition is copied into the row at creation, not
referenced, so editing a master never alters a form in flight. Opening
the link records first_opened_at but does not advance status — started
means typed. Submit uses optimistic concurrency; a submitted form
silently accepts no further writes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The public API routes

**Files:**
- Create: `app/api/intake/[token]/route.ts`
- Create: `app/api/intake/[token]/submit/route.ts`
- Create: `app/api/intake/[token]/upload/route.ts`
- Verify: `middleware.ts` — `/api/intake` must appear in **neither** `isProtectedRoute` nor `config.matcher`

**Interfaces:**
- Consumes: everything from Task 5; `signUpload` from `app/lib/storage.ts`; `notify` from `app/lib/mailer.ts`.
- Produces: `GET/PATCH /api/intake/[token]`, `POST /api/intake/[token]/submit`, `POST /api/intake/[token]/upload`.

- [ ] **Step 1: Write the read/save route**

Create `app/api/intake/[token]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getIntakeByToken, saveIntakeAnswers, listIntakeFiles } from '../../../lib/intake'
import { completion } from '../../../lib/intake-core'

/**
 * Public intake form, resolved by token alone.
 *
 * The token IS the credential — there is no session here. So this route reads
 * and writes exactly ONE form, the one the token resolves to. It must never
 * accept a client_id or form id from the request.
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    definition: form.definition,
    answers: form.answers,
    status: form.status,
    completion: completion(form.definition, form.answers),
    files: await listIntakeFiles(form.id),
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let patch: unknown
  try { patch = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const saved = await saveIntakeAnswers(token, patch)
  if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(saved)
}
```

- [ ] **Step 2: Write the submit route**

Create `app/api/intake/[token]/submit/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { submitIntake } from '../../../../lib/intake'
import { notify } from '../../../../lib/mailer'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await submitIntake(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', form.client_id).maybeSingle()
  const name = client?.name ?? 'A client'

  // best-effort — the answers are already saved, so a failed email must never
  // fail the client's submission
  try {
    await notify({
      subject: `Intake form submitted — ${name}`,
      title: 'Intake form submitted',
      body: `${name} has submitted their ${form.template_key.replace('_', '-')} intake form.`,
      ctaLabel: 'Open in dashboard',
      ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/clients/${form.client_id}`,
    })
  } catch (e) {
    console.error('intake submit notification failed:', e)
  }

  return NextResponse.json({ status: form.status })
}
```

If `notify`'s parameter names differ from the above, read `app/lib/mailer.ts:87` and match its `NotifyInput` exactly — do not invent fields.

- [ ] **Step 3: Write the upload route**

Create `app/api/intake/[token]/upload/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getIntakeByToken, addIntakeFile } from '../../../../lib/intake'
import { signUpload } from '../../../../lib/storage'
import { isWritable } from '../../../../lib/intake-core'

/** Presigned upload for a file block. The uploader is not logged in, so the
 *  token is the only authorisation — hence the size and type limits here
 *  rather than trusting the browser. */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED = /^(image\/|application\/pdf$|application\/zip$|font\/)/

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isWritable(form.status)) {
    return NextResponse.json({ error: 'This form has been submitted' }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  const filename = String(body?.filename ?? '').slice(0, 200)
  const contentType = String(body?.contentType ?? '')
  const size = Number(body?.size ?? 0)
  const blockId = String(body?.blockId ?? '')

  if (!filename || !blockId) return NextResponse.json({ error: 'filename and blockId are required' }, { status: 400 })
  if (!ALLOWED.test(contentType)) return NextResponse.json({ error: 'That file type is not accepted here' }, { status: 415 })
  if (size > MAX_BYTES) return NextResponse.json({ error: 'Files must be under 50MB' }, { status: 413 })

  const signed = await signUpload(filename, contentType)
  await addIntakeFile(form.id, blockId, filename, signed.publicUrl, size)
  return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: signed.publicUrl })
}
```

- [ ] **Step 4: Verify the route is Clerk-free**

Open `middleware.ts` and confirm `/api/intake` appears in neither `isProtectedRoute` nor `config.matcher`. It must not — the client has no session, and adding it would 404 or redirect every request.

Run: `npm run build`
Expected: build succeeds and the route table lists `/api/intake/[token]`.

- [ ] **Step 5: Commit**

```bash
git add app/api/intake
git commit -m "$(cat <<'EOF'
feat(intake): public token routes — read, save, submit, upload

The token is the credential, so each route resolves exactly one form and
never accepts a client or form id from the request body. Upload limits
type and size server-side because the uploader has no session. A failed
submit notification never fails the submission — the answers are already
saved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The public form page

**Files:**
- Create: `app/intake/[token]/page.tsx`
- Create: `app/intake/[token]/IntakeForm.tsx`
- Create: `app/intake/[token]/blocks.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/intake/[token]`, `POST /api/intake/[token]/submit`, `POST /api/intake/[token]/upload` (Task 6); `getIntakeByToken`, `listIntakeFiles` (Task 5); `completion`, `Block`, `Section`, `TemplateDefinition`, `Answers`, `IntakeStatus` (Tasks 1–2).
- Produces: the page at `/intake/<token>`.

- [ ] **Step 1: Write the page shell**

Create `app/intake/[token]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getIntakeByToken, listIntakeFiles } from '../../lib/intake'
import IntakeForm from './IntakeForm'

export const metadata: Metadata = {
  title: 'Welcome to MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// share links are checked live; a client's answers are never cached
export const dynamic = 'force-dynamic'

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) notFound()

  return (
    <IntakeForm
      token={token}
      definition={form.definition}
      initialAnswers={form.answers}
      initialStatus={form.status}
      files={await listIntakeFiles(form.id)}
    />
  )
}
```

- [ ] **Step 2: Write the block renderers**

Create `app/intake/[token]/blocks.tsx`. One renderer per block type, so `IntakeForm.tsx` stays about state rather than markup.

```tsx
'use client'

import type { Block } from '../../lib/intake-core'

// 16px minimum on inputs — anything smaller makes iOS Safari zoom on focus,
// which on a form this long reads as the page jumping away from you.
const FIELD =
  'w-full rounded-lg border border-[#C9C4BA] bg-white/70 px-4 py-3 text-[16px] ' +
  'text-[#0A0A0A] outline-none transition focus:border-[#0057FF] focus:ring-2 focus:ring-[#0057FF]/20'

export function BlockLabel({ block }: { block: Block }) {
  return (
    <div className="mb-2">
      <label htmlFor={block.id} className="block text-[15px] font-medium text-[#0A0A0A]">
        {block.label}
      </label>
      {block.help && <p className="mt-1 text-[13px] leading-relaxed text-[#5A5A55]">{block.help}</p>}
    </div>
  )
}

export function GuidanceBlock({ block }: { block: Block }) {
  return (
    <p className="border-l-2 border-[#0057FF] pl-4 text-[15px] leading-relaxed text-[#5A5A55]">
      {block.label}
    </p>
  )
}

export function TextBlock({
  block, value, onChange, long,
}: {
  block: Block; value: string; onChange: (v: string) => void; long?: boolean
}) {
  return (
    <div>
      <BlockLabel block={block} />
      {long ? (
        <textarea
          id={block.id} value={value} rows={6} placeholder={block.placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${FIELD} resize-y leading-relaxed`}
        />
      ) : (
        <input
          id={block.id} type="text" value={value} placeholder={block.placeholder}
          onChange={e => onChange(e.target.value)}
          className={FIELD}
        />
      )}
    </div>
  )
}

export function SelectBlock({
  block, value, onChange,
}: { block: Block; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <BlockLabel block={block} />
      <div className="flex flex-wrap gap-2">
        {(block.options ?? []).map(opt => (
          <button
            key={opt} type="button" onClick={() => onChange(value === opt ? '' : opt)}
            className={
              'rounded-full border px-4 py-2 text-[14px] transition ' +
              (value === opt
                ? 'border-[#0057FF] bg-[#0057FF] text-[#F4F0E6]'
                : 'border-[#C9C4BA] bg-white/70 text-[#5A5A55] hover:border-[#0A0A0A]')
            }
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MultiSelectBlock({
  block, value, onChange,
}: { block: Block; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  return (
    <div>
      <BlockLabel block={block} />
      <div className="flex flex-wrap gap-2">
        {(block.options ?? []).map(opt => (
          <button
            key={opt} type="button" onClick={() => toggle(opt)}
            className={
              'rounded-full border px-4 py-2 text-[14px] transition ' +
              (value.includes(opt)
                ? 'border-[#0057FF] bg-[#0057FF] text-[#F4F0E6]'
                : 'border-[#C9C4BA] bg-white/70 text-[#5A5A55] hover:border-[#0A0A0A]')
            }
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

export function FileBlock({
  block, files, onUpload, disabled,
}: {
  block: Block
  files: { filename: string; url: string }[]
  onUpload: (file: File) => Promise<void>
  disabled: boolean
}) {
  return (
    <div>
      <BlockLabel block={block} />
      {files.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1">
          {files.map(f => (
            <li key={f.url} className="font-mono text-[12px] text-[#5A5A55]">✓ {f.filename}</li>
          ))}
        </ul>
      )}
      <input
        type="file" disabled={disabled}
        onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = '' }}
        className="text-[14px] text-[#5A5A55] file:mr-3 file:rounded-full file:border file:border-[#C9C4BA] file:bg-white file:px-4 file:py-2 file:text-[13px]"
      />
    </div>
  )
}
```

- [ ] **Step 3: Write the form with autosave**

Create `app/intake/[token]/IntakeForm.tsx`:

```tsx
'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  completion, type Answers, type IntakeStatus, type TemplateDefinition,
} from '../../lib/intake-core'
import {
  GuidanceBlock, TextBlock, SelectBlock, MultiSelectBlock, FileBlock,
} from './blocks'

type FileRow = { block_id: string; filename: string; url: string }

/**
 * The form the client fills in.
 *
 * "Fill it in over a coffee, not in a rush" is in the instructions, so it is a
 * requirement: every field saves on blur and the same link resumes exactly
 * where they stopped. Nobody loses a 600-word answer to a closed tab.
 */
export default function IntakeForm({
  token, definition, initialAnswers, initialStatus, files: initialFiles,
}: {
  token: string
  definition: TemplateDefinition
  initialAnswers: Answers
  initialStatus: IntakeStatus
  files: FileRow[]
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [status, setStatus] = useState<IntakeStatus>(initialStatus)
  const [files, setFiles] = useState<FileRow[]>(initialFiles)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const locked = status === 'submitted'
  const progress = useMemo(() => completion(definition, answers), [definition, answers])

  const persist = useCallback(async (patch: Answers) => {
    setSaving('saving')
    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setStatus(json.status)
      setSaving('saved')
    } catch {
      setSaving('error')
    }
  }, [token])

  const set = useCallback((id: string, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
    if (timer.current) clearTimeout(timer.current)
    // debounced rather than per-keystroke: these answers run to several hundred
    // words and one request per character is neither kind nor necessary
    timer.current = setTimeout(() => void persist({ [id]: value }), 800)
  }, [persist])

  const upload = useCallback(async (blockId: string, file: File) => {
    const res = await fetch(`/api/intake/${token}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, blockId }),
    })
    if (!res.ok) { setSaving('error'); return }
    const { signedUrl, publicUrl } = await res.json()
    // straight to storage — the file never passes through our server
    await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    setFiles(prev => [...prev, { block_id: blockId, filename: file.name, url: publicUrl }])
  }, [token])

  const submit = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    await persist(answers)
    const res = await fetch(`/api/intake/${token}/submit`, { method: 'POST' })
    if (res.ok) setStatus('submitted')
  }, [answers, persist, token])

  return (
    <div className="intake min-h-screen bg-[#F4F0E6] text-[#0A0A0A]">
      <header className="sticky top-0 z-20 border-b border-[#C9C4BA] bg-[#F4F0E6]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
          <p className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-[#8A8A85]">
            {saving === 'saving' ? 'Saving…'
              : saving === 'saved' ? 'Saved'
              : saving === 'error' ? 'Not saved — check your connection'
              : `${progress.answered} of ${progress.total}`}
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-5 py-12">
        <div>
          <h1 className="text-[34px] font-medium leading-[1.1] tracking-[-0.025em]">
            Welcome to <span className="text-[#0057FF]">MD Media</span>.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[#5A5A55]">
            This form is the foundation we build everything on. Take your time —
            there are no wrong answers, only honest ones. Your work saves as you
            go, so you can close this and come back whenever suits.
          </p>
        </div>

        {locked && (
          <p className="rounded-lg border border-[#0057FF] bg-white/60 px-4 py-3 text-[15px]">
            Thank you — this is with us now. If you need to change something,
            just let your account manager know and we will reopen it.
          </p>
        )}

        {definition.sections.map(section => (
          <section key={section.id} className="flex flex-col gap-6">
            <div className="border-b border-[#C9C4BA] pb-3">
              <h2 className="text-[20px] font-medium tracking-tight">{section.title}</h2>
              {section.intro && (
                <p className="mt-2 text-[14px] italic leading-relaxed text-[#5A5A55]">{section.intro}</p>
              )}
            </div>

            <fieldset disabled={locked} className="flex flex-col gap-6">
              {section.blocks.map(block => {
                const value = answers[block.id]
                if (block.type === 'guidance') return <GuidanceBlock key={block.id} block={block} />
                if (block.type === 'file') {
                  return (
                    <FileBlock
                      key={block.id} block={block} disabled={locked}
                      files={files.filter(f => f.block_id === block.id)}
                      onUpload={f => upload(block.id, f)}
                    />
                  )
                }
                if (block.type === 'select') {
                  return <SelectBlock key={block.id} block={block}
                    value={typeof value === 'string' ? value : ''} onChange={v => set(block.id, v)} />
                }
                if (block.type === 'multi_select' || block.type === 'checkbox') {
                  return <MultiSelectBlock key={block.id} block={block}
                    value={Array.isArray(value) ? value : []} onChange={v => set(block.id, v)} />
                }
                return (
                  <TextBlock
                    key={block.id} block={block} long={block.type === 'long_text'}
                    value={typeof value === 'string' ? value : ''}
                    onChange={v => set(block.id, v)}
                  />
                )
              })}
            </fieldset>
          </section>
        ))}

        {!locked && (
          <div className="border-t border-[#C9C4BA] pt-8">
            <p className="mb-4 text-[15px] text-[#5A5A55]">
              Incomplete is fine — send us what you have and we will work the rest
              out on the call.
            </p>
            <button
              type="button" onClick={() => void submit()}
              className="bg-[#0057FF] px-7 py-4 font-mono text-[12px] font-semibold uppercase tracking-[0.15em] text-[#F4F0E6] transition hover:opacity-90"
            >
              Send to MD Media →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Verify it builds and renders**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npm run build` — expected: succeeds, route table lists `/intake/[token]`.

Then run `npm run dev`, insert a form row by hand against a test client, and open `/intake/<token>`. Confirm: typing then reloading keeps the answer; the header shows "Saved"; the page does not zoom on focus on a phone.

- [ ] **Step 5: Commit**

```bash
git add app/intake
git commit -m "$(cat <<'EOF'
feat(intake): the public form page

"Fill it in over a coffee, not in a rush" is in the instructions, so it
is a requirement: fields autosave debounced and the same link resumes
where they stopped. Inputs are 16px because anything smaller makes iOS
Safari zoom on focus, which on a form this long reads as the page jumping
away from you. Block renderers live in their own file so the form stays
about state rather than markup.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The dashboard side

**Files:**
- Create: `app/api/clients/[id]/intake/route.ts`
- Create: `app/dashboard/clients/[id]/IntakePanel.tsx`
- Modify: the client detail page, to render `<IntakePanel />`

**Interfaces:**
- Consumes: `createIntakeForm`, `getIntakeForClient`, `reopenIntake`, `rotateIntakeToken`, `markIntakeSent`, `listIntakeFiles` (Task 5); `completion`, `TemplateKey` (Tasks 1–2); `requireRole`, `authzErrorResponse` from `app/lib/authz`.
- Produces: `GET/POST/PATCH /api/clients/[id]/intake`; the `IntakePanel` component.

- [ ] **Step 1: Write the route**

Create `app/api/clients/[id]/intake/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import {
  createIntakeForm, getIntakeForClient, reopenIntake,
  rotateIntakeToken, markIntakeSent, listIntakeFiles,
} from '../../../../lib/intake'
import { completion, type TemplateKey } from '../../../../lib/intake-core'

/** Intake form for one client.
 *
 *  Reading is available to any signed-in team member who can see the client.
 *  Creating, rotating and reopening are super_admin only — consistent with
 *  every other client-scoped write, and enforced here rather than by hiding
 *  buttons. */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('editor')
    const { id } = await params
    const form = await getIntakeForClient(id)
    if (!form) return NextResponse.json({ form: null })
    return NextResponse.json({
      form: {
        id: form.id, token: form.token, status: form.status,
        template_key: form.template_key, sent_at: form.sent_at,
        first_opened_at: form.first_opened_at, submitted_at: form.submitted_at,
      },
      answers: form.answers,
      definition: form.definition,
      completion: completion(form.definition, form.answers),
      files: await listIntakeFiles(form.id),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const key = (body?.template_key ?? 'one_off') as TemplateKey
    const form = await createIntakeForm(id, key, admin.id)
    return NextResponse.json({ id: form.id, token: form.token, status: form.status }, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    // the unique index on client_id is the real guard against a second form
    if (/duplicate key/i.test(error)) {
      return NextResponse.json({ error: 'This client already has an intake form' }, { status: 409 })
    }
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const form = await getIntakeForClient(id)
    if (!form) return NextResponse.json({ error: 'No intake form' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    if (body?.action === 'reopen') { await reopenIntake(form.id); return NextResponse.json({ ok: true }) }
    if (body?.action === 'rotate') {
      const token = await rotateIntakeToken(form.id)
      return NextResponse.json({ token })
    }
    if (body?.action === 'mark_sent') { await markIntakeSent(form.id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
```

- [ ] **Step 2: Add `/api/clients` to the middleware matcher**

`requireRole` calls Clerk's `auth()`, which throws unless middleware has run. Open `middleware.ts` and add `'/api/clients/:path*'` to `config.matcher` — **not** to `isProtectedRoute`, since the handler authorises per-request via `app/lib/authz`.

- [ ] **Step 3: Write the dashboard panel**

Create `app/dashboard/clients/[id]/IntakePanel.tsx`. It must show, for a client with no form: a template picker and a "Create intake form" button. For a client with one: the link with a copy button, the status, "sent 6 days ago · never opened" style timestamps, section-by-section completion, the answers rendered read-only, and — for super admins — reopen and rotate.

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Completion, TemplateDefinition, Answers } from '@/app/lib/intake-core'

type Form = {
  id: string; token: string; status: string; template_key: string
  sent_at: string | null; first_opened_at: string | null; submitted_at: string | null
}

const TYPES = [
  { key: 'one_off', label: 'One-off project' },
  { key: 'launch', label: 'Launch' },
  { key: 'rebrand', label: 'Rebrand / rebuild' },
]

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function IntakePanel({ clientId, isAdmin }: { clientId: string; isAdmin: boolean }) {
  const [form, setForm] = useState<Form | null>(null)
  const [definition, setDefinition] = useState<TemplateDefinition | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [progress, setProgress] = useState<Completion | null>(null)
  const [key, setKey] = useState('rebrand')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/clients/${clientId}/intake`)
    if (!res.ok) return
    const json = await res.json()
    setForm(json.form); setDefinition(json.definition ?? null)
    setAnswers(json.answers ?? {}); setProgress(json.completion ?? null)
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId])

  const create = async () => {
    setBusy(true)
    await fetch(`/api/clients/${clientId}/intake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_key: key }),
    })
    await load(); setBusy(false)
  }

  const act = async (action: string) => {
    setBusy(true)
    await fetch(`/api/clients/${clientId}/intake`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    await load(); setBusy(false)
  }

  if (!form) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Intake form</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent once, after the kickoff call. Pick the kind of work this is.
        </p>
        {isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {TYPES.map(t => (
              <button key={t.key} type="button" onClick={() => setKey(t.key)}
                className={
                  'rounded-full border px-3 py-1.5 text-xs transition ' +
                  (key === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border')
                }>
                {t.label}
              </button>
            ))}
            <Button size="sm" onClick={() => void create()} disabled={busy}>Create intake form</Button>
          </div>
        )}
      </div>
    )
  }

  const url = `${window.location.origin}/intake/${form.token}`

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">Intake form</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {form.status.replace('_', ' ')}
        </span>
        {progress && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {progress.answered}/{progress.total} answered
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input readOnly value={url}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs" />
        <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(url)}>
          Copy link
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Sent {relative(form.sent_at)} · opened {relative(form.first_opened_at)}
        {form.submitted_at ? ` · submitted ${relative(form.submitted_at)}` : ''}
      </p>

      {isAdmin && (
        <div className="flex gap-2">
          {form.status === 'submitted' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act('reopen')}>
              Reopen for edits
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('rotate')}>
            Rotate link
          </Button>
        </div>
      )}

      {definition && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          {definition.sections.map(s => (
            <div key={s.id}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</h4>
              <dl className="flex flex-col gap-2">
                {s.blocks.filter(b => b.type !== 'guidance').map(b => {
                  const v = answers[b.id]
                  const text = Array.isArray(v) ? v.join(', ') : (v ?? '')
                  if (!text) return null
                  return (
                    <div key={b.id}>
                      <dt className="text-xs text-muted-foreground">{b.label}</dt>
                      <dd className="whitespace-pre-wrap text-sm">{text}</dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Render it on the client detail page**

Find the client detail page under `app/dashboard/clients/` (or wherever the client record is edited — check `app/dashboard/` for the existing clients UI) and render `<IntakePanel clientId={client.id} isAdmin={role === 'super_admin'} />` alongside the existing contacts, credentials and notes panels. Follow whatever prop the surrounding page already uses to know the caller's role; do not introduce a second source of truth for it.

- [ ] **Step 5: Verify**

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no errors.
Run: `npm run build` — expected: succeeds.

Then in `npm run dev`: create a form for a test client, copy the link, open it in a private window, fill two fields, reload to confirm they persisted, submit, confirm the dashboard shows `submitted` and the answers, then reopen and confirm the public form accepts writes again.

- [ ] **Step 6: Commit**

```bash
git add app/api/clients app/dashboard middleware.ts
git commit -m "$(cat <<'EOF'
feat(intake): dashboard side — create, share, track, read

Creating, rotating and reopening are super_admin only, enforced in the
route rather than by hiding buttons; reading is editor+. The unique index
on client_id is what actually prevents a second form — the 409 here just
explains it. "Sent 6 days ago, never opened" is the signal that a client
has gone quiet, which is invisible today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Templates per engagement type, authored in code, JSONB shape | 3 |
| Guidance blocks as first-class content | 1 (type), 3 (data), 7 (renderer) |
| `intake_forms` with frozen definition, token, status, answers | 4, 5 |
| One form per client, enforced in the database | 4 (unique index), 8 (409) |
| `intake_files` separate table | 4, 5, 6 |
| Autosave and resume | 1 (merge), 7 (debounced persist) |
| Progress, never blocking | 2, 7 |
| Submission locks; reopen is an MD Media action | 2, 5, 6, 8 |
| Token-gated uploads with type and size limits | 6 |
| `noindex`, `force-dynamic`, Clerk-free route | 6 (step 4), 7 |
| Token revocable and rotatable | 5, 8 |
| Marketing-site styling, dashboard-grade controls, no iOS zoom | 7 |
| Super admin creates and sends | 8 |
| Client copy optional, defaulted off | 4 (`send_copy_to_client` column) |
| Notification to the team on submit | 6 |
| Dashboard: status, timestamps, answers, copy link | 8 |
| Tests: merge, completion, status, template integrity | 1, 2, 3 |

**Gap accepted deliberately:** the `send_copy_to_client` column exists and defaults to `false`, but no UI toggles it and no email is sent to the client. The spec calls it an option; wiring it is a small follow-up once the core flow is proven, and building it now would mean shipping an untested email path to clients.

**Placeholder scan:** none. Every code step contains the code.

**Type consistency:** `mergeAnswers(def, current, patch)` in Task 1 is called with the same argument order in Task 5. `completion(def, answers)` returns `{ answered, total, sections }` in Task 2 and is consumed with those names in Tasks 6, 7 and 8. `IntakeForm` the type (Task 5) and `IntakeForm` the component (Task 7) share a name but never a module — the component is a default export from `app/intake/[token]/IntakeForm.tsx`, the type a named export from `app/lib/intake.ts`.
