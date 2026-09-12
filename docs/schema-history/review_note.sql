-- "…and page number": the free line beside the review link ("page 3").
alter table content_items
  add column if not exists review_note text;
