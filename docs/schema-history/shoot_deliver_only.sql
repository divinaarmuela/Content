-- DELIVERY ONLY, SAID ON THE SHOOT (the owner, 14 Sep 2026: "sometimes when
-- we finish a shoot, how can we set it up for only delivery, meaning we
-- won't be sending to a scheduler"). One switch on the shoot page: every
-- card on the shoot takes the word (content_items.deliver_only), and the
-- cards the plan makes are born with it. A card's own word can still be
-- changed afterwards; the client's setting (clients.posts_own_content) is
-- the fallback when neither says.
alter table batches add column if not exists deliver_only boolean;
