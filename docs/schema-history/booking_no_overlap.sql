-- ═══ Bookings, part 5: no overlapping sessions ═══
-- Idempotent. Run in the Supabase SQL editor AFTER supabase/booking_seats.sql.
--
-- The unique index guards (resource, start_at, seat) — which only catches
-- bookings that start at the SAME MOMENT. A 2-hour session booked at 10:00
-- and a 1-hour session booked at 11:00 have different start times, so the
-- index was happy to accept both and the studio was double-booked.
--
-- This is the real guarantee: no two live bookings for the same seat in the
-- same room may overlap in TIME. Postgres enforces it, so no amount of
-- concurrency, stale pages or future code can get around it.

create extension if not exists btree_gist;

alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    resource_id with =,
    seat_no     with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status <> 'cancelled');
-- '[)' is half-open on purpose: a session ending at 11:00 and one starting
-- at 11:00 are back-to-back, not a clash.
