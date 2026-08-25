-- Everything a real user does, on a project that was set up under the previous
-- release and then had the current schema.sql applied over the top.
\set ON_ERROR_STOP on
\timing off
\pset pager off

insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', 'owner@legacy.test', '{"full_name":"Owner"}'),
  ('66666666-6666-6666-6666-666666666666', 'hand@legacy.test',  '{"full_name":"Hand"}');

set role authenticated;
set request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777"}';

\echo '--- 1. the upgraded table can generate its own ids again'
select column_default is not null as members_id_has_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'members' and column_name = 'id';

\echo '--- 2. create a team (this is what failed: id came out null)'
select public.create_team('Migrated Shop', 'Owner') -> 'team' ->> 'name' as team_created;
select public.my_team() is not null as on_a_team, public.is_manager() as is_manager;
select join_code from public.teams \gset

\echo '--- 3. crew joins, builds the day, finishes a job with a photo'
set request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666"}';
select public.join_team(:'join_code', 'Hand') -> 'member' ->> 'role' as joined;
set request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777"}';
insert into public.blocks (team_id, name, position, created_by)
values (public.my_team(), 'Opening', 0, public.me());
insert into public.block_items (block_id, team_id, title, weekdays, created_by)
select id, team_id, 'Mop up', array[1,2,3,4,5]::smallint[], public.me() from public.blocks;
select public.ensure_todays_tasks(current_date) as tasks_built;

set request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666"}';
select id as t from public.tasks limit 1 \gset
insert into public.task_photos (task_id, member_id, storage_path)
values (:t, public.me(), public.me()::text || '/1/p.jpg') returning id as photo_row;
select status from public.complete_task(:t, 'all done');

\echo '--- 4. the manager sees who did it and signs it off'
set request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777"}';
select t.title, m.name as completed_by from public.tasks t
  join public.members m on m.id = t.completed_by where t.id = :t;
update public.tasks set status = 'verified' where id = :t returning status as verified;

\echo '--- 5. and a second location still works'
select public.create_team('Migrated Two', 'Owner') -> 'team' ->> 'name' as second_location;
select count(*) as locations from public.my_teams();
reset role;
