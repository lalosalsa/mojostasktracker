\set ON_ERROR_STOP on
\timing off
\pset pager off

-- A team with a manager and three crew members
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'boss@mojo.test', '{"full_name":"Sam Boss"}'),
  ('22222222-2222-2222-2222-222222222222', 'jose@mojo.test', '{"full_name":"Jose Perez"}'),
  ('33333333-3333-3333-3333-333333333333', 'mia@mojo.test',  '{"full_name":"Mia Ruiz"}'),
  ('44444444-4444-4444-4444-444444444444', 'dee@mojo.test',  '{"full_name":"Dee Fox"}');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.create_team('Mojo Services', 'Sam Boss') -> 'team' ->> 'name' as team;
select join_code from public.teams \gset

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.join_team(:'join_code', 'Jose Perez') -> 'member' ->> 'role' as r1;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.join_team(:'join_code', 'Mia Ruiz') -> 'member' ->> 'role' as r2;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select public.join_team(:'join_code', 'Dee Fox') -> 'member' ->> 'role' as r3;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

\echo '--- 1. importing shifts matches names, however they are written'
select public.upsert_shift('JOSE PEREZ',  current_date, '08:00', '16:00') as s1;
select public.upsert_shift('Ruiz, Mia',   current_date, '12:00', '20:00') as s2;
select public.upsert_shift('D. Fox',      current_date, '09:00', '17:00') as s3;   -- won't match
select person_name, member_id is not null as matched, starts_at, ends_at
  from public.shifts order by starts_at;

\echo '--- 2. the manager links the odd spelling, and it back-fills'
select public.link_schedule_name('44444444-4444-4444-4444-444444444444', 'D. Fox');
select person_name, member_id is not null as matched from public.shifts order by starts_at;

\echo '--- 3. re-importing the same schedule updates instead of duplicating'
select public.upsert_shift('JOSE PEREZ', current_date, '08:00', '18:00') as same_row;
select count(*) as shift_rows from public.shifts;
select ends_at as jose_new_end from public.shifts where person_name = 'JOSE PEREZ';

\echo '--- 4. windows: morning job for everyone, afternoon job for one person'
insert into public.task_windows (team_id, title, starts_at, ends_at, assign_mode, created_by)
values (public.my_team(), 'Opening sweep', '08:00', '11:00', 'everyone',
        '11111111-1111-1111-1111-111111111111');
insert into public.task_windows (team_id, title, starts_at, ends_at, assign_mode, created_by)
values (public.my_team(), 'Lunch rush restock', '12:00', '14:00', 'one',
        '11111111-1111-1111-1111-111111111111');
insert into public.task_windows (team_id, title, starts_at, ends_at, assign_mode, created_by)
values (public.my_team(), 'Closing checklist', '21:00', '23:00', 'everyone',
        '11111111-1111-1111-1111-111111111111');

\echo '--- 5. generating assigns by who is actually on shift'
select public.generate_scheduled_tasks(current_date) as tasks_created;
select t.title, m.name as assigned_to, t.window_start, t.window_end
  from public.tasks t left join public.members m on m.id = t.assigned_to
 order by t.window_start, m.name;

\echo '--- 6. nobody works 21:00, so the closing checklist assigned nobody'
select count(*) as closing_tasks from public.tasks where title = 'Closing checklist';

\echo '--- 7. running it again creates nothing new'
select public.generate_scheduled_tasks(current_date) as second_run;
select count(*) as total_tasks from public.tasks;

\echo '--- 8. a late shift edit gets picked up on the next run'
select public.upsert_shift('Sam Boss', current_date, '07:00', '15:00') as boss_shift;
select public.generate_scheduled_tasks(current_date) as after_new_shift;
select m.name as newly_assigned, t.title from public.tasks t
  join public.members m on m.id = t.assigned_to
 where m.name = 'Sam Boss' order by t.title;

\echo '--- 9. the crew only sees their own assignments'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select title, window_start, window_end from public.tasks order by window_start;
select starts_at, ends_at from public.my_shift(current_date);

\echo '--- 10. the manager sees the whole day'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select person_name, matched, starts_at, ends_at, task_count from public.day_schedule(current_date);

\echo '--- 11. a manager can promote someone else to manager'
update public.members set role = 'manager' where id = '33333333-3333-3333-3333-333333333333';
select name, role from public.members where name = 'Mia Ruiz';
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.is_manager() as mia_is_now_manager;
select count(*) as mia_sees_whole_schedule from public.day_schedule(current_date);

\echo '--- 12. removing someone frees their open work but keeps the finished record'
-- Dee finishes one job herself (only you can attach your own photos)
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select id as dee_task from public.tasks
 where assigned_to = '44444444-4444-4444-4444-444444444444' limit 1 \gset
insert into public.task_photos (task_id, member_id, storage_path)
values (:dee_task, '44444444-4444-4444-4444-444444444444',
        '44444444-4444-4444-4444-444444444444/1/p.jpg');
select status from public.complete_task(:dee_task);

-- then the manager takes her off the team
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.tasks (title, assigned_to, work_date)
values ('Unfinished job', '44444444-4444-4444-4444-444444444444', current_date);
select public.remove_member('44444444-4444-4444-4444-444444444444');
select status from public.members where name = 'Dee Fox';
select count(*) as dee_finished_work_kept from public.tasks
 where assigned_to = '44444444-4444-4444-4444-444444444444' and status = 'submitted';
select count(*) as dee_open_work_freed from public.tasks
 where assigned_to is null and status in ('open', 'in_progress');

\echo '--- 13. a removed person has no access at all'
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select public.my_team() is null as dee_has_no_team;
select count(*) as dee_sees_tasks from public.tasks;

\echo '--- 14. a manager cannot remove themselves (expect failure)'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
\set ON_ERROR_STOP off
select public.remove_member('11111111-1111-1111-1111-111111111111');
\set ON_ERROR_STOP on

\echo '--- 15. crew cannot touch the schedule (expect 0 rows / failure)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as jose_sees_only_own_shift from public.shifts;
\set ON_ERROR_STOP off
select public.upsert_shift('Jose Perez', current_date + 1, '08:00', '16:00');
\set ON_ERROR_STOP on
reset role;
