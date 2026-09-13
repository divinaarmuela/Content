-- THE EDITOR CONFIRMS THE FOOTAGE ARRIVED (14 Sep 2026, the owner: "how do
-- we know if he has received the footage too this time?"). One press on
-- their card stamps it; the morning after the handover an unconfirmed one
-- reminds the editor once and tells the account manager.
alter table batches add column if not exists footage_received_at timestamptz;
alter table batches add column if not exists footage_received_by uuid;
alter table batches add column if not exists footage_receipt_nudged_at timestamptz;
