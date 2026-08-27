-- ═══ Posting time zone, per client ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- A posting time is a fact about the AUDIENCE, not about whoever booked it.
-- Melbourne used to be hard-coded on the assumption that the client, the
-- audience and the scheduler were all in the same place; the moment a
-- scheduler started work from the Philippines that stopped being true. She
-- typed 9:00 into the box, her browser read it as 9:00 Manila, and the post
-- was queued for 11:00 Melbourne.
--
-- So the zone belongs to the client row, and every screen that shows or takes
-- a posting time reads it from here. The default keeps every existing client
-- exactly where they already were.
--
-- An IANA identifier ('Australia/Melbourne', 'Asia/Manila') — never an
-- abbreviation. 'AEST' is not a time zone: it is one of the two things
-- Melbourne is called depending on the month, and storing it would throw away
-- the daylight-saving rules that make October and April come out right.

alter table clients
  add column if not exists timezone text not null default 'Australia/Melbourne';

-- A blank or NULL zone would silently become UTC in the browser, which is
-- nobody's posting time. Length is capped at what IANA actually issues.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_timezone_not_blank'
  ) then
    alter table clients
      add constraint clients_timezone_not_blank
      check (length(btrim(timezone)) between 1 and 64);
  end if;
end $$;

comment on column clients.timezone is
  'IANA zone the audience is in. Every posting time is entered, displayed and queued in this zone.';
