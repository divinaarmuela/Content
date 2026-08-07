-- ═══ Connect my inbox ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- A team member grants Gmail read access to their own mailbox, once, and the
-- refresh token is stored here encrypted. This replaces per-user tokens held
-- by Clerk: sign-in moved to an External Google app (so personal addresses can
-- sign in), and an External app cannot carry the restricted gmail.readonly
-- scope without Google's verification. Scanning therefore uses its own
-- Internal app, which only @mdmmarketing.com.au accounts can consent to —
-- Google enforces the domain rule rather than our code hoping.

-- AES-256-GCM, same envelope as client credentials (app/lib/secret-box.ts).
-- Never returned by any read endpoint.
alter table scan_mailboxes add column if not exists refresh_token_encrypted text;
alter table scan_mailboxes add column if not exists connected_at timestamptz;
alter table scan_mailboxes add column if not exists connected_by text;

-- 'self' = connected by its owner through the dashboard, as opposed to
-- 'shared' (an env refresh token) or 'connected' (a Clerk Google account).
alter table scan_mailboxes drop constraint if exists scan_mailboxes_source_check;
alter table scan_mailboxes add constraint scan_mailboxes_source_check
  check (source in ('shared','connected','self'));

-- Whether the "Connect my inbox" control is offered at all. Off means nobody
-- can add a new mailbox this way; mailboxes already connected keep working,
-- because revoking access is a separate, deliberate act.
alter table scan_settings add column if not exists allow_self_connect boolean not null default true; 
