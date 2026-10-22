-- ═══ Card uploads go straight into Google Drive (the owner, 22 Oct 2026) ═══
-- "what i thought uploading here uploaded straight to drive", "we will have folders for each client", "with usp
-- sharing and they can easily get that drive from there and u create versions". Read by scripts/gen-db-types.mjs;
-- RTDB, nothing to run.
--
-- Each card gets its own folder the app makes: Clients / {client} / {card} / V1, V2 … — shared anyone-with-the-link.
-- upload_folder_lock is a claim held while the folders are made, so two uploads at once never make two folders.

alter table content_items add column if not exists upload_folder_id text;
alter table content_items add column if not exists upload_folder_url text;
alter table content_items add column if not exists upload_folder_lock text;
alter table content_items add column if not exists upload_version_folders jsonb;
alter table clients add column if not exists upload_folder_id text;
