-- THE QUALITY CHECKER IS A ROLE (the owner, 13 Sep 2026: "quality check is a
-- role"). Joy's job title in the role list, above editor and below general
-- and account manager. The quality_reviewer flag on another role keeps
-- working: isQualityReviewer() in identity-core is the one question.
alter table team_users drop constraint if exists team_users_role_check;
alter table team_users add constraint team_users_role_check
  check (role in ('super_admin','account_manager','general','quality_checker','editor','scheduler','client'));
