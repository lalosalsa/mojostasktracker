-- Upgrading must never cost anyone their data. This fills a project in the
-- previous release's shape with real work, applies the current schema.sql over
-- the top, and checks every row is still there and still correctly linked.
\set ON_ERROR_STOP on
\timing off
\pset pager off

insert into auth.users (id, email) values
  ('aaaa0000-0000-0000-0000-000000000001','boss@real.test'),
  ('aaaa0000-0000-0000-0000-000000000002','crew@real.test');
insert into public.teams (id, name, join_code, manager_code)
values ('bbbb0000-0000-0000-0000-000000000001','Real Shop','ABC123','XYZ789');
insert into public.members (id, team_id, email, name, role, job_title) values
  ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','boss@real.test','Real Boss','manager','Owner'),
  ('aaaa0000-0000-0000-0000-000000000002','bbbb0000-0000-0000-0000-000000000001','crew@real.test','Real Crew','employee','Tech');
insert into public.blocks (id, team_id, name, starts_at, ends_at, position, created_by)
overriding system value values
  (1,'bbbb0000-0000-0000-0000-000000000001','Morning Prep','07:00','11:00',0,'aaaa0000-0000-0000-0000-000000000001'),
  (2,'bbbb0000-0000-0000-0000-000000000001','Closing',null,null,1,'aaaa0000-0000-0000-0000-000000000001');
insert into public.block_items (id, block_id, team_id, title, created_by)
overriding system value values
  (1,1,'bbbb0000-0000-0000-0000-000000000001','Stock the cooler','aaaa0000-0000-0000-0000-000000000001'),
  (2,2,'bbbb0000-0000-0000-0000-000000000001','Mop the floor','aaaa0000-0000-0000-0000-000000000001');
insert into public.tasks (id, team_id, title, status, assigned_to, created_by, work_date, notes)
overriding system value values
  (1,'bbbb0000-0000-0000-0000-000000000001','Stock the cooler','verified','aaaa0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001',current_date - 3,'was low on cans'),
  (2,'bbbb0000-0000-0000-0000-000000000001','Mop the floor','submitted','aaaa0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001',current_date - 1,'');
insert into public.task_photos (id, task_id, user_id, storage_path) overriding system value values
  (1,1,'aaaa0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000002/1/proof.jpg'),
  (2,2,'aaaa0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000002/2/proof.jpg');
insert into public.activity (team_id, actor_id, actor_name, type, detail) values
  ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','Real Crew','task.completed','Stock the cooler');

create table _before as
select (select count(*) from teams) t, (select count(*) from members) m,
       (select count(*) from blocks) b, (select count(*) from block_items) i,
       (select count(*) from tasks) k, (select count(*) from task_photos) p,
       (select count(*) from activity) a;

\echo '--- applying the current schema over the top ---'
\i supabase/schema.sql

\echo '--- 1. every row is still there'
select case when b.t = a.t and b.m = a.m and b.b = a.b and b.i = a.i
             and b.k = a.k and b.p = a.p and b.a = a.a
            then 'ALL ROWS PRESERVED' else 'DATA LOST' end as verdict,
       b.t || '/' || b.m || '/' || b.b || '/' || b.i || '/' || b.k || '/' || b.p || '/' || b.a as before,
       a.t || '/' || a.m || '/' || a.b || '/' || a.i || '/' || a.k || '/' || a.p || '/' || a.a as after
  from _before b,
       (select (select count(*) from teams) t, (select count(*) from members) m,
               (select count(*) from blocks) b, (select count(*) from block_items) i,
               (select count(*) from tasks) k, (select count(*) from task_photos) p,
               (select count(*) from activity) a) a;

\echo '--- 2. the content survived, not just the row count'
select t.title, t.status, t.notes, m.name as assigned_to
  from tasks t left join members m on m.id = t.assigned_to order by t.id;

\echo '--- 3. photos are still tied to the person who took them'
select p.storage_path, m.name as photo_owner
  from task_photos p left join members m on m.id = p.member_id order by p.id;

\echo '--- 4. people kept their names, roles and job titles'
select name, role, job_title, account_id is not null as linked_to_account
  from members order by name;

\echo '--- 5. and the app works on the upgraded project'
set role authenticated;
set request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000001"}';
select public.whoami() -> 'team' ->> 'name' as signed_in_to;
select count(*) as history_visible from public.tasks;
select public.ensure_todays_tasks(current_date) as todays_list_built;
select public.create_team('Second Location', 'Real Boss') -> 'team' ->> 'name' as can_still_add_location;
reset role;
