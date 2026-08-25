\set ON_ERROR_STOP on
\timing off
\pset pager off

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'boss@mojo.test', '{"full_name":"Sam Boss"}'),
  ('22222222-2222-2222-2222-222222222222', 'jose@mojo.test', '{"full_name":"Jose Perez"}'),
  ('33333333-3333-3333-3333-333333333333', 'mia@mojo.test',  '{"full_name":"Mia Ruiz"}');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.create_team('Mojo Services', 'Sam Boss') -> 'team' ->> 'name' as team;
select join_code from public.teams \gset
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.join_team(:'join_code', 'Jose Perez') -> 'member' ->> 'role' as r1;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select public.join_team(:'join_code', 'Mia Ruiz') -> 'member' ->> 'role' as r2;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

\echo '--- 1. the manager names the blocks of the day'
insert into public.blocks (team_id, name, starts_at, ends_at, position, created_by) values
  (public.my_team(), 'Morning Prep', '07:00', '11:00', 0, public.me()),
  (public.my_team(), 'Lunch Rush',   '11:00', '15:00', 1, public.me()),
  (public.my_team(), 'Closing',       null,    null,   2, public.me());
select name, coalesce(starts_at::text,'—') as starts, position from public.blocks order by position;

\echo '--- 2. and fills them with tasks'
insert into public.block_items (block_id, team_id, title, position, created_by)
select b.id, b.team_id, x.title, x.pos, public.me()
  from public.blocks b
  join (values ('Morning Prep','Unlock and light up',0),
               ('Morning Prep','Stock the front cooler',1),
               ('Lunch Rush','Wipe tables between rushes',0),
               ('Closing','Mop the floor',0),
               ('Closing','Take out the trash',1)) as x(block, title, pos)
    on x.block = b.name;
select b.name as block, i.title from public.block_items i
  join public.blocks b on b.id = i.block_id order by b.position, i.position;

\echo '--- 3. the day''s list builds itself, once'
select public.ensure_todays_tasks(current_date) as first_call;
select public.ensure_todays_tasks(current_date) as second_call;
select count(*) as tasks_today from public.tasks where work_date = current_date;

\echo '--- 4. everything starts unassigned — a shared list'
select count(*) as unassigned from public.tasks where assigned_to is null;

\echo '--- 5. anyone on the crew sees the whole list'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as jose_sees from public.tasks;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select count(*) as mia_sees from public.tasks;

\echo '--- 6. Jose finishes one and his name goes on it'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select id as t1 from public.tasks where title = 'Mop the floor' \gset
insert into public.task_photos (task_id, member_id, storage_path)
values (:t1, '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222/1/p.jpg');
select status from public.complete_task(:t1, 'Done, floor was bad today');
select t.title, m.name as completed_by, t.status
  from public.tasks t join public.members m on m.id = t.completed_by where t.id = :t1;

\echo '--- 7. Mia finishes a different one; both names show on the same list'
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id as t2 from public.tasks where title = 'Take out the trash' \gset
insert into public.task_photos (task_id, member_id, storage_path)
values (:t2, '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333/1/p.jpg');
select status from public.complete_task(:t2);
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select b.name as block, t.title, coalesce(m.name, '—') as done_by, t.status
  from public.tasks t
  left join public.members m on m.id = t.completed_by
  left join public.blocks b on b.id = t.block_id
 order by b.position, t.id;

\echo '--- 8. reopening a task clears the name again'
update public.tasks set status = 'in_progress' where id = :t2;
select completed_by is null as name_cleared from public.tasks where id = :t2;

\echo '--- 9. a task still needs its photo (expect failure)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select id as t3 from public.tasks where title = 'Unlock and light up' \gset
\set ON_ERROR_STOP off
select public.complete_task(:t3);
\set ON_ERROR_STOP on

