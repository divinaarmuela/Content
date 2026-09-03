-- Final-post approval: the caption, media and timing get their own sign-off
-- BEFORE anything is queued to a live account. The asset approval earlier in
-- the funnel approved the WORK; nobody ever approved the post.
--
-- posting_approval_state:
--   null       — the gate has never been used on this item; queueing behaves
--                exactly as before this migration (tolerant by design)
--   'draft'    — reserved: being prepared, not yet sent
--   'pending'  — sent to the approver; queueing is blocked
--   'approved' — signed off; queueing is open
--   'changes'  — the approver asked for changes (note in posting_approval_note)
--
-- Editing the caption or saving a new version after 'approved' flips the state
-- back to 'pending' in the application — an approved caption that then changed
-- must never post silently.
alter table content_items
  add column if not exists posting_approval_state text
    check (posting_approval_state in ('draft', 'pending', 'approved', 'changes')),
  add column if not exists posting_approved_by uuid,
  add column if not exists posting_approved_at timestamptz,
  add column if not exists posting_approval_note text,
  -- "Client approves the final post too" — like client_approval_required but
  -- for the POST (caption + timing), default off. When true and the state is
  -- 'pending', the post appears on the client's portal for their sign-off.
  add column if not exists posting_client_required boolean not null default false;

-- RLS posture is unchanged: content_items is already deny-by-default and only
-- the server's service role reads or writes it. No new policies are needed.
