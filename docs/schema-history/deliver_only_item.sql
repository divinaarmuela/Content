-- The per-card word on the same rule: true = deliver only, false = we post
-- it, null = follow the client's own setting (clients.posts_own_content).
alter table content_items
  add column if not exists deliver_only boolean;