\echo '--- 10. crew cannot edit the blocks (expect 0 rows)'
update public.blocks set name = 'hijacked' where name = 'Closing';
\echo '    (the crew adding an item must fail — expect an error next)'
\set ON_ERROR_STOP off
insert into public.block_items (block_id, team_id, title, created_by)
select id, team_id, 'sneaky', public.me() from public.blocks limit 1;
\set ON_ERROR_STOP on
select count(*) as items_after_crew_attempt from public.block_items;

\echo '--- 11. adding an item mid-day tops up today''s list only'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.block_items (block_id, team_id, title, created_by)
select id, team_id, 'Restock napkins', public.me() from public.blocks where name = 'Lunch Rush';
select public.ensure_todays_tasks(current_date) as topped_up;
select count(*) as tasks_now from public.tasks where work_date = current_date;

\echo '--- 12. pausing a block stops it appearing tomorrow'
update public.blocks set active = false where name = 'Closing';
select public.ensure_todays_tasks(current_date + 1) as tomorrow_count;
select count(*) as closing_tasks_tomorrow from public.tasks t
  join public.blocks b on b.id = t.block_id
 where t.work_date = current_date + 1 and b.name = 'Closing';

\echo '--- 13. a task can be set to specific weekdays only'
-- 2026-08-24 is a Monday, 25th a Tuesday, 26th a Wednesday
insert into public.block_items (block_id, team_id, title, weekdays, created_by)
select id, team_id, 'Deep clean the grill', array[1,3,5]::smallint[], public.me()
  from public.blocks where name = 'Morning Prep';
insert into public.block_items (block_id, team_id, title, weekdays, created_by)
select id, team_id, 'Weekend stock count', array[0,6]::smallint[], public.me()
  from public.blocks where name = 'Morning Prep';

select public.ensure_todays_tasks(date '2026-08-24') as monday_built;
select title from public.tasks where work_date = date '2026-08-24' order by title;

select public.ensure_todays_tasks(date '2026-08-25') as tuesday_built;
select count(*) as grill_on_tuesday from public.tasks
 where work_date = date '2026-08-25' and title = 'Deep clean the grill';

select public.ensure_todays_tasks(date '2026-08-26') as wednesday_built;
select count(*) as grill_on_wednesday from public.tasks
 where work_date = date '2026-08-26' and title = 'Deep clean the grill';

select public.ensure_todays_tasks(date '2026-08-29') as saturday_built;
select title from public.tasks
 where work_date = date '2026-08-29' and title like 'Weekend%';

\echo '--- 14. photo files: crew upload to their own folder, manager can see them'
reset role;
grant insert, select, update, delete on storage.objects to authenticated;
set role authenticated;

-- Jose (crew) uploads
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
insert into storage.objects (bucket_id, name, owner)
values ('task-photos', public.me()::text || '/1/proof.jpg', public.me());
select count(*) as jose_sees_own_file from storage.objects;

-- Mia (crew) cannot see Jose's file
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select count(*) as mia_sees_jose_file from storage.objects;

-- Sam (manager) can
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select count(*) as manager_sees_crew_file from storage.objects;

-- a crew member cannot write into someone else's folder (expect failure)
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
\echo '    (writing into a teammate''s folder must fail — expect an error next)'
\set ON_ERROR_STOP off
insert into storage.objects (bucket_id, name, owner)
values ('task-photos', '22222222-2222-2222-2222-222222222222/1/sneaky.jpg', public.me());
\set ON_ERROR_STOP on

\echo '--- 15. another team sees none of these blocks'
reset role;   -- signing up goes through Supabase Auth, not as a table user
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'rival@x.test');
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select public.create_team('Rival Co', 'Riv') -> 'team' ->> 'name' as other_team;
select count(*) as rival_sees_blocks from public.blocks;
select count(*) as rival_sees_items  from public.block_items;
select public.ensure_todays_tasks(current_date) as rival_gets_nothing;
select count(*) as rival_sees_photo_files from storage.objects;
reset role;
