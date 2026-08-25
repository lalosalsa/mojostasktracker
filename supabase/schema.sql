-- =============================================================================
--  Mojo's Task Tracker — Supabase schema
--  Run this once in Supabase Studio → SQL Editor → New query → Run.
--  Safe to re-run: everything is create-if-not-exists / create-or-replace.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
--  TABLES
-- =============================================================================

-- Everyone who can sign in. Row is created automatically by a trigger on signup.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         text not null default 'employee' check (role in ('employee', 'admin')),
  status       text not null default 'pending'  check (status in ('active', 'pending', 'disabled')),
  job_title    text not null default '',
  phone        text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

-- Emails a manager has pre-approved: they skip the waiting room on first sign-in.
create table if not exists public.invites (
  email      text primary key,
  role       text not null default 'employee' check (role in ('employee', 'admin')),
  full_name  text not null default '',
  job_title  text not null default '',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Recurring checklist items; these spawn a fresh task each work day.
create table if not exists public.task_templates (
  id             bigint generated always as identity primary key,
  title          text not null,
  description    text not null default '',
  location       text not null default '',
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requires_photo boolean not null default true,
  assigned_to    uuid references public.profiles(id) on delete set null,
  recurrence     text not null default 'daily' check (recurrence in ('daily', 'weekdays', 'weekly')),
  weekday        smallint check (weekday between 0 and 6),   -- 0 = Sunday
  active         boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.tasks (
  id             bigint generated always as identity primary key,
  title          text not null,
  description    text not null default '',
  location       text not null default '',
  status         text not null default 'open'
                 check (status in ('open', 'in_progress', 'submitted', 'verified', 'rejected')),
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to    uuid references public.profiles(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  requires_photo boolean not null default true,
  work_date      date not null default current_date,
  due_date       date,
  template_id    bigint references public.task_templates(id) on delete set null,
  notes          text not null default '',
  review_note    text not null default '',
  minutes_spent  integer,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles(id) on delete set null
);

create index if not exists tasks_assigned_date_idx on public.tasks (assigned_to, work_date desc);
create index if not exists tasks_status_idx        on public.tasks (status);
create index if not exists tasks_work_date_idx     on public.tasks (work_date desc);
create unique index if not exists tasks_template_day_idx
  on public.tasks (template_id, work_date) where template_id is not null;

-- Photo proof. The file itself lives in the `task-photos` storage bucket.
create table if not exists public.task_photos (
  id           bigint generated always as identity primary key,
  task_id      bigint not null references public.tasks(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  storage_path text not null,
  thumb_path   text,
  mime         text not null default 'image/jpeg',
  bytes        integer not null default 0,
  width        integer,
  height       integer,
  caption      text not null default '',
  latitude     double precision,
  longitude    double precision,
  taken_at     timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists task_photos_task_idx on public.task_photos (task_id);

-- Audit trail shown in the manager's activity feed.
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  task_id    bigint references public.tasks(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  type       text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity (created_at desc);

-- =============================================================================
--  HELPERS
-- =============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- True for a manager *and* for server-side work that carries no JWT at all
-- (the Supabase SQL editor, the service_role key, scheduled jobs). Without this
-- the guard triggers below would silently undo a manager's manual fix-ups.
create or replace function public.acts_as_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null or public.is_admin();
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email, 'Someone') from public.profiles where id = auth.uid();
$$;

-- =============================================================================
--  SIGN-UP HANDLING
--  First person to sign in becomes the manager. Invited emails are activated
--  straight away. Everyone else lands in the waiting room until approved.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role    text := 'employee';
  v_status  text := 'pending';
  v_name    text;
  v_title   text := '';
  v_invite  public.invites%rowtype;
begin
  if not exists (select 1 from public.profiles) then
    v_role   := 'admin';
    v_status := 'active';
  else
    select * into v_invite from public.invites where lower(email) = lower(new.email) limit 1;
    if found then
      v_role   := v_invite.role;
      v_status := 'active';
      v_title  := v_invite.job_title;
    end if;
  end if;

  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(v_invite.full_name, ''),
    initcap(replace(replace(split_part(new.email, '@', 1), '.', ' '), '_', ' '))
  );

  insert into public.profiles (id, email, full_name, role, status, job_title)
  values (new.id, lower(new.email), v_name, v_role, v_status, coalesce(v_title, ''))
  on conflict (id) do update set email = excluded.email;

  delete from public.invites where lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
--  TASK RULES (enforced in the database, not just the UI)
-- =============================================================================

create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if not public.acts_as_admin() then
    -- employees may only create work for themselves, and cannot self-verify
    new.assigned_to := coalesce(new.assigned_to, auth.uid());
    if new.assigned_to <> auth.uid() then
      raise exception 'Only a manager can assign work to someone else';
    end if;
    if new.status in ('verified', 'rejected') then
      new.status := 'open';
    end if;
    new.review_note := '';
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end $$;

create or replace function public.tasks_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_photos integer;
begin
  -- a task can only be marked done once its photo proof is attached
  if new.status = 'submitted' and old.status is distinct from 'submitted' and new.requires_photo then
    select count(*) into v_photos from public.task_photos where task_id = new.id;
    if v_photos = 0 then
      raise exception 'Add at least one photo of the finished work before marking this task done'
        using errcode = 'check_violation';
    end if;
  end if;

  if not public.acts_as_admin() then
    -- managers own the review fields; employees cannot touch them
    if new.status in ('verified', 'rejected') and old.status is distinct from new.status then
      raise exception 'Only a manager can review a task';
    end if;
    new.review_note  := old.review_note;
    new.reviewed_at  := old.reviewed_at;
    new.reviewed_by  := old.reviewed_by;
    new.requires_photo := old.requires_photo;
    new.created_by   := old.created_by;
    if old.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
      raise exception 'Only a manager can reassign a task';
    end if;
    new.assigned_to := coalesce(new.assigned_to, auth.uid());
  else
    if new.status in ('verified', 'rejected') and old.status is distinct from new.status then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    end if;
  end if;

  if new.status = 'in_progress' and old.status = 'open' then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.completed_at := coalesce(new.completed_at, now());
    new.started_at   := coalesce(new.started_at, now());
  end if;
  if new.status in ('open', 'in_progress') and old.status in ('submitted', 'verified', 'rejected') then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_insert_trg on public.tasks;
create trigger tasks_before_insert_trg before insert on public.tasks
  for each row execute function public.tasks_before_insert();

drop trigger if exists tasks_before_update_trg on public.tasks;
create trigger tasks_before_update_trg before update on public.tasks
  for each row execute function public.tasks_before_update();

-- Activity feed --------------------------------------------------------------

create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'task.created';
  elsif new.status is distinct from old.status then
    v_type := case new.status
                when 'in_progress' then 'task.started'
                when 'submitted'   then 'task.completed'
                when 'verified'    then 'task.verified'
                when 'rejected'    then 'task.rejected'
                else 'task.reopened' end;
  else
    return new;
  end if;

  insert into public.activity (task_id, actor_id, actor_name, type, detail)
  values (new.id, auth.uid(), public.my_name(), v_type, new.title);
  return new;
end $$;

drop trigger if exists tasks_activity_trg on public.tasks;
create trigger tasks_activity_trg after insert or update on public.tasks
  for each row execute function public.log_task_activity();

create or replace function public.log_photo_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (task_id, actor_id, actor_name, type, detail)
  select new.task_id, auth.uid(), public.my_name(), 'photo.added', t.title
    from public.tasks t where t.id = new.task_id;

  -- a photo means work has started
  update public.tasks
     set status = 'in_progress', started_at = coalesce(started_at, now())
   where id = new.task_id and status = 'open';
  return new;
end $$;

drop trigger if exists photos_activity_trg on public.task_photos;
create trigger photos_activity_trg after insert on public.task_photos
  for each row execute function public.log_photo_activity();

-- =============================================================================
--  ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles       enable row level security;
alter table public.invites        enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_photos    enable row level security;
alter table public.task_templates enable row level security;
alter table public.activity       enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or (public.is_active() and status = 'active'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Employees must not be able to promote themselves.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.acts_as_admin() then
    new.role   := old.role;
    new.status := old.status;
    new.email  := old.email;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- invites --------------------------------------------------------------------
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tasks ----------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_admin()
    or (public.is_active() and (assigned_to = auth.uid() or assigned_to is null or created_by = auth.uid()))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_admin() or public.is_active());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_admin() or (public.is_active() and (assigned_to = auth.uid() or assigned_to is null)))
  with check (public.is_admin() or (public.is_active() and (assigned_to = auth.uid() or assigned_to is null)));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status <> 'verified'));

-- task_photos ----------------------------------------------------------------
drop policy if exists photos_select on public.task_photos;
create policy photos_select on public.task_photos for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = task_id and (t.assigned_to = auth.uid() or t.created_by = auth.uid()))
  );

