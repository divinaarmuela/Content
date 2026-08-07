# Inbox scanner: scanning more than one mailbox

**Date:** 2026-08-07
**Status:** ON HOLD — design settled, blocked on one Workspace admin action.
Nothing to implement until that is resolved. Do not start the workarounds.

## Problem

The super-admin mailbox picker is built and works. It has nothing to choose from.

Everything on the app side already exists:

- `scan_mailboxes` table — per-address `enabled` flag, `source` of `shared` or
  `connected` (`supabase/scan_settings.sql`)
- `listMailboxEntries()` — discovers available addresses, registers new ones
  enabled-by-default, never silently re-enables one an admin turned off
  (`app/lib/scan-settings.ts:49`)
- `PUT /api/ingest/settings` — `requireRole('super_admin')`, enforced in the route
  rather than by hiding controls (`app/api/ingest/settings/route.ts:56`)
- `ScannerSettings.tsx` — the UI
- `scanMailbox` — Inngest fans out one invocation per mailbox,
  `concurrency: { limit: 3, key: 'event.data.email' }`, so each address has its own
  timeout and retries (`app/inngest/functions.ts:91`)
- `getConnectionStatus()` / `GET /api/ingest/connection` — per-user connection
  state, with a reason when absent (`app/lib/clerk-gmail.ts:50`)

The gap is configuration, not code. `getMailboxes()` supports three modes
(`app/lib/gmail.ts:43`) and production runs the weakest: the legacy `GMAIL_USER`
+ `GMAIL_REFRESH_TOKEN` pair, which yields exactly one mailbox. The multi-mailbox
path has therefore never run against more than one address.

## The decision

**Use domain-wide delegation. Do not build around its absence.**

This reverses the earlier draft of this spec, which planned per-mailbox refresh
tokens as "phase 1" because delegation was blocked. That was solving the wrong
problem. Every alternative below exists only to route around one missing thing: a
Workspace admin clicking through one screen.

| | Delegation | Every alternative |
|---|---|---|
| Add `sales@` | Type the address | Mint a token, store it, deploy |
| Add all 13 people | Type the addresses | 13 people each consent, coverage decays |
| Credentials stored | One service account key | One per mailbox, forever |
| Code to write | Effectively none | Migration + OAuth route + UI + tests |
| Blocked on | One admin click | Nothing |

The requirement that settled it: *adding a new shared mailbox must not require a
script run, an env edit, or a deploy.* Today's env list (`hello@`, `contact@`,
`info@`) is an accident of what was configured, not a design. `sales@` tomorrow and
`accounts@` next month must be as cheap as typing an address.

Only delegation makes that true, because under delegation **there is no per-mailbox
credential at all**. The app asks Google for read access to an address and Google
grants it. `app/lib/gmail.ts:45` already switches to this mode the moment the two
service-account env vars exist; `delegatedToken()` at line 87 does the impersonation.
The code is written and unused.

## What is blocked

Domain-wide delegation is authorised in admin.google.com → Security → Access and
data control → API controls → Domain-wide delegation, and **only** there. That
requires Workspace super-admin, which the developer does not have.

The ask is small and should be made rather than engineered around:

- Client ID of a service account (any team member can create this — see below)
- One scope: `https://www.googleapis.com/auth/gmail.readonly` — read-only; it cannot
  send, delete or modify
- Revocable from the same screen at any time

### Prepared work that needs no admin rights

All of this produces the Client ID that goes in the request, and can be done now:

1. New Google Cloud project, **signed in as `@mdmmarketing.com.au`** so it lands
   inside the Workspace organisation. Verify the Location field shows the domain and
   not "No organisation" — a project under a personal account can never publish an
   Internal consent screen, which matters for the Clerk work below.
