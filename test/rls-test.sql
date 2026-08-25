\set ON_ERROR_STOP on
\timing off
\pset pager off

\echo '--- 1. signing up creates an account with no team yet'
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'boss@mojo.test', '{"full_name":"Sam Boss"}'),
  ('22222222-2222-2222-2222-222222222222', 'jose@mojo.test', '{"full_name":"Jose Perez"}'),
  ('33333333-3333-3333-3333-333333333333', 'mia@mojo.test',  '{"full_name":"Mia Ruiz"}');
select email, name, active_team_id is null as no_team from public.accounts order by email;
select count(*) as memberships_yet from public.members;

set role authenticated;

\echo '--- 2. Sam opens the first location'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.create_team('Mojo Downtown', 'Sam Boss') -> 'team' ->> 'name' as team_created;
select join_code as downtown_code from public.teams where name = 'Mojo Downtown' \gset
select public.me() as sam_downtown \gset
select length(:'downtown_code') as code_len, public.is_manager() as sam_is_manager;

\echo '--- 3. an account with no team sees nothing'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as teamless_sees_tasks from public.tasks;
select public.my_team() is null as has_no_team;

\echo '--- 4. a wrong code is rejected (expect failure)'
\set ON_ERROR_STOP off
select public.join_team('ZZZZZZ', 'Jose Perez');
\set ON_ERROR_STOP on

\echo '--- 5. Jose joins with the crew code (dashes and lower case are fine)'
select public.join_team(
         lower(substr(:'downtown_code', 1, 3)) || '-' || lower(substr(:'downtown_code', 4, 3)),
         'Jose Perez') -> 'member' ->> 'role' as joined_as;
select public.me() as jose_downtown \gset
select count(*) as jose_can_see_his_team from public.teams;

\echo '--- 6. Sam assigns work to Jose'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.tasks (title, assigned_to, work_date, requires_photo)
values ('Sweep the shop floor', :'jose_downtown', current_date, true);
select title, status, team_id is not null as stamped_with_team from public.tasks;

\echo '--- 7. Jose cannot finish without a photo (expect failure)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select id as sweep_task from public.tasks where title = 'Sweep the shop floor' \gset
\set ON_ERROR_STOP off
select public.complete_task(:sweep_task);
\set ON_ERROR_STOP on

\echo '--- 8. photo lands -> in_progress, then it completes'
insert into public.task_photos (task_id, member_id, storage_path)
values (:sweep_task, public.me(), public.me()::text || '/1/proof.jpg');
select status from public.tasks where id = :sweep_task;
select status from public.complete_task(:sweep_task, 'All done', 25);

\echo '--- 9. Jose cannot verify his own work (expect failure)'
\set ON_ERROR_STOP off
update public.tasks set status = 'verified' where id = :sweep_task;
\set ON_ERROR_STOP on

\echo '--- 10. Jose cannot promote himself (guard silently reverts it)'
update public.members set role = 'manager' where id = :'jose_downtown';
select name, role from public.members where id = :'jose_downtown';

\echo '--- 11. Sam verifies; reviewer is stamped automatically'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.tasks set status = 'verified', review_note = 'Looks good' where id = :sweep_task;
select status, review_note, reviewed_by is not null as has_reviewer from public.tasks
 where id = :sweep_task;

\echo '=== MULTIPLE LOCATIONS ==='

\echo '--- 12. Sam opens a second location; it becomes the active one'
select public.create_team('Mojo Airport', 'Sam Boss') -> 'team' ->> 'name' as second_location;
select public.my_team() = (select id from public.teams where name = 'Mojo Airport') as now_at_airport;
select count(*) as sam_belongs_to from public.my_teams();

\echo '--- 13. the airport shows none of downtown''s work'
select count(*) as tasks_visible_at_airport from public.tasks;
select count(*) as crew_visible_at_airport from public.members where team_id = public.my_team();

\echo '--- 14. switching back brings downtown into view'
select public.switch_team((select id from public.teams where name = 'Mojo Downtown'))
       -> 'team' ->> 'name' as switched_to;
