-- WHERE THE FOOTAGE LIVES (11 Sep 2026, the owner: "how do they get the
-- dropbox link"). Whoever has the footage pastes the Dropbox or Drive folder
-- on the shoot page; when the footage is handed over, every card from the
-- shoot gets it as "Files to work from" and the editor's email carries it.
alter table batches add column if not exists footage_url text;
