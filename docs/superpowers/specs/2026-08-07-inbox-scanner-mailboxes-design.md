# Inbox scanner: scanning more than one mailbox

**Date:** 2026-08-07
**Status:** design, approved in chat

## Problem

The super-admin mailbox picker is built and works. It has nothing to choose from.

Everything on the app side already exists:

- `scan_mailboxes` table — per-address `enabled` flag, `source` of `shared` or `connected`
  (`supabase/scan_settings.sql`)
- `listMailboxEntries()` — discovers available addresses, registers new ones
  enabled-by-default, never silently re-enables one an admin turned off
  (`app/lib/scan-settings.ts:49`)
- `PUT /api/ingest/settings` — `requireRole('super_admin')`, enforced in the route
  rather than by hiding controls (`app/api/ingest/settings/route.ts:56`)
- `ScannerSettings.tsx` — the UI
- `scanMailbox` — Inngest fans out one invocation per mailbox,
  `concurrency: { limit: 3, key: 'event.data.email' }`, so each address has its own
  timeout and retries (`app/inngest/functions.ts:91`)

The gap is configuration. `getMailboxes()` supports three modes
(`app/lib/gmail.ts:43`) and production is on the weakest one: the legacy
`GMAIL_USER` + `GMAIL_REFRESH_TOKEN` pair, which yields exactly one mailbox.
The multi-mailbox path has therefore never run against more than one address.

## Constraint that shaped the design

Domain-wide delegation is the strongest option — one service account impersonates
any mailbox on the domain, and adding an inbox becomes one entry in a list. It is
**not available to us**: authorising it requires Workspace super-admin on
admin.google.com, which the developer does not have.

Everything below is designed around that.

## Decisions

**Scan scope: all mailboxes (option C), phased.** Not because the alternatives were
unworkable but because the cost objections turned out to be false — the Inngest
fan-out already handles 13 addresses, and per-message claiming in
`email_ingest_log` means the 5-minute cron does not multiply Anthropic spend. Only
genuinely new mail is classified.

Two conditions attach to that decision:

1. **The team is told before individual inboxes are scanned.** Under option C every
   email a staff member receives is fetched, reduced to plain text, and sent to
   Anthropic for classification. The prefilter (`app/lib/gmail-core.ts:71`) targets
   newsletters and no-reply senders; private correspondence survives it. This is
   ordinary company email on a company domain — the risk is not legality, it is
   people finding out afterwards.
2. **`min_confidence` is raised for individual inboxes.** A shared inbox exists to
   receive enquiries, so a low bar is right. A personal inbox does not, so the same
   bar produces false leads — and `leads` is the table the dashboard counts and
   reports on.

**Phase 1 before phase 2.** Phase 1 needs no permission from anyone and proves the
multi-mailbox path end to end — fan-out, per-mailbox run history, the enable/disable
toggle, the health column — before phase 2 spends anyone's goodwill.

**Phase 2 is the Clerk path, not delegation.** Each person authorises their own
mailbox. This avoids the Workspace admin entirely, and the Google Cloud OAuth client
it requires is *the same client Clerk production needs anyway* — Clerk dev instances
borrow Clerk's shared Google credentials, production requires your own. The Google
Cloud work and the Clerk production migration are one piece of work, not two.

## Phase 1 — shared mailboxes (no permissions required)

`contact@mdmmarketing.com.au` and `info@mdmmarketing.com.au` are confirmed separate
mailboxes, not aliases of hello@. Each can mint its own refresh token.

`scripts/gmail-add-mailbox.cjs` already implements this: loopback OAuth on
`http://localhost:5599/callback`, `prompt=consent` to force a refresh token,
appends to the existing list rather than replacing it, prints the env line.

**Prerequisite:** the OAuth client `251277523150-…` must have
`http://localhost:5599/callback` registered as a redirect URI. This needs access to
the Google Cloud project that owns that client — the only unknown in phase 1. If
that project is inaccessible, phase 1 creates its own OAuth client instead, which
also removes the dependency on whoever set up the original.

**Result:**

```
GMAIL_MAILBOXES=[{"email":"hello@…","refreshToken":"…"},{"email":"contact@…","refreshToken":"…"},{"email":"info@…","refreshToken":"…"}]
```

`getMailboxes()` reads this at `app/lib/gmail.ts:57`. `GMAIL_USER` and
`GMAIL_REFRESH_TOKEN` stay — the sending path in `app/api/submit/route.ts` uses
them, and `getMailboxes()` folds the legacy pair in without duplicating.

No code changes. The picker goes from one row to three.

## Phase 2 — connected mailboxes + Clerk production

One Google Cloud project, created signed in as `@mdmmarketing.com.au` so it lands
inside the Workspace organisation. That is what makes the consent screen **Internal**,
and Internal is what makes `gmail.readonly` skip Google's restricted-scope review —
otherwise a multi-week verification with a privacy policy and a demo video.

1. Google Cloud project, Gmail API enabled
2. OAuth consent screen → **Internal**
3. OAuth client (Web application), redirect URI = Clerk's callback
4. Clerk: Google connection switched to custom credentials, with
   `https://www.googleapis.com/auth/gmail.readonly` added as an extra scope
5. Clerk production instance; replace `pk_test` / `sk_test`
6. Each team member signs in with Google and approves

`app/lib/clerk-gmail.ts:32` already pulls a fresh per-user token on demand,
including when the user is offline, so scheduled scans keep working.
`listConnectedMailboxes()` filters to the company domain, so a personal Gmail
signed into the dashboard is never scanned (`app/lib/clerk-gmail.ts:79`).

**Known risk:** `gmail.readonly` is a restricted scope. A Workspace admin can block
unconfigured third-party apps from restricted scopes even for an Internal app. If
that setting is on, users hit "Access blocked" at consent and one admin action is
needed after all — smaller than delegation, but not zero. This surfaces the first
time someone tries; there is no way to check it in advance without admin access.

## Gap found while reading

A mailbox that is connected and then revoked **silently vanishes** from
`listMailboxEntries()`. `listConnectedMailboxes()` only returns users whose token
still resolves (`app/lib/clerk-gmail.ts:82`), so a revoked mailbox is simply absent
from the picker — indistinguishable from one that was never connected.

Under phase 2 that is the difference between "this person's mail is being scanned"
and "this person's mail silently stopped being scanned three weeks ago, and nobody
noticed". Coverage decays invisibly.

**Fix:** `scan_mailboxes` already persists every address ever seen. Render entries
that exist in the table but are missing from the live availability list as
**"not connected"** rather than omitting them. The row stays, the health column
tells the truth, and a super admin can see at a glance who has dropped out.

## Testing

`scan-core.ts` and `gmail-core.ts` are the pure, testable units and are already
covered. What is not covered is mailbox *resolution*:

- `getMailboxes()` — mode A wins over mode B when the service account is configured;
  `GMAIL_MAILBOXES` parses; malformed JSON falls back to the legacy pair rather than
  throwing; the legacy pair is not duplicated when already present in the array
- `listMailboxEntries()` — a previously-seen address absent from live availability
  renders as not-connected; an address an admin disabled is never re-enabled by
  rediscovery
- `enabledMailboxEmails()` — only enabled addresses are returned

These are pure given fixtures for env and the Clerk/env sources, so they belong in
the existing vitest suite rather than requiring live credentials.

## Out of scope

- Domain-wide delegation. Revisit if Workspace super-admin becomes available; the
  code path already exists (`app/lib/gmail.ts:45`) and switching is a straight env
  swap with no code change.
- Forwarding filters as a fallback. Held in reserve for the case where both the
  admin request and per-user consent are refused.
