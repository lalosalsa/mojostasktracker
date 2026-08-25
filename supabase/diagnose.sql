-- =============================================================================
--  Health check for this app's Supabase project.
--
--  Paste the whole file into Supabase → SQL Editor → Run, then send the result.
--  It changes nothing, and it works even when nothing has been set up yet.
-- =============================================================================

drop table if exists _report;
create temp table _report (ord int, item text, result text, verdict text);

do $diag$
declare
  v_tables text[] := array['schema_meta','teams','accounts','members','blocks',
                           'block_items','tasks','task_photos','activity'];
  v_functions text[] := array['ensure_account','whoami','my_teams','my_membership',
                              'switch_team','create_team','join_team','leave_team',
                              'me','my_team','is_manager','ensure_todays_tasks',
                              'complete_task','remove_member','restore_member'];
  v_missing text[];
  v_name text;
  v_count bigint;
  v_version text;
begin
  -- 1. which version of schema.sql was applied
  if to_regclass('public.schema_meta') is null then
    insert into _report values (1, 'schema version', 'NOT SET UP',
      'run supabase/schema.sql — nothing else below will work');
  else
    execute 'select version from public.schema_meta where id = 1' into v_version;
    insert into _report values (1, 'schema version', coalesce(v_version, 'unknown'),
      case when v_version is null then 're-run supabase/schema.sql' else 'ok' end);
  end if;

  -- 2. tables
  v_missing := '{}';
  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is null then v_missing := v_missing || v_name; end if;
  end loop;
  insert into _report values (2, 'tables present',
    (array_length(v_tables,1) - coalesce(array_length(v_missing,1),0))::text || ' of ' || array_length(v_tables,1)::text,
    case when coalesce(array_length(v_missing,1),0) = 0 then 'ok'
         else 'MISSING: ' || array_to_string(v_missing, ', ') || ' — re-run schema.sql' end);

  -- 3. functions
  v_missing := '{}';
  foreach v_name in array v_functions loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_name) then
      v_missing := v_missing || v_name;
    end if;
  end loop;
  insert into _report values (3, 'functions present',
    (array_length(v_functions,1) - coalesce(array_length(v_missing,1),0))::text || ' of ' || array_length(v_functions,1)::text,
    case when coalesce(array_length(v_missing,1),0) = 0 then 'ok'
         else 'MISSING: ' || array_to_string(v_missing, ', ') || ' — your schema is out of date' end);

  -- 4. logins vs the app's own records
  declare v_users bigint := 0; v_accounts bigint := 0; v_members bigint := 0;
  begin
    execute 'select count(*) from auth.users' into v_users;
    if to_regclass('public.accounts') is not null then
      execute 'select count(*) from public.accounts' into v_accounts;
    end if;
    if to_regclass('public.members') is not null then
      execute 'select count(*) from public.members' into v_members;
    end if;
    insert into _report values (4, 'logins vs app records',
      v_users::text || ' logins, ' || v_accounts::text || ' accounts, ' || v_members::text || ' memberships',
      case when v_users = 0 then 'nobody has signed up yet'
           when v_accounts < v_users and exists (select 1 from pg_proc p
                                                   join pg_namespace n on n.oid = p.pronamespace
                                                  where n.nspname='public' and p.proname='ensure_account')
             then 'ok — missing accounts rebuild themselves at next sign-in'
           when v_accounts < v_users
             then 'logins with no account and no ensure_account() — re-run schema.sql'
           else 'ok' end);
  end;

  -- 5. teams
  if to_regclass('public.teams') is not null then
    execute 'select count(*) from public.teams' into v_count;
    insert into _report values (5, 'teams', v_count::text || ' team(s)',
      case when v_count = 0 then 'no team created yet' else 'ok' end);
  end if;

  -- 6. the photo bucket
  if to_regclass('storage.buckets') is null then
    insert into _report values (6, 'photo bucket', 'storage not available', 'unexpected — contact support');
  else
    execute $q$select count(*) from storage.buckets where id = 'task-photos' and public = false$q$ into v_count;
    insert into _report values (6, 'photo bucket',
      case when v_count > 0 then 'private bucket exists' else 'MISSING' end,
      case when v_count > 0 then 'ok'
           else 'Storage → New bucket → name it task-photos, Public OFF' end);
  end if;

  -- 7. the storage rules that let the crew upload
  execute $q$select count(*) from pg_policies
             where schemaname = 'storage' and policyname like 'task_photos%'$q$ into v_count;
  insert into _report values (7, 'photo storage rules', v_count::text || ' of 4',
    case when v_count >= 4 then 'ok'
         else 'add them by hand — SETUP.md, "Photos will not upload"' end);

  -- 8. row level security actually on
  if to_regclass('public.tasks') is not null then
    execute $q$select count(*) from pg_tables
               where schemaname = 'public' and not rowsecurity
                 and tablename in ('teams','accounts','members','blocks','block_items',
                                   'tasks','task_photos','activity')$q$ into v_count;
    insert into _report values (8, 'row level security',
      case when v_count = 0 then 'on for every table' else v_count::text || ' table(s) unprotected' end,
      case when v_count = 0 then 'ok' else 're-run schema.sql' end);
  end if;

  -- 9. who would still see the create-or-join screen
  if to_regclass('public.members') is not null then
    execute $q$select count(*) from public.accounts a
               where not exists (select 1 from public.members m
                                  where m.account_id = a.id and m.status = 'active'
                                    and m.team_id is not null)$q$ into v_count;
    insert into _report values (9, 'accounts with no team', v_count::text,
      case when v_count = 0 then 'everyone is on a team'
           else 'these people land on the create-or-join screen' end);
  end if;
end
$diag$;

select item, result, verdict from _report order by ord;