2. Enable the **Gmail API**.
3. IAM & Admin → Service Accounts → create `inbox-scanner` → create a **JSON key**.
   Yields `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
4. Copy the service account's **Client ID** (the long number, not the email address).

The existing OAuth client (project `251277523150`) is unreachable — the developer
has no IAM on that project, so a fresh project is required regardless.

## Design, once unblocked

**Mailbox list moves from env to the database.** `GMAIL_SCAN_MAILBOXES` becomes the
bootstrap, not the source of truth. A super admin adds a mailbox by typing an
address into `scan_mailboxes`; `getMailboxes()` returns those rows as
`{ email, delegated: true }`. No token, no OAuth flow in the UI, no deploy.

This is roughly an hour of work: one migration, one `getMailboxes()` source, an
"Add mailbox" input in `ScannerSettings.tsx`, and a `super_admin`-gated route.

**Scan scope: every mailbox on the domain**, subject to two conditions agreed in
discussion:

1. **The team is told before individual inboxes are scanned.** Every email a staff
   member receives is fetched, reduced to plain text, and sent to Anthropic for
   classification. The prefilter (`app/lib/gmail-core.ts:71`) targets newsletters and
   no-reply senders; private correspondence survives it. This is ordinary company
   email on a company domain — the risk is not legality, it is people finding out
   afterwards.
2. **`min_confidence` is raised for individual inboxes.** A shared inbox exists to
   receive enquiries, so a low bar is right. A personal inbox does not, so the same
   bar produces false leads — and `leads` is the table the dashboard counts and
   reports on.

Cost is not a factor: per-message claiming in `email_ingest_log` means the 5-minute
cron does not multiply Anthropic spend. Only genuinely new mail is classified.

## Fallbacks, in preference order — build none of these unless the admin request fails

**A. Dashboard-managed shared mailboxes with stored tokens.** Add a nullable
encrypted `refresh_token` column to `scan_mailboxes`; a `super_admin`-only OAuth
flow in the browser stores an encrypted token per mailbox, reusing `CREDENTIALS_KEY`
and the AES-256-GCM helper the client-credentials feature already uses. Tokens are
never returned by any read endpoint — same rule as client passwords. Gets the same
"add a mailbox from the dashboard" UX as delegation, at the cost of a credential per
mailbox and roughly a day of work.

**B. The Clerk path.** Each person connects their own Google account; their inbox
appears as `source: connected`. Needs an Internal OAuth consent screen and Clerk
custom credentials — the same OAuth client Clerk production requires anyway, so this
overlaps with the Clerk migration rather than adding to it. Two weaknesses:
coverage is voluntary and decays silently when someone revokes, and a Workspace admin
can block restricted scopes for unconfigured third-party apps, which would reintroduce
an admin action anyway. Also needs a "Connect my inbox" panel that does not exist —
`GET /api/ingest/connection` serves the status but nothing renders it.

**C. Per-mailbox refresh tokens via `scripts/gmail-add-mailbox.cjs`.** One run per
mailbox, ever. Only genuinely required for `hello@`, whose *send* token
(`GMAIL_REFRESH_TOKEN`) the contact form uses in `app/api/submit/route.ts` — env is
the right home for a sending credential. The script gained a `--send` flag for
exactly this (commit `55ac32a`): a refresh token is bound to the client that issued
it, so moving to a new OAuth client replaces the send token, and read scope alone
would leave the form saving leads while silently emailing nobody.

**D. Forwarding filters.** Each person forwards enquiry mail to one scanned inbox.
No Google Cloud, no admin, no consent. Last resort if every permission request fails.

## Gap found while reading

A mailbox that is connected and then revoked **silently vanishes** from
`listMailboxEntries()`. `listConnectedMailboxes()` only returns users whose token
still resolves (`app/lib/clerk-gmail.ts:82`), so a revoked mailbox is simply absent —
indistinguishable from one that was never connected.

That is the difference between "this person's mail is being scanned" and "this
person's mail silently stopped being scanned three weeks ago". Coverage decays
invisibly.

**Fix:** `scan_mailboxes` already persists every address ever seen. Render entries
present in the table but missing from live availability as **"not connected"** rather
than omitting them. Worth doing regardless of which mode wins.

## Testing, when built

`scan-core.ts` and `gmail-core.ts` are covered. Mailbox *resolution* is not:

- `getMailboxes()` — delegation wins over refresh tokens when the service account is
  configured; `GMAIL_MAILBOXES` parses; malformed JSON falls back to the legacy pair
  rather than throwing; the legacy pair is not duplicated when already in the array
- `listMailboxEntries()` — a previously-seen address absent from live availability
  renders as not-connected; an address an admin disabled is never re-enabled by
  rediscovery
- `enabledMailboxEmails()` — only enabled addresses are returned

All pure given fixtures, so they belong in the existing vitest suite.

## Next action

Ask whoever holds Workspace super-admin for the delegation authorisation. Everything
else waits on that answer. If it is refused, revisit fallback A.
