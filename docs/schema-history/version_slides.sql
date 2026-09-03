-- Multi-slide asset versions — an Instagram carousel is ONE post made of many
-- files, and a version could only ever hold one.
--
-- `files` is the ordered truth: [{url, name, type:'image'|'video', bytes?}].
-- `file_url` stays as the FIRST slide so every existing reader — the portal
-- preview, the Drive mirror, the publish planner — keeps working untouched.
-- Writers set both; readers take `files` when it is non-empty, else [file_url].
alter table asset_versions
  add column if not exists files jsonb not null default '[]'::jsonb;

-- Backfill: every version that already has an upload becomes a one-slide
-- version, so `files` is the single shape the code can read from day one.
-- Idempotent — it only touches rows still holding the default.
update asset_versions
   set files = jsonb_build_array(
         jsonb_build_object(
           'url', file_url,
           'name', regexp_replace(split_part(file_url, '?', 1), '^.*/', ''),
           'type', case
             when file_url ~* '\.(mp4|mov|webm|m4v|avi)(\?|$)' then 'video'
             else 'image'
           end
         )
       )
 where files = '[]'::jsonb
   and coalesce(file_url, '') <> '';
