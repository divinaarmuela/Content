-- Abby, 11 Sep 2026: "The task in Asana must have the link on the description
-- eg. Canva link and page number for her to go through." Where the quality
-- reviewer should look, when the final does not live on the card itself.
alter table content_items
  add column if not exists review_link text;
