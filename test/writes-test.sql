-- Every write the app makes that asks for the row back. PostgREST checks that
-- RETURNING against the SELECT policy, so an insert can be allowed and the
-- statement still fail — that is what broke photo uploads twice.
\set ON_ERROR_STOP on
\timing off
\pset pager off

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'boss@w.test', '{"full_name":"Boss"}'),
  ('22222222-2222-2222-2222-222222222222', 'crew@w.test', '{"full_name":"Crew One"}'),
  ('33333333-3333-3333-3333-333333333333', 'crew2@w.test', '{"full_name":"Crew Two"}');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.create_team('Writes Co', 'Boss') -> 'team' ->> 'name' as team;
select join_code from public.teams \gset
select public.me() as boss \gset
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.join_team(:'join_code', 'Crew One');
select public.me() as crew \gset
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.join_team(:'join_code', 'Crew Two');
select public.me() as crew2 \gset

\echo '--- 1. manager: create a block and read it back'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.blocks (team_id, name, position, created_by)
values (public.my_team(), 'Opening', 0, public.me())
returning name as block_returned;
select id as block_id from public.blocks where name = 'Opening' \gset

\echo '--- 2. manager: add an item and read it back'
insert into public.block_items (block_id, team_id, title, created_by)
values (:block_id, public.my_team(), 'Mop the floor', public.me())
returning title as item_returned;

\echo '--- 3. manager: update the block and read it back'
update public.blocks set name = 'Opening shift' where id = :block_id
returning name as block_updated;

\echo '--- 4. manager: create a task assigned to someone else, read it back'
insert into public.tasks (title, assigned_to, work_date, created_by)
values ('Wipe the counters', :'crew', current_date, public.me())
returning title as task_returned;
select id as assigned_task from public.tasks where title = 'Wipe the counters' \gset

\echo '--- 5. manager: create an unassigned shared task, read it back'
insert into public.tasks (title, work_date, created_by)
values ('Shared job', current_date, public.me())
returning title as shared_returned;
select id as shared_task from public.tasks where title = 'Shared job' \gset

\echo '--- 6. crew: claim the shared task (start), read it back'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
update public.tasks set status = 'in_progress', assigned_to = public.me()
 where id = :shared_task returning status as started;

\echo '--- 7. crew: attach a photo to their own task, read it back'
insert into public.task_photos (task_id, member_id, storage_path)
values (:assigned_task, public.me(), public.me()::text || '/1/a.jpg')
returning id as photo_on_own_task;

\echo '--- 8. crew: attach a photo to the shared task they claimed, read it back'
insert into public.task_photos (task_id, member_id, storage_path)
values (:shared_task, public.me(), public.me()::text || '/2/b.jpg')
returning id as photo_on_shared_task;

\echo '--- 9. a SECOND crew member photographs an untouched shared task'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.tasks (title, work_date, created_by)
values ('Second shared job', current_date, public.me());
select id as shared2 from public.tasks where title = 'Second shared job' \gset
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
insert into public.task_photos (task_id, member_id, storage_path)
values (:shared2, public.me(), public.me()::text || '/3/c.jpg')
returning id as photo_by_other_crew;

\echo '--- 10. crew: rename a photo caption, then delete it'
update public.task_photos set caption = 'front of house'
 where id = (select id from public.task_photos where member_id = public.me() limit 1)
returning caption as caption_saved;
delete from public.task_photos where member_id = public.me() and caption = 'front of house'
returning id as photo_deleted;

\echo '--- 11. crew: finish, then undo, then finish again'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select status from public.complete_task(:assigned_task, 'done');
update public.tasks set status = 'in_progress' where id = :assigned_task
returning status as undone, completed_by is null as name_cleared;
select status from public.complete_task(:assigned_task, 'done again');

\echo '--- 12. manager: send it back, crew redoes it, manager verifies'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.tasks set status = 'rejected', review_note = 'missed a spot'
 where id = :assigned_task returning status as sent_back;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select status from public.complete_task(:assigned_task, 'fixed');
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.tasks set status = 'verified' where id = :assigned_task
returning status as verified, reviewed_by is not null as reviewer_stamped;

\echo '--- 13. crew: save their own profile, read it back'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
update public.members set job_title = 'Closer', phone = '555-0100'
 where id = public.me() returning job_title as profile_saved;
select public.set_my_name('Crew One Renamed') -> 'member' ->> 'name' as name_saved;

\echo '--- 14. manager: edit a teammate, read it back'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.members set job_title = 'Lead' where id = :'crew'
returning job_title as teammate_saved;
update public.members set role = 'manager' where id = :'crew2'
returning role as promoted;

\echo '--- 15. edge cases that must not blow up'
select public.ensure_todays_tasks(current_date + 30) as future_day_ok;
select public.ensure_todays_tasks(current_date - 30) as past_day_ok;
select count(*) as trend_rows from public.daily_trend(current_date - 6, current_date);
select total from public.range_stats(current_date, current_date);
select count(*) as day_stats_rows from public.employee_day_stats(current_date);
select public.rename_team('Writes Co HQ') ->> 'name' as renamed;
select public.rotate_team_code('manager') ->> 'manager_code' is not null as rotated;
reset role;
