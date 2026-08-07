# Client intake form: shareable, no-login, saved properly

**Date:** 2026-08-07
**Status:** design approved in chat; ready for an implementation plan

## Problem

After the kickoff call, a new client is sent a long-form intake questionnaire — the
foundation for the brand, the shoot, the content and the ongoing strategy. Today
that is a Word document emailed back and forth. The completed Emerald Receptions
form is the reference artefact for this design.

What the document format costs:

- Answers live in a `.docx` in someone's inbox, not against the client record
- No way to see who has been sent a form, who has started, who has gone quiet
- Attachments (logos, brand files, photography links) scatter across email threads
- Nothing downstream can read the answers — not the shot list, not the brief, not
  the content pillars that should drive production

The form itself is not the deliverable. **Structured, queryable answers attached to
the client are.**

## What the reference form tells us

Read as a requirements document rather than a questionnaire, the Emerald form
establishes:

- **Answers are long.** Several run 300–600 words of considered prose. This is not a
  survey; it is a written interview.
- **Completion is multi-session.** The instructions say so outright: *"Fill it in
  over a coffee, not in a rush"* and *"Incomplete is fine, send what you have."*
  Partial save and resume are requirements, not conveniences.
- **Mixed input types** — short text, long prose, links, single-select with an
  "other, describe" escape, checkbox lists, and file attachments (logo files, brand
  colours and fonts).
- **Guidance is part of the form.** The italic explainer above each section does real
  work — it tells the client *why* a question is being asked, which is what produces
  the 600-word answer instead of a shrug. Guidance blocks must be first-class
  content, not placeholder text.
- **Sections carry meaning**: brand snapshot, people, story, voice, pillars, ideal
  client, competitors, visual direction, scope, logistics, approvals, goals.
- **Approval routing is captured inside the form** — single approval contact, agreed
  feedback turnaround, who else must see content. That data belongs in the
  production workflow, not buried in prose.

## Decisions

**Fixed templates now, form builder later.** Three templates matching the engagement
types (one-off, launch, rebrand), authored in code. A super admin picks a client and
a type, creates the form, copies the link, sends it. Changing a *question* requires a
developer.

Rejected for now: a dashboard form builder where questions are created and reordered
in the UI. It is four to five days of fiddly work, and there is exactly one proven
template today — building the abstraction before the second and third templates exist
would build the wrong one. Because the template is JSONB from the first commit,
adding a builder later is an addition rather than a rewrite: the data model does not
change, only who may edit it.

**Templates are per engagement type.** A rebrand form asks about heritage and
continuity; a one-off does not. This depends on the still-open question of whether a
client has one type or many — see *Open questions*.

**The form is styled like the marketing site, not the dashboard.** It is the first
thing a new client sees after signing. The cream palette and Lama typography carry
the tone the copy is written in; a grey admin form contradicts *"no wrong answers,
only honest ones."* Controls themselves are dashboard-grade: visible focus states,
quiet autosave feedback, inputs that do not trigger iOS zoom.

*Trap:* `app/globals.css` styles the marketing site through bare element selectors
(CLAUDE.md trap 2). The form gets its own scoped wrapper so the two do not fight.

## Data model

**`intake_templates`** — the questionnaire definition.
`id, key ('one_off' | 'launch' | 'rebrand'), name, version, definition jsonb,
active, created_at`.

`definition` is `sections[] → blocks[]`, each block one of:
`guidance | short_text | long_text | link | select | multi_select | checkbox | file`.
Every block carries a stable `id` — answers key off it, so renaming a question label
never orphans an answer.

**`intake_forms`** — one per client per engagement.
`id, client_id, template_key, definition jsonb (FROZEN COPY), token uuid unique,
status, sent_at, first_opened_at, submitted_at, reopened_at, created_by, answers jsonb`.

The frozen `definition` is deliberate: editing a master template while a client is
halfway through must not change the form under them, remove a question they have
already answered, or renumber their sections.

