-- Run this in your Supabase SQL editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the leads table that receives contact form submissions.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now() not null,
  fname       text,
  lname       text,
  email       text,
  phone       text,
  biz         text,
  model       text,   -- services selected
  need        text,   -- content needs
  budget      text,
  timeline    text
);

-- Allow the API (service role) to insert and select
alter table public.leads enable row level security;

create policy "service_role_all" on public.leads
  for all
  using (true)
  with check (true);
