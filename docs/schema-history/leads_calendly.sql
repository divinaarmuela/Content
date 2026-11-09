-- 9 Nov 2026: Calendly bookings land on leads (app/lib/calendly.ts). The owner: "ensure user name, number all updated
-- in the leads page and status". booking_status: 'booked' | 'cancelled'; booking_event: the Calendly call booked;
-- booking_uri: the Calendly invitee, so a cancellation finds the same lead.
alter table public.leads add column if not exists booking_status text;
alter table public.leads add column if not exists booking_event text;
alter table public.leads add column if not exists booking_uri text;
-- 9 Nov 2026, owner: "will we have the ad name ad placement ad set etc" / "campaign name". Filled from the ad URL's
-- Meta dynamic parameters, which Calendly passes back in tracking (see app/lib/calendly-core.ts adFields).
alter table public.leads add column if not exists ad_campaign text;
alter table public.leads add column if not exists ad_set text;
alter table public.leads add column if not exists ad_name text;
alter table public.leads add column if not exists ad_placement text;