drop policy if exists photos_insert on public.task_photos;
create policy photos_insert on public.task_photos for insert to authenticated
  with check (
    user_id = auth.uid() and (
      public.is_admin()
      or exists (select 1 from public.tasks t
                  where t.id = task_id
                    and t.status <> 'verified'
                    and (t.assigned_to = auth.uid() or t.assigned_to is null))
    )
  );

drop policy if exists photos_update on public.task_photos;
create policy photos_update on public.task_photos for update to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists photos_delete on public.task_photos;
create policy photos_delete on public.task_photos for delete to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid()
        and exists (select 1 from public.tasks t where t.id = task_id and t.status <> 'verified'))
  );

-- task_templates -------------------------------------------------------------
drop policy if exists templates_select on public.task_templates;
create policy templates_select on public.task_templates for select to authenticated
  using (public.is_active());

drop policy if exists templates_admin on public.task_templates;
create policy templates_admin on public.task_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- activity -------------------------------------------------------------------
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (public.is_admin() or actor_id = auth.uid());

-- =============================================================================
--  RPCs used by the app
-- =============================================================================

-- Rolls today's recurring checklist out. Idempotent — safe to call on every load.
create or replace function public.ensure_todays_tasks(p_date date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if not public.is_active() then
    return 0;
  end if;

  with due as (
    select t.* from public.task_templates t
     where t.active
       and (
         t.recurrence = 'daily'
         or (t.recurrence = 'weekdays' and extract(isodow from p_date) between 1 and 5)
         or (t.recurrence = 'weekly' and extract(dow from p_date) = coalesce(t.weekday, 1))
       )
  ), inserted as (
    insert into public.tasks (title, description, location, priority, requires_photo,
                              assigned_to, created_by, work_date, due_date, template_id, status)
    select d.title, d.description, d.location, d.priority, d.requires_photo,
           d.assigned_to, d.created_by, p_date, p_date, d.id, 'open'
      from due d
     where not exists (
       select 1 from public.tasks x where x.template_id = d.id and x.work_date = p_date
     )
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $$;

-- Marks a task done. The photo rule lives in the trigger, so this is safe to
-- call from the phone even if someone tampers with the client.
create or replace function public.complete_task(
  p_task_id bigint,
  p_notes   text default '',
  p_minutes integer default null
) returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if not (public.is_admin() or (public.is_active() and (v_task.assigned_to = auth.uid() or v_task.assigned_to is null))) then
    raise exception 'That task belongs to a teammate';
  end if;

  update public.tasks
     set status        = 'submitted',
         assigned_to   = coalesce(assigned_to, auth.uid()),
         notes         = coalesce(nullif(p_notes, ''), notes),
         minutes_spent = coalesce(p_minutes, minutes_spent),
         review_note   = ''
   where id = p_task_id
   returning * into v_task;

  return v_task;
end $$;

-- Per-employee scoreboard for a single day.
create or replace function public.employee_day_stats(p_date date default current_date)
returns table (
  id uuid, full_name text, email text, job_title text, last_seen_at timestamptz,
  assigned bigint, completed bigint, remaining bigint, awaiting_review bigint, photos bigint,
  last_completed_at timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.job_title, p.last_seen_at,
         count(t.id) filter (where t.id is not null)                                   as assigned,
         count(t.id) filter (where t.status in ('submitted', 'verified'))              as completed,
         count(t.id) filter (where t.status in ('open', 'in_progress', 'rejected'))    as remaining,
         count(t.id) filter (where t.status = 'submitted')                             as awaiting_review,
         (select count(*) from public.task_photos ph
            join public.tasks t2 on t2.id = ph.task_id
           where ph.user_id = p.id and t2.work_date = p_date)                          as photos,
         max(t.completed_at)                                                           as last_completed_at
    from public.profiles p
    left join public.tasks t on t.assigned_to = p.id and t.work_date = p_date
   where p.status = 'active' and p.role = 'employee' and public.is_admin()
   group by p.id
   order by completed desc, p.full_name;
$$;

-- Completed-vs-total per day, for the dashboard trend bars.
create or replace function public.daily_trend(p_from date, p_to date)
returns table (day date, total bigint, completed bigint)
language sql stable security definer set search_path = public as $$
  select d::date as day,
         count(t.id) as total,
         count(t.id) filter (where t.status in ('submitted', 'verified')) as completed
    from generate_series(p_from, p_to, interval '1 day') d
    left join public.tasks t on t.work_date = d::date
   where public.is_admin()
   group by d
   order by d;
$$;

-- Totals for a date range, optionally for one person.
create or replace function public.range_stats(p_from date, p_to date, p_user uuid default null)
returns table (total bigint, open bigint, submitted bigint, verified bigint, rejected bigint,
               completed bigint, photos bigint)
language sql stable security definer set search_path = public as $$
  select count(*)                                                            as total,
         count(*) filter (where status in ('open', 'in_progress'))           as open,
         count(*) filter (where status = 'submitted')                        as submitted,
         count(*) filter (where status = 'verified')                         as verified,
         count(*) filter (where status = 'rejected')                         as rejected,
         count(*) filter (where status in ('submitted', 'verified'))         as completed,
         (select count(*) from public.task_photos ph join public.tasks t2 on t2.id = ph.task_id
           where t2.work_date between p_from and p_to
             and (p_user is null or t2.assigned_to = p_user)
             and (public.is_admin() or t2.assigned_to = auth.uid()))         as photos
    from public.tasks t
   where t.work_date between p_from and p_to
     and (p_user is null or t.assigned_to = p_user)
     and (public.is_admin() or t.assigned_to = auth.uid());
$$;

-- Heartbeat so the manager can see who is out working.
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

grant execute on function public.acts_as_admin()                      to authenticated;
grant execute on function public.ensure_todays_tasks(date)            to authenticated;
grant execute on function public.complete_task(bigint, text, integer) to authenticated;
grant execute on function public.employee_day_stats(date)             to authenticated;
grant execute on function public.daily_trend(date, date)              to authenticated;
grant execute on function public.range_stats(date, date, uuid)        to authenticated;
grant execute on function public.touch_last_seen()                    to authenticated;

-- =============================================================================
--  GRANTS
--  RLS decides what each row lets you do; these just open the doors.
-- =============================================================================

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.tasks, public.task_photos, public.task_templates, public.invites
  to authenticated;
grant select on public.activity to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- =============================================================================
--  STORAGE — private bucket for the photo proof
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as  <user-id>/<task-id>/<uuid>.jpg
drop policy if exists task_photos_insert on storage.objects;
create policy task_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-photos'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists task_photos_select on storage.objects;
create policy task_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'task-photos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists task_photos_delete on storage.objects;
create policy task_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-photos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- =============================================================================
--  REALTIME (live dashboard updates)
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity'
  ) then
    alter publication supabase_realtime add table public.activity;
  end if;
end $$;
