-- =============================================================================
--  Wipes this app's tables and starts over. Run ONLY if you set up an earlier
--  version of the schema and want a clean slate — it deletes all tasks, photo
--  records and team data.
--
--  Run this first, then run supabase/schema.sql.
--
--  It does not touch your Supabase account, other schemas, or the auth users.
--  To also clear the sign-ups, use Authentication → Users and delete them there.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.activity        cascade;
drop table if exists public.task_photos     cascade;
drop table if exists public.tasks           cascade;
drop table if exists public.block_items     cascade;
drop table if exists public.blocks          cascade;
drop table if exists public.task_templates  cascade;   -- from an interim version
drop table if exists public.task_windows    cascade;   -- from an interim version
drop table if exists public.shifts          cascade;   -- from an interim version
drop table if exists public.member_devices  cascade;   -- from an interim version
drop table if exists public.members         cascade;
drop table if exists public.accounts        cascade;
drop table if exists public.invites         cascade;   -- from the first version
drop table if exists public.profiles        cascade;   -- from the first version
drop table if exists public.teams           cascade;
drop table if exists public.settings        cascade;   -- from the first version
drop table if exists public.sessions        cascade;
drop table if exists public.login_codes     cascade;

drop function if exists public.handle_new_user()                cascade;
drop function if exists public.whoami()                         cascade;
drop function if exists public.my_teams()                       cascade;
drop function if exists public.my_membership()                  cascade;
drop function if exists public.switch_team(uuid)                cascade;
drop function if exists public.set_my_name(text)                cascade;
drop function if exists public.create_team(text, text)          cascade;
drop function if exists public.create_team(text, text, text)    cascade;
drop function if exists public.join_team(text, text)            cascade;
drop function if exists public.join_team(text, text, text)      cascade;
drop function if exists public.leave_team()                     cascade;
drop function if exists public.login_with_code(text, text)      cascade;
drop function if exists public.link_device(uuid, text)          cascade;
drop function if exists public.rotate_team_code(text)           cascade;
drop function if exists public.rename_team(text)                cascade;
drop function if exists public.me()                             cascade;
drop function if exists public.my_team()                        cascade;
drop function if exists public.my_name()                        cascade;
drop function if exists public.is_manager()                     cascade;
drop function if exists public.acts_as_manager()                cascade;
drop function if exists public.is_admin()                       cascade;
drop function if exists public.is_active()                      cascade;
drop function if exists public.gen_code(integer)                cascade;
drop function if exists public.normalize_code(text)             cascade;
drop function if exists public.ensure_todays_tasks(date)        cascade;
drop function if exists public.complete_task(bigint, text, integer) cascade;
drop function if exists public.employee_day_stats(date)         cascade;
drop function if exists public.daily_trend(date, date)          cascade;
drop function if exists public.range_stats(date, date, uuid)    cascade;
drop function if exists public.touch_last_seen()                cascade;
drop function if exists public.remove_member(uuid)              cascade;
drop function if exists public.restore_member(uuid)             cascade;
drop function if exists public.upsert_shift(text, date, time, time, uuid) cascade;
drop function if exists public.link_schedule_name(uuid, text)   cascade;
drop function if exists public.generate_scheduled_tasks(date)   cascade;
drop function if exists public.day_schedule(date)               cascade;
drop function if exists public.my_shift(date)                   cascade;
drop function if exists public.match_member(uuid, text)         cascade;
drop function if exists public.name_key(text)                   cascade;
drop function if exists public.reorder_blocks(bigint[])         cascade;
drop function if exists public.guard_bypassed()                 cascade;
drop function if exists public.tasks_before_insert()            cascade;
drop function if exists public.tasks_before_update()            cascade;
drop function if exists public.members_guard()                  cascade;
drop function if exists public.profiles_guard()                 cascade;
drop function if exists public.log_task_activity()              cascade;
drop function if exists public.log_photo_activity()             cascade;

drop policy if exists task_photos_insert on storage.objects;
drop policy if exists task_photos_select on storage.objects;
drop policy if exists task_photos_delete on storage.objects;

-- Photo files themselves stay in the bucket. To clear them too:
--   delete from storage.objects where bucket_id = 'task-photos';
