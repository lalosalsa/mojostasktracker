\set ON_ERROR_STOP on
\timing off
\pset pager off

\echo '--- 1. signup trigger: first user becomes the manager'
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'boss@mojo.test');
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'jose@mojo.test');
select email, role, status from public.profiles order by created_at;

\echo '--- 2. invited email skips the waiting room'
insert into public.invites (email, role, full_name) values ('mia@mojo.test', 'employee', 'Mia R');
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'mia@mojo.test');
select email, full_name, role, status from public.profiles where email = 'mia@mojo.test';
select count(*) as invites_left from public.invites;

\echo '--- 3. manager approves Jose'
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.profiles set status = 'active' where email = 'jose@mojo.test';
select email, status from public.profiles where email = 'jose@mojo.test';

\echo '--- 4. manager assigns a task to Jose'
insert into public.tasks (title, assigned_to, work_date, requires_photo)
values ('Sweep the shop floor', '22222222-2222-2222-2222-222222222222', current_date, true);
insert into public.tasks (title, assigned_to, work_date, requires_photo)
values ('Restock the van', '33333333-3333-3333-3333-333333333333', current_date, true);
select id, title, status from public.tasks order by id;

\echo '--- 5. Jose only sees his own task (RLS)'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as visible_to_jose from public.tasks;

\echo '--- 6. Jose cannot finish without a photo (expect failure)'
\set ON_ERROR_STOP off
select public.complete_task((select id from public.tasks where title = 'Sweep the shop floor'));
\set ON_ERROR_STOP on

\echo '--- 7. photo lands -> task flips to in_progress, then completes'
insert into public.task_photos (task_id, user_id, storage_path)
values ((select id from public.tasks where title = 'Sweep the shop floor'),
        '22222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222/1/proof.jpg');
select status from public.tasks where title = 'Sweep the shop floor';
select status from public.complete_task((select id from public.tasks where title = 'Sweep the shop floor'), 'All done', 25);

\echo '--- 8. Jose cannot verify his own work (expect failure)'
\set ON_ERROR_STOP off
update public.tasks set status = 'verified' where title = 'Sweep the shop floor';
\set ON_ERROR_STOP on

\echo '--- 9. Jose cannot promote himself (silently ignored by the guard)'
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
select email, role from public.profiles where email = 'jose@mojo.test';

\echo '--- 10. Jose cannot touch Mia''s task (0 rows updated)'
update public.tasks set title = 'hijacked' where title = 'Restock the van';

\echo '--- 11. manager verifies, reviewer stamped automatically'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.tasks set status = 'verified', review_note = 'Looks good' where title = 'Sweep the shop floor';
select status, review_note, reviewed_by is not null as has_reviewer, reviewed_at is not null as has_time
  from public.tasks where title = 'Sweep the shop floor';

\echo '--- 12. recurring templates roll out once per day'
insert into public.task_templates (title, recurrence, assigned_to, created_by)
values ('Opening checklist', 'daily', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111');
select public.ensure_todays_tasks(current_date) as created_first_call;
select public.ensure_todays_tasks(current_date) as created_second_call;
select count(*) as checklist_tasks from public.tasks where template_id is not null;

\echo '--- 13. reporting functions'
select * from public.range_stats(current_date - 7, current_date);
select full_name, assigned, completed, photos from public.employee_day_stats(current_date);
select count(*) as trend_rows from public.daily_trend(current_date - 6, current_date);

\echo '--- 14. activity feed captured the whole story'
select type, actor_name, detail from public.activity order by id;

\echo '--- 15. employee sees only their own activity'
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select count(*) as jose_sees_activity from public.activity;

\echo '--- 16. a pending (unapproved) person can do nothing'
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.profiles set status = 'pending' where id = '33333333-3333-3333-3333-333333333333';
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select status as mia_status from public.profiles where id = '33333333-3333-3333-3333-333333333333';
select count(*) as pending_user_can_see from public.tasks;
select public.ensure_todays_tasks(current_date) as pending_user_rollout;
\echo '    (a pending user creating a task must fail — expect an error next)'
\set ON_ERROR_STOP off
insert into public.tasks (title) values ('sneaky task');
\set ON_ERROR_STOP on

\echo '--- 17. a manager can still fix roles from the SQL editor (no JWT at all)'
reset role;
reset request.jwt.claims;
update public.profiles set status = 'active', role = 'admin' where email = 'mia@mojo.test';
select email, role, status from public.profiles where email = 'mia@mojo.test';
