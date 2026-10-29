-- OFF THE ASANA ACTIVITY PAGE (29 Oct 2026, the owner: "remove yusuf from asana activity" — both Yusufs). A person
-- whose work is not tracked there: their line is left off the People view and the Calendar, for every viewer. The
-- person, their tasks and everything else they do are untouched.
alter table team_users add column if not exists activity_hidden boolean;
