-- ═══ Bookings, part 2: the public booking link ═══
-- Idempotent. Run in the Supabase SQL editor AFTER supabase/booking.sql.
--
-- Adds what the public page needs and part 1 lacked:
--   • which resource actually delivers a service (nothing linked them)
--   • how far ahead people may book, and how much notice we need
--   • a Stripe checkout reference, so a paid booking can be matched to its
--     session when the webhook lands

alter table booking_services add column if not exists resource_id uuid
  references booking_resources(id) on delete set null;
comment on column booking_services.resource_id is
  'Who delivers this. NULL = the first free active resource takes it.';

-- booking window: no same-minute surprises, no bookings a year out
alter table booking_services add column if not exists lead_time_min int not null default 120;
alter table booking_services add column if not exists horizon_days  int not null default 60;
alter table booking_services add column if not exists requires_payment boolean not null default false;

-- a booking page with no picture of the room sells nothing — a hero image
-- per service, plus the address people actually need to turn up to
alter table booking_services add column if not exists image_url text;
alter table booking_services add column if not exists location text;

-- match a Stripe Checkout Session back to its booking (webhook fulfilment)
alter table bookings add column if not exists checkout_ref text;
create unique index if not exists bookings_checkout_ref_uidx
  on bookings (checkout_ref) where checkout_ref is not null;

-- a customer's own reference, so they can be told "your booking is confirmed"
-- without exposing the row id in a link anyone could guess
alter table bookings add column if not exists public_ref text;
create unique index if not exists bookings_public_ref_uidx
  on bookings (public_ref) where public_ref is not null;