`answers` is a single JSONB object keyed by block id. Not a column per question —
that is what makes answers exportable, diffable, and survivable across template
revisions.

**`intake_files`** — `id, form_id, block_id, filename, url, size, uploaded_at`.
Separate from `answers` because a file block accepts several files and needs its own
lifecycle.

**Status** — `draft → sent → in_progress → submitted`, plus `reopened`.
`in_progress` is set by the first autosave, not by opening the link, so "started" means
they actually typed something.

## The public form

Route `/intake/[token]`, following the existing no-login pattern exactly:
`clients.share_token` → `/portal/<token>` (`supabase/portal_share.sql`), with
`robots: 'noindex, nofollow'` and `export const dynamic = 'force-dynamic'`.

**Autosave.** Every field saves on blur, debounced, with a quiet "Saved" indicator.
A closed tab must never cost a 600-word answer about a family history. Resume is
implicit — the same link reopens exactly where they stopped.

**Progress.** Section-by-section completion, so a client filling it over three
sittings can see what is left. Never a blocking progress bar — incomplete submission
is explicitly allowed.

**Submission** is a deliberate act, not the last autosave. On submit the form locks
and the account manager is emailed. Reopening is an action on the MD Media side
(`reopened_at`), so answers cannot change silently after a shot list has been built
on them.

**File uploads** reuse `signUpload()` (`app/lib/storage.ts`) — presigned PUT straight
to R2, never through the server. The signing route must be **token-gated**: the
uploader is not logged in, so the token is the only authorisation. Rate-limit it, and
constrain content types and size.

## Security

**The token is the credential.** Anyone holding the link can read and write the
form. Consequences, accepted deliberately:

- Tokens are `gen_random_uuid()`, unguessable, and **revocable and rotatable** from
  the client page. A forwarded link is a real scenario.
- `noindex, nofollow` — the portal page already does this and this page must too.
- No client credentials, passwords or payment details are ever collected in an intake
  form. It gathers brand and strategy input, nothing that would be damaging if the
  link leaked.
- Submitted forms lock, so a leaked link cannot rewrite history.
- The public route reads and writes exactly one form, resolved by token. It must
  never accept a `client_id` from the request body.

## Dashboard side

On the client page: create a form (choose type), copy the link, see status and
timestamps, view answers rendered read-only, reopen, revoke/rotate the token,
and export.

The list view needs an at-a-glance column — *sent 6 days ago, never opened* is the
signal that a client is going quiet, and it is invisible today.

## What the answers should feed

The value is downstream, and the schema should anticipate it even if the wiring comes
later:

- **Approval routing** — single approval contact and agreed turnaround map directly
  onto the production workflow's `client_review` step
- **Content pillars** — the client's own pillars should appear when planning items
- **Off-limits list** — Emerald's *"do not focus on the fire"* is exactly the kind of
  instruction that must be visible at production time, not buried in a document

Out of scope for this build, but the reason answers are structured rather than a blob
of prose.

## Testing

- Template definition parsing — every block type round-trips; an unknown block type
  degrades gracefully rather than throwing
- Answer merge — a partial autosave never clobbers unrelated answers
- Frozen definition — editing a template does not alter an in-flight form
- Token resolution — unknown token 404s; a submitted form rejects writes; a revoked
  token 404s
- Status transitions — `in_progress` set by first save, not by opening

Pure given fixtures, so they belong in the existing vitest suite.

## Open questions

1. **One engagement type per client, or many?** Unresolved. If a client can hold a
   rebrand and an ongoing retainer at once, `intake_forms.client_id` should point at
   an engagement instead. Cheap now, expensive later.
2. **Who may create and send a form** — super admin only, matching every other
   client-scoped write, or account managers for their own clients? Account managers
   remain scoped to assigned clients (confirmed in discussion), so this decides
   whether onboarding bottlenecks on one person.
3. Should a client receive a copy of their own submitted answers?
