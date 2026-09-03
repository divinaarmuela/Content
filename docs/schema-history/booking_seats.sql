-- ═══ Bookings, part 3: seats ═══
-- Idempotent. Run in the Supabase SQL editor AFTER supabase/booking_public.sql.
--
-- Until now a booking was 1:1 — one room, one time, one customer, guaranteed
-- by a unique index on (resource_id, start_at). That is right for studio
-- hire and wrong for an EVENT: The Room seats a group, so twenty people must
-- be able to book the same hour.
--
-- Seats are claimed the same way version numbers are: each booking takes a
-- numbered seat, and the unique index decides who got it. No counting rows
-- and then inserting — that is the check-then-write race this codebase
-- deliberately avoids.

-- how many people can hold the same slot. 1 = a private booking (studio
-- hire), >1 = an event with seats.
alter table booking_services add column if not exists capacity int not null default 1
  check (capacity between 1 and 500);

-- which seat this booking holds. Always 1 for a private booking.
alter table bookings add column if not exists seat_no int not null default 1
  check (seat_no >= 1);

-- the guard moves from "one booking per slot" to "one booking per SEAT per
-- slot" — still a unique-constraint claim, still race-proof
drop index if exists bookings_no_double_uidx;
create unique index if not exists bookings_seat_uidx
  on bookings (resource_id, start_at, seat_no) where status <> 'cancelled';
