-- ═══ Bookings: services, resources, availability, appointments ═══
-- Idempotent. Run in the Supabase SQL editor. Powers the public /events
-- booking page, the shareable /book link, and the dashboard availability +
-- booking manager. Payment is per-transaction (Square/PayPal), no catalog.

-- a bookable thing ("Podcast studio hour", "Discovery call") — "add a booking
-- section type" = insert a row here
create table if not exists booking_services (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now() not null,
  name         text not null,
  slug         text not null unique,
  description  text,
  duration_min int  not null default 30 check (duration_min between 5 and 1440),
  price_cents  int  not null default 0 check (price_cents >= 0),
  currency     text not null default 'AUD',
  active       boolean not null default true,
  sort_order   int  not null default 0
);

-- who/what is booked — tech@ / hello@ / contact@ live here as resources
create table if not exists booking_resources (
  id           uuid default gen_random_uuid() primary key,
  created_at   timestamptz default now() not null,
  label        text not null,
  email        text,
  timezone     text not null default 'Australia/Melbourne',
  active       boolean not null default true
);

-- weekly recurring hours per resource (0=Sunday … 6=Saturday), local time
create table if not exists booking_availability (
  id          uuid default gen_random_uuid() primary key,
  resource_id uuid not null references booking_resources(id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 6),
  start_min   int  not null check (start_min between 0 and 1440), -- minutes from midnight
  end_min     int  not null check (end_min between 0 and 1440),
  check (end_min > start_min)
);
create index if not exists booking_availability_resource_idx on booking_availability (resource_id, weekday);

-- one-off days a resource is unavailable (holidays, block-outs)
create table if not exists booking_blackouts (
  id          uuid default gen_random_uuid() primary key,
  resource_id uuid not null references booking_resources(id) on delete cascade,
  day         date not null,
  reason      text
);
create index if not exists booking_blackouts_resource_idx on booking_blackouts (resource_id, day);

-- a real appointment. Customer-created via the public page; the unique
-- constraint is the double-booking guard (never check-then-write).
create table if not exists bookings (
  id             uuid default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  service_id     uuid references booking_services(id) on delete set null,
  resource_id    uuid not null references booking_resources(id) on delete cascade,
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  customer_name  text not null,
  customer_email text not null,
  customer_phone text,
  notes          text,
  status         text not null default 'confirmed' check (status in ('pending','confirmed','cancelled')),
  payment_status text not null default 'unpaid'  check (payment_status in ('unpaid','paid','refunded')),
  payment_ref    text,
  amount_cents   int  not null default 0
);
-- a resource can hold only one live booking per start time
create unique index if not exists bookings_no_double_uidx
  on bookings (resource_id, start_at) where status <> 'cancelled';
create index if not exists bookings_calendar_idx on bookings (start_at);

alter table booking_services     enable row level security;
alter table booking_resources    enable row level security;
alter table booking_availability enable row level security;
alter table booking_blackouts    enable row level security;
alter table bookings             enable row level security;
