-- THE PARTS A SHOOT DOES NOT NEED (the owner, 21 Sep 2026: "sometimes in the
-- shoot brief we don't need all the fields — allow to delete, like the out of
-- 8"). The keys of the plan's parts marked "not needed" for this shoot, e.g.
-- ["talent","props"]. The checklist leaves them out, so the count reads
-- "5 of 6 filled" instead of "5 of 8". Rules in app/lib/shoot-sop-core.ts.
alter table batches add column if not exists brief_skipped jsonb;
