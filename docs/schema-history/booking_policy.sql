-- ═══ Bookings, part 4: the cancellation policy ═══
-- Idempotent. Run in the Supabase SQL editor AFTER supabase/booking_seats.sql.
--
-- The policy has money attached (full refund / 20% fee / non-refundable), so
-- "they agreed to it" has to be a fact on the record, not an assumption about
-- what the page said on the day.

alter table bookings add column if not exists policy_agreed_at timestamptz;
comment on column bookings.policy_agreed_at is
  'When the customer ticked the cancellation policy. NULL = pre-policy booking.';

-- per-service override; NULL means the house policy applies
alter table booking_services add column if not exists policy_text text;