select count(*) as tasks_visible_downtown from public.tasks;
select public.me() = :'sam_downtown' as same_membership_as_before;

\echo '--- 15. each location keeps its own crew code'
select count(distinct join_code) as distinct_codes from public.teams;
select name, role, crew_count from public.my_teams();

\echo '--- 16. an employee can work at two locations too'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.switch_team((select id from public.teams where name = 'Mojo Airport')) -> 'team' ->> 'name' as at_airport;
select join_code as airport_code from public.teams where name = 'Mojo Airport' \gset
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.join_team(:'airport_code', 'Jose Perez') -> 'team' ->> 'name' as jose_joined;
select count(*) as jose_belongs_to from public.my_teams();
select public.me() <> :'jose_downtown' as separate_membership_per_location;
select count(*) as jose_sees_at_airport from public.tasks;
select public.switch_team((select id from public.teams where name = 'Mojo Downtown')) -> 'team' ->> 'name' as back_downtown;
select count(*) as jose_sees_downtown from public.tasks;

\echo '--- 16b. a crew member cannot start their own location (expect failure)'
-- Jose is an employee on both locations and manages neither
\set ON_ERROR_STOP off
select public.create_team('Jose Freelance', 'Jose Perez');
\set ON_ERROR_STOP on
select count(*) as jose_still_belongs_to from public.my_teams();

\echo '--- 17. you cannot switch to a team you are not on (expect failure)'
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
\set ON_ERROR_STOP off
select public.switch_team((select id from public.teams where name = 'Mojo Downtown'));
\set ON_ERROR_STOP on

\echo '--- 18. an outsider still sees nothing at all'
select public.create_team('Rival Plumbing', 'Mia R') -> 'team' ->> 'name' as rival_team;
select count(*) as rival_sees_tasks   from public.tasks;
select count(*) as rival_sees_members from public.members where team_id <> public.my_team();
select count(*) as rival_sees_teams   from public.teams;

\echo '--- 19. the daily list rolls out once, for the active team only'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.switch_team((select id from public.teams where name = 'Mojo Downtown')) -> 'team' ->> 'name' as working_at;
insert into public.blocks (team_id, name, position, created_by)
values (public.my_team(), 'Opening', 0, public.me());
insert into public.block_items (block_id, team_id, title, created_by)
select id, team_id, 'Opening checklist', public.me() from public.blocks where name = 'Opening';
select public.ensure_todays_tasks(current_date) as first_call;
select public.ensure_todays_tasks(current_date) as second_call;
select public.switch_team((select id from public.teams where name = 'Mojo Airport')) -> 'team' ->> 'name' as now_at;
select public.ensure_todays_tasks(current_date) as airport_gets_nothing;

\echo '--- 19a. leaving a team keeps the record of what you finished'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.switch_team((select id from public.teams where name = 'Mojo Airport')) -> 'team' ->> 'name' as jose_at;
select public.leave_team() -> 'teams' as jose_teams_after_leaving;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.switch_team((select id from public.teams where name = 'Mojo Downtown')) -> 'team' ->> 'name' as sam_at;
select t.title, m.name as still_credited_to
  from public.tasks t join public.members m on m.id = t.completed_by
 where t.completed_by is not null;

\echo '--- 19b. a login that predates this schema heals itself'
-- reset.sql clears the app tables but Supabase keeps the auth users, so a
-- returning login can arrive with no account row at all
reset role;
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'legacy@mojo.test');
delete from public.accounts where id = '55555555-5555-5555-5555-555555555555';
set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555"}';
select public.whoami() -> 'account' ->> 'email' as account_rebuilt;
select public.create_team('Recovered Shop', 'Legacy User') -> 'team' ->> 'name' as can_create_team;

\echo '--- 20. a manager can still fix things from the SQL editor (no JWT)'
reset role;
reset request.jwt.claims;
update public.members set role = 'manager' where id = :'jose_downtown';
select name, role from public.members where id = :'jose_downtown';
