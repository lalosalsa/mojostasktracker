\set ON_ERROR_STOP on
\timing off
\pset pager off

\echo '--- 1. verifying an email creates a member with no team yet'
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'boss@mojo.test', '{"full_name":"Sam Boss"}');
insert into auth.users (id, email, raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222', 'jose@mojo.test', '{"full_name":"Jose P"}');
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'mia@mojo.test');
select email, name, role, team_id is null as no_team from public.members order by email;

set role authenticated;

\echo '--- 2. Sam creates a team and gets the share codes'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.create_team('Mojo Services', 'Sam Boss') -> 'team' ->> 'name' as team_created;
select length(join_code) as join_code_len, length(manager_code) as manager_code_len,
       join_code <> manager_code as codes_differ
  from public.teams;
-- the manager reads the codes here and passes them on out of band, exactly as
-- in real life: a crew member cannot read the teams table at all
select join_code, manager_code from public.teams where name = 'Mojo Services' \gset

\echo '--- 3. a signed-up person with no team sees nothing'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as teamless_sees_tasks from public.tasks;
select public.my_team() is null as has_no_team;

\echo '--- 4. a wrong code is rejected (expect failure)'
\set ON_ERROR_STOP off
select public.join_team('ZZZZZZ', 'Jose P');
\set ON_ERROR_STOP on

\echo '--- 5. Jose joins with the crew code (dashes and lower case are fine)'
select public.join_team(
         lower(substr(:'join_code', 1, 3)) || '-' || lower(substr(:'join_code', 4, 3)),
         'Jose P') -> 'member' ->> 'role' as joined_as;
select count(*) as jose_can_now_see_his_team from public.teams;

\echo '--- 6. Sam assigns work to Jose'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.tasks (title, assigned_to, work_date, requires_photo)
values ('Sweep the shop floor', '22222222-2222-2222-2222-222222222222', current_date, true);
select title, status, team_id is not null as stamped_with_team from public.tasks;

\echo '--- 7. Jose cannot finish without a photo (expect failure)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
\set ON_ERROR_STOP off
select public.complete_task((select id from public.tasks where title = 'Sweep the shop floor'));
\set ON_ERROR_STOP on

\echo '--- 8. photo lands -> in_progress, then it completes'
insert into public.task_photos (task_id, member_id, storage_path)
values ((select id from public.tasks where title = 'Sweep the shop floor'),
        '22222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222/1/proof.jpg');
select status from public.tasks where title = 'Sweep the shop floor';
select status from public.complete_task(
  (select id from public.tasks where title = 'Sweep the shop floor'), 'All done', 25);

\echo '--- 9. Jose cannot verify his own work (expect failure)'
\set ON_ERROR_STOP off
update public.tasks set status = 'verified' where title = 'Sweep the shop floor';
\set ON_ERROR_STOP on

\echo '--- 10. Jose cannot promote himself (guard silently reverts it)'
update public.members set role = 'manager' where id = '22222222-2222-2222-2222-222222222222';
select name, role from public.members where email = 'jose@mojo.test';

\echo '--- 11. a different team cannot see any of this'
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.create_team('Rival Plumbing', 'Mia R') -> 'team' ->> 'name' as second_team;
select count(*) as rival_sees_tasks   from public.tasks;
select count(*) as rival_sees_members from public.members;
select count(*) as rival_sees_teams   from public.teams;
select count(*) as rival_sees_photos  from public.task_photos;

\echo '--- 12. Sam verifies; reviewer is stamped automatically'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.tasks set status = 'verified', review_note = 'Looks good'
 where title = 'Sweep the shop floor';
select status, review_note, reviewed_by is not null as has_reviewer from public.tasks
 where title = 'Sweep the shop floor';

\echo '--- 13. recurring checklist rolls out once per day, for this team only'
insert into public.task_templates (team_id, title, recurrence, assigned_to, created_by)
values (public.my_team(), 'Opening checklist', 'daily',
        '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
select public.ensure_todays_tasks(current_date) as first_call;
select public.ensure_todays_tasks(current_date) as second_call;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.ensure_todays_tasks(current_date) as other_team_gets_nothing;

\echo '--- 14. reporting is scoped to the caller''s team'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select * from public.range_stats(current_date - 7, current_date);
select name, assigned, completed, photos from public.employee_day_stats(current_date);
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select total as rival_total from public.range_stats(current_date - 7, current_date);

\echo '--- 15. the manager code makes the joiner a manager'
reset role;   -- signing up happens through Supabase Auth, not as a table user
insert into auth.users (id, email, raw_user_meta_data)
values ('44444444-4444-4444-4444-444444444444', 'pat@mojo.test', '{"full_name":"Pat M"}');
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select public.join_team(:'manager_code', 'Pat M') -> 'member' ->> 'role' as joined_as;

\echo '--- 16. rotating the crew code invalidates the old one'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.rotate_team_code('join') ->> 'join_code' <> :'join_code' as code_changed;

\echo '--- 17. the last manager cannot strand the team (expect failure)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.leave_team() -> 'member' ->> 'role' as employee_can_leave;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
\set ON_ERROR_STOP off
select public.leave_team();
\set ON_ERROR_STOP on

\echo '--- 18. a manager can still fix things from the SQL editor (no JWT)'
reset role;
reset request.jwt.claims;
update public.members set role = 'manager' where email = 'jose@mojo.test';
select email, role from public.members where email = 'jose@mojo.test';
