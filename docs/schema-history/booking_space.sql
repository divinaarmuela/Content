-- ═══ Bookings, part 6: two names, one room ═══
-- Idempotent. Run in the Supabase SQL editor AFTER supabase/booking_no_overlap.sql.
--
-- "MD House Podcast Studio" and "MD House Creative Studio" are two names for
-- the same physical room. The no-overlap constraint keyed on resource_id, so
-- the database believed they were two rooms and happily accepted a podcast at
-- 9:00 AND a Shoot & Go at 9:00 — two crews, one room.
--
-- Resources now carry a SPACE. Names stay as they are; the space is what
-- cannot be double-booked. A resource with no space set is its own space, so
-- a genuinely separate second room needs nothing done to it.

-- ── 1. every resource has a space; by default it is its own ──
alter table booking_resources add column if not exists space_id uuid;
update booking_resources set space_id = id where space_id is null;

-- ── 2. bookings carry the space too ──
-- An exclusion constraint cannot look at another table, so the space must
-- live on the row. A trigger fills it from the resource: the application
-- cannot forget, and a resource moved to another space takes its bookings
-- with it.
alter table bookings add column if not exists space_id uuid;

create or replace function bookings_fill_space() returns trigger
language plpgsql as $$
begin
  select r.space_id into new.space_id
    from booking_resources r where r.id = new.resource_id;
  -- a resource with no space is its own space
  if new.space_id is null then new.space_id := new.resource_id; end if;
  return new;
end $$;

drop trigger if exists bookings_fill_space_trg on bookings;
create trigger bookings_fill_space_trg
  before insert or update of resource_id on bookings
  for each row execute function bookings_fill_space();

-- ── 3. the two MD House studios are one room ──
-- Deliberately narrow: it groups only the rows that are actually the same
-- room. Anything else keeps its own space and its own calendar.
update booking_resources set space_id = (
  select id from booking_resources where label ilike 'MD House%' order by id limit 1
) where label ilike 'MD House%';

-- ── 4. bring existing bookings in line ──
update bookings b
   set space_id = coalesce(r.space_id, b.resource_id)
  from booking_resources r
 where r.id = b.resource_id
   and b.space_id is distinct from coalesce(r.space_id, b.resource_id);

-- ── 5. the guarantee now reads on the ROOM, not the name ──
create extension if not exists btree_gist;
alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    space_id  with =,
    seat_no   with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status <> 'cancelled');
-- '[)' is half-open on purpose: a session ending at 11:00 and one starting
-- at 11:00 are back-to-back, not a clash.

-- To undo the grouping later (they really are two rooms after all):
--   update booking_resources set space_id = id;
--   update bookings b set space_id = b.resource_id;
