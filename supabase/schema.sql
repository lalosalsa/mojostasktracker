-- =============================================================================
--  Mojo's Task Tracker — Supabase schema
--
--  Sign-up model:
--    · Everyone signs up with their name, email and a password. No emails are
--      sent at all (turn OFF "Confirm email" in Supabase — see SETUP.md).
--    · A manager then creates a team (a location) and gets two codes to share.
--    · Employees join that team by typing the code.
--    · Coming back later is the same email + password.
--
--  One account can belong to several teams — a manager running three shops has
--  a membership in each and switches between them. Everything else in this file
--  is scoped to whichever one is active, so the rest of the rules are unchanged.
--
--  The work itself is a shared list: the manager names time blocks ("Morning
--  Prep", "Closing") and fills each with tasks. Every morning those become that
--  day's list. Anyone on the crew can pick up any task; whoever finishes it has
--  their name recorded against it along with the photo.
--
--  Run this in Supabase Studio → SQL Editor → New query → Run.
--  Re-runnable. If you ran an older version of this file first, run
--  supabase/reset.sql once before this one.
-- =============================================================================

create extension if not exists "pgcrypto";

-- Which version of this file has been applied. supabase/diagnose.sql reads it.
create table if not exists public.schema_meta (
  id         integer primary key default 1 check (id = 1),
  version    text not null,
  applied_at timestamptz not null default now()
);

-- =============================================================================
--  TABLES
-- =============================================================================

create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  join_code    text not null unique,          -- crew members join with this
  manager_code text not null unique,          -- a second manager joins with this
  created_at   timestamptz not null default now()
);

-- The person, one row per sign-in account. Their memberships live below.
create table if not exists public.accounts (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text not null default '',
  active_team_id uuid references public.teams(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- One membership: this person, on this team. A manager with three locations has
-- three of these. Tasks and photos point at the membership, so each location
-- keeps its own history.
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete set null,
  email        text not null default '',
  name         text not null default '',
  role         text not null default 'employee' check (role in ('employee', 'manager')),
  status       text not null default 'active'
               check (status in ('active', 'disabled', 'removed')),
  job_title    text not null default '',
  phone        text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

-- Upgrade from the one-team-per-account shape without losing anything: back
-- then members.id *was* the auth user id, and everything already points at it,
-- so the row keeps its id and simply gains an account_id.
do $migrate$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'members' and column_name = 'account_id'
  ) then
    alter table public.members add column account_id uuid;

    insert into public.accounts (id, email, name, active_team_id)
    select m.id, m.email, m.name, m.team_id from public.members m
    on conflict (id) do nothing;

    update public.members set account_id = id where account_id is null;

    alter table public.members drop constraint if exists members_id_fkey;
    alter table public.members alter column account_id set not null;
    alter table public.members
      add constraint members_account_id_fkey
      foreign key (account_id) references public.accounts(id) on delete cascade;
  end if;
end
$migrate$;

create index if not exists members_team_idx    on public.members (team_id);
create index if not exists members_account_idx on public.members (account_id);
create unique index if not exists members_one_per_team_idx
  on public.members (account_id, team_id) where team_id is not null;

-- A named part of the working day: "Morning Prep", "Lunch Rush", "Closing".
-- Times are optional — the name is what the crew reads.
create table if not exists public.blocks (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null,
  starts_at  time,
  ends_at    time,
  position   integer not null default 0,
  active     boolean not null default true,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists blocks_team_idx on public.blocks (team_id, position);

-- The standing list of jobs inside a block. Each one becomes a task per day.
create table if not exists public.block_items (
  id             bigint generated always as identity primary key,
  block_id       bigint not null references public.blocks(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  location       text not null default '',
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requires_photo boolean not null default true,
  assigned_to    uuid references public.members(id) on delete set null,   -- optional; usually open to anyone
  weekdays       smallint[],                    -- 0=Sun..6=Sat; null/empty = every day
  position       integer not null default 0,
  active         boolean not null default true,
  created_by     uuid references public.members(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists block_items_block_idx on public.block_items (block_id, position);

create table if not exists public.tasks (
  id             bigint generated always as identity primary key,
  team_id        uuid not null references public.teams(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  location       text not null default '',
  status         text not null default 'open'
                 check (status in ('open', 'in_progress', 'submitted', 'verified', 'rejected')),
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to    uuid references public.members(id) on delete set null,
  created_by     uuid references public.members(id) on delete set null,
  requires_photo boolean not null default true,
  work_date      date not null default current_date,
  due_date       date,
  block_id       bigint references public.blocks(id) on delete set null,
  block_item_id  bigint references public.block_items(id) on delete set null,
  completed_by   uuid references public.members(id) on delete set null,
  notes          text not null default '',
  review_note    text not null default '',
  minutes_spent  integer,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.members(id) on delete set null
);
create index if not exists tasks_team_date_idx     on public.tasks (team_id, work_date desc);
create index if not exists tasks_assigned_date_idx on public.tasks (assigned_to, work_date desc);
create index if not exists tasks_status_idx        on public.tasks (status);

create table if not exists public.task_photos (
  id           bigint generated always as identity primary key,
  task_id      bigint not null references public.tasks(id) on delete cascade,
  member_id    uuid references public.members(id) on delete set null,
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

create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  task_id    bigint references public.tasks(id) on delete cascade,
  actor_id   uuid references public.members(id) on delete set null,
  actor_name text not null default '',
  type       text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activity_team_idx on public.activity (team_id, id desc);

-- =============================================================================
--  RECONCILE
--  "create table if not exists" skips a table that already exists, so a project
--  set up against an earlier version keeps the old columns, defaults and checks
--  and then fails at runtime. Everything below is idempotent and brings an older
--  project up to the current shape without touching its data.
-- =============================================================================

do $reconcile$
begin
  -- members.id used to BE the auth user id, so it had no default of its own.
  -- Without this an insert sends null and the row is rejected.
  alter table public.members alter column id set default gen_random_uuid();
  alter table public.members alter column email set default '';
  alter table public.members alter column name set default '';

  alter table public.members  add column if not exists account_id    uuid;
  alter table public.members  add column if not exists job_title     text not null default '';
  alter table public.members  add column if not exists phone         text not null default '';
  alter table public.members  add column if not exists last_seen_at  timestamptz;

  alter table public.tasks    add column if not exists block_id      bigint;
  alter table public.tasks    add column if not exists block_item_id bigint;
  alter table public.tasks    add column if not exists completed_by  uuid;
  alter table public.tasks    add column if not exists minutes_spent integer;
  alter table public.tasks    add column if not exists review_note   text not null default '';

  alter table public.block_items add column if not exists weekdays   smallint[];
  alter table public.block_items add column if not exists assigned_to uuid;

  alter table public.task_photos add column if not exists member_id  uuid;
  alter table public.task_photos add column if not exists thumb_path text;
  alter table public.task_photos add column if not exists caption    text not null default '';

  -- the very first version called this column user_id
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'task_photos' and column_name = 'user_id')
  then
    update public.task_photos set member_id = user_id where member_id is null;
  end if;

  -- status gained 'removed' after the first release
  alter table public.members drop constraint if exists members_status_check;
  alter table public.members add  constraint members_status_check
    check (status in ('active', 'disabled', 'removed'));

  -- and roles were once called admin/employee
  update public.members set role = 'manager' where role = 'admin';
  alter table public.members drop constraint if exists members_role_check;
  alter table public.members add  constraint members_role_check
    check (role in ('employee', 'manager'));
exception when undefined_table then
  null;   -- a brand-new project: the create statements above already got it right
end
$reconcile$;

-- Auto-numbered ids: after an upgrade, a restore from backup, or any import
-- that supplied ids explicitly, the counter can sit behind the rows already
-- there and the next insert collides. Nudge each one past the highest id.
do $sequences$
declare
  v_table text;
  v_seq   text;
  v_max   bigint;
begin
  foreach v_table in array array['tasks', 'block_items', 'blocks', 'task_photos', 'activity'] loop
    if to_regclass('public.' || v_table) is null then continue; end if;
    v_seq := pg_get_serial_sequence('public.' || v_table, 'id');
    if v_seq is null then continue; end if;
    execute format('select coalesce(max(id), 0) from public.%I', v_table) into v_max;
    perform setval(v_seq, v_max + 1, false);
  end loop;
end
$sequences$;

-- Indexes that depend on the columns above, so they run only once those exist.
create unique index if not exists tasks_block_item_day_idx
  on public.tasks (block_item_id, work_date) where block_item_id is not null;
create index if not exists tasks_block_idx on public.tasks (block_id);

-- Foreign keys for the columns just added, each only if it isn't there yet.
do $fks$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_block_id_fkey') then
    alter table public.tasks add constraint tasks_block_id_fkey
      foreign key (block_id) references public.blocks(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_block_item_id_fkey') then
    alter table public.tasks add constraint tasks_block_item_id_fkey
      foreign key (block_item_id) references public.block_items(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_completed_by_fkey') then
    alter table public.tasks add constraint tasks_completed_by_fkey
      foreign key (completed_by) references public.members(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'task_photos_member_id_fkey') then
    alter table public.task_photos add constraint task_photos_member_id_fkey
      foreign key (member_id) references public.members(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'block_items_assigned_to_fkey') then
    alter table public.block_items add constraint block_items_assigned_to_fkey
      foreign key (assigned_to) references public.members(id) on delete set null;
  end if;
exception when undefined_table or undefined_column then
  null;
end
$fks$;

-- =============================================================================
--  WHO AM I
-- =============================================================================

/** Short human-friendly code. Skips characters people misread (0/O, 1/I/L). */
create or replace function public.gen_code(p_len integer default 6)
returns text language plpgsql volatile as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
begin
  for _ in 1..p_len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

/** Codes are typed by hand, so accept spaces, dashes and lower case. */
create or replace function public.normalize_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

/** The membership this session is working through — the active team's one. */
create or replace function public.my_membership()
returns public.members language sql stable security definer set search_path = public as $$
  select m.* from public.members m
    join public.accounts a on a.id = m.account_id
   where m.account_id = auth.uid()
     and m.status = 'active'
     and m.team_id is not null
     and m.team_id = a.active_team_id
   limit 1;
$$;

create or replace function public.me()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.my_membership();
$$;

create or replace function public.my_team()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.my_membership();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.my_membership()) = 'manager', false);
$$;

/** True for a manager, and for server-side work with no JWT at all (the SQL
    editor, the service_role key) so a manager's manual fix-ups still apply. */
create or replace function public.acts_as_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null or public.is_manager();
$$;

create or replace function public.my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(m.name, ''), nullif(a.name, ''), a.email, 'Someone')
    from public.accounts a
    left join public.members m on m.id = public.me()
   where a.id = auth.uid();
$$;

-- =============================================================================
--  SIGN UP / TEAMS / SWITCHING BETWEEN THEM
--  Signing up creates the account. Teams are joined or created afterwards, and
--  one account can hold several — the active one decides what the app shows.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (id, email, name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      initcap(replace(replace(split_part(new.email, '@', 1), '.', ' '), '_', ' '))
    )
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/**
 * Makes sure the signed-in user has an account row, creating it from auth.users
 * if it is missing. The signup trigger normally does this, but anyone who
 * signed up before this schema — or before a reset.sql that cleared the app
 * tables while Supabase kept the login — would otherwise be stuck with an
 * account the app cannot see.
 */
create or replace function public.ensure_account()
returns public.accounts language plpgsql security definer set search_path = public as $$
declare v_account public.accounts;
begin
  if auth.uid() is null then return null; end if;

  select * into v_account from public.accounts where id = auth.uid();
  if found then return v_account; end if;

  insert into public.accounts (id, email, name)
  select u.id,
         lower(u.email),
         coalesce(
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           initcap(replace(replace(split_part(u.email, '@', 1), '.', ' '), '_', ' '))
         )
    from auth.users u
   where u.id = auth.uid()
  on conflict (id) do nothing;

  select * into v_account from public.accounts where id = auth.uid();
  return v_account;
end $$;

/** Every team this account belongs to, for the switcher. */
create or replace function public.my_teams()
returns table (
  team_id uuid, name text, role text, is_active boolean,
  join_code text, manager_code text, crew_count bigint
) language sql stable security definer set search_path = public as $$
  select t.id, t.name, m.role, t.id = a.active_team_id,
         case when m.role = 'manager' then t.join_code end,
         case when m.role = 'manager' then t.manager_code end,
         (select count(*) from public.members x
           where x.team_id = t.id and x.status = 'active')
    from public.members m
    join public.teams t   on t.id = m.team_id
    join public.accounts a on a.id = m.account_id
   where m.account_id = auth.uid() and m.status = 'active'
   order by t.name;
$$;

/** Whoever is signed in, which team they're looking at, and what else they run. */
create or replace function public.whoami()
returns json language plpgsql security definer set search_path = public as $$
declare
  v_account public.accounts;
  v_member  public.members;
  v_team    public.teams;
begin
  v_account := public.ensure_account();
  if v_account.id is null then return null; end if;

  -- fall back to any team they belong to if none is marked active
  if v_account.active_team_id is null then
    update public.accounts set active_team_id = (
      select m.team_id from public.members m
       where m.account_id = auth.uid() and m.status = 'active' and m.team_id is not null
       order by m.created_at limit 1
    ) where id = auth.uid()
    returning * into v_account;
  end if;

  select * into v_member from public.my_membership();
  if found then
    update public.members set last_seen_at = now() where id = v_member.id;
    select * into v_team from public.teams where id = v_member.team_id;
  end if;

  return json_build_object(
    'account', row_to_json(v_account),
    'member',  case when v_member.id is null then null else row_to_json(v_member) end,
    'team',    case when v_team.id   is null then null else row_to_json(v_team)   end,
    'teams',   coalesce((select json_agg(t) from public.my_teams() t), '[]'::json)
  );
end $$;

/** Keeps the name consistent everywhere this person works. */
create or replace function public.set_my_name(p_name text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_account();
  if coalesce(trim(p_name), '') = '' then return public.whoami(); end if;

  update public.accounts set name = left(trim(p_name), 80) where id = auth.uid();

  perform set_config('app.member_guard_bypass', '1', true);
  update public.members set name = left(trim(p_name), 80) where account_id = auth.uid();
  perform set_config('app.member_guard_bypass', '0', true);

  return public.whoami();
end $$;

/** Point this session at one of the teams they belong to. */
create or replace function public.switch_team(p_team_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.members
     where account_id = auth.uid() and team_id = p_team_id and status = 'active'
  ) then
    raise exception 'You are not on that team';
  end if;
  update public.accounts set active_team_id = p_team_id where id = auth.uid();
  return public.whoami();
end $$;

/**
 * Start a team. A manager running several locations calls this once per
 * location; the new one becomes the active team.
 *
 * Who may: anyone with no team yet (that is how you become a manager in the
 * first place), and anyone already managing a team. A crew member cannot spin
 * up locations — they join with the code their manager gives them.
 */
create or replace function public.create_team(p_team_name text, p_your_name text default '')
returns json language plpgsql security definer set search_path = public as $$
declare
  v_team    public.teams;
  v_account public.accounts;
  v_member  public.members;
begin
  v_account := public.ensure_account();
  if v_account.id is null then raise exception 'Finish signing up first'; end if;
  if coalesce(trim(p_team_name), '') = '' then raise exception 'Give your team a name'; end if;

  if exists (select 1 from public.members
              where account_id = auth.uid() and status = 'active' and team_id is not null)
     and not exists (select 1 from public.members
                      where account_id = auth.uid() and status = 'active' and role = 'manager')
  then
    raise exception 'Only managers can start a team. Ask your manager for a code to join theirs.';
  end if;

  loop
    begin
      insert into public.teams (name, join_code, manager_code)
      values (left(trim(p_team_name), 80), public.gen_code(6), public.gen_code(6))
      returning * into v_team;
      exit;
    exception when unique_violation then
      -- astronomically unlikely; draw again
    end;
  end loop;

  insert into public.members (account_id, team_id, email, name, role, status, job_title)
  values (auth.uid(), v_team.id, v_account.email,
          coalesce(nullif(trim(p_your_name), ''), nullif(v_account.name, ''),
                   split_part(v_account.email, '@', 1)),
          'manager', 'active', 'Manager')
  returning * into v_member;

  update public.accounts set active_team_id = v_team.id where id = auth.uid();

  insert into public.activity (team_id, actor_id, actor_name, type, detail)
  values (v_team.id, v_member.id, v_member.name, 'team.created', v_team.name);

  return public.whoami();
end $$;

/** Join a team with the code its manager shared. Adds a membership; any teams
    already joined are untouched. */
create or replace function public.join_team(p_code text, p_your_name text default '')
returns json language plpgsql security definer set search_path = public as $$
declare
  v_code    text := public.normalize_code(p_code);
  v_team    public.teams;
  v_role    text;
  v_account public.accounts;
  v_member  public.members;
begin
  v_account := public.ensure_account();
  if v_account.id is null then raise exception 'Finish signing up first'; end if;

  select * into v_team from public.teams
   where join_code = v_code or manager_code = v_code;
  if not found then
    raise exception 'That team code does not match any team. Check it with your manager.'
      using errcode = 'no_data_found';
  end if;
  v_role := case when v_team.manager_code = v_code then 'manager' else 'employee' end;

  select * into v_member from public.members
   where account_id = auth.uid() and team_id = v_team.id;

  if found then
    if v_member.status = 'removed' then
      perform set_config('app.member_guard_bypass', '1', true);
      update public.members set status = 'active', role = v_role
       where id = v_member.id returning * into v_member;
      perform set_config('app.member_guard_bypass', '0', true);
    end if;
  else
    insert into public.members (account_id, team_id, email, name, role, status)
    values (auth.uid(), v_team.id, v_account.email,
            coalesce(nullif(trim(p_your_name), ''), nullif(v_account.name, ''),
                     split_part(v_account.email, '@', 1)),
            v_role, 'active')
    returning * into v_member;

    insert into public.activity (team_id, actor_id, actor_name, type, detail)
    values (v_team.id, v_member.id, v_member.name, 'member.joined', v_member.name);
  end if;

  update public.accounts set active_team_id = v_team.id where id = auth.uid();
  return public.whoami();
end $$;

/** Step away from the team you're currently looking at. */
create or replace function public.leave_team()
returns json language plpgsql security definer set search_path = public as $$
declare v_team uuid := public.my_team(); v_member uuid := public.me();
begin
  if v_team is null then return public.whoami(); end if;
  if public.is_manager() and (
       select count(*) from public.members
        where team_id = v_team and role = 'manager' and status = 'active') <= 1 then
    raise exception 'You are the only manager. Make someone else a manager first.';
  end if;

  -- marked, not deleted: tasks and photos point at this membership, so deleting
  -- it would wipe the manager's record of who did what
  perform set_config('app.member_guard_bypass', '1', true);
  update public.members set status = 'removed' where id = v_member;
  perform set_config('app.member_guard_bypass', '0', true);

  update public.tasks set assigned_to = null
   where assigned_to = v_member and status in ('open', 'in_progress', 'rejected');

  update public.accounts set active_team_id = (
    select m.team_id from public.members m
     where m.account_id = auth.uid() and m.status = 'active' and m.team_id is not null
     order by m.created_at limit 1
  ) where id = auth.uid();

  return public.whoami();
end $$;

/** Managers can print a fresh team code if the old one got out. */
create or replace function public.rotate_team_code(p_which text default 'join')
returns json language plpgsql security definer set search_path = public as $$
declare v_team public.teams;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  if p_which = 'manager' then
    update public.teams set manager_code = public.gen_code(6)
     where id = public.my_team() returning * into v_team;
  else
    update public.teams set join_code = public.gen_code(6)
     where id = public.my_team() returning * into v_team;
  end if;
  return row_to_json(v_team);
end $$;

create or replace function public.rename_team(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare v_team public.teams;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  update public.teams set name = left(trim(p_name), 80)
   where id = public.my_team() and coalesce(trim(p_name), '') <> ''
   returning * into v_team;
  return row_to_json(v_team);
end $$;

/** Take someone off this team. Their finished work and photos stay, so the
    manager keeps the history; the person loses access to this location only —
    any other team they belong to is untouched. */
create or replace function public.remove_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  if p_member_id = public.me() then raise exception 'You cannot remove yourself'; end if;
  if not exists (select 1 from public.members
                  where id = p_member_id and team_id = public.my_team()) then
    raise exception 'That person is not on your team';
  end if;

  perform set_config('app.member_guard_bypass', '1', true);
  update public.members set status = 'removed', role = 'employee' where id = p_member_id;
  perform set_config('app.member_guard_bypass', '0', true);

  -- anything they hadn't finished goes back to the shared list
  update public.tasks set assigned_to = null
   where assigned_to = p_member_id and status in ('open', 'in_progress', 'rejected');
end $$;

/** Put someone back on the team after they were removed. */
create or replace function public.restore_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  perform set_config('app.member_guard_bypass', '1', true);
  update public.members set status = 'active'
   where id = p_member_id and team_id = public.my_team();
  perform set_config('app.member_guard_bypass', '0', true);
end $$;

-- =============================================================================
--  TASK RULES (enforced in the database, not just the UI)
-- =============================================================================

create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.team_id    := coalesce(new.team_id, public.my_team());
  new.created_by := coalesce(new.created_by, public.me());
  if new.team_id is null then raise exception 'You are not on a team yet'; end if;

  if not public.acts_as_manager() then
    new.assigned_to := coalesce(new.assigned_to, public.me());
    if new.assigned_to <> public.me() then
      raise exception 'Only a manager can assign work to someone else';
    end if;
    if new.status in ('verified', 'rejected') then new.status := 'open'; end if;
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
  if new.status = 'submitted' and old.status is distinct from 'submitted' and new.requires_photo then
    select count(*) into v_photos from public.task_photos where task_id = new.id;
    if v_photos = 0 then
      raise exception 'Add at least one photo of the finished work before marking this task done'
        using errcode = 'check_violation';
    end if;
  end if;

  new.team_id := old.team_id;

  if not public.acts_as_manager() then
    if new.status in ('verified', 'rejected') and old.status is distinct from new.status then
      raise exception 'Only a manager can review a task';
    end if;
    new.review_note    := old.review_note;
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.requires_photo := old.requires_photo;
    new.created_by     := old.created_by;
    if old.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
      raise exception 'Only a manager can reassign a task';
    end if;
    new.assigned_to := coalesce(new.assigned_to, public.me());
  elsif new.status in ('verified', 'rejected') and old.status is distinct from new.status then
    new.reviewed_at := now();
    new.reviewed_by := public.me();
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
    new.completed_by := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_insert_trg on public.tasks;
create trigger tasks_before_insert_trg before insert on public.tasks
  for each row execute function public.tasks_before_insert();

drop trigger if exists tasks_before_update_trg on public.tasks;
create trigger tasks_before_update_trg before update on public.tasks
  for each row execute function public.tasks_before_update();

/** The join/create/leave RPCs set this for the length of their statement, so
    the guard below doesn't undo the one update that puts you on a team. */
create or replace function public.guard_bypassed()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.member_guard_bypass', true), '') = '1';
$$;

create or replace function public.members_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.acts_as_manager() or public.guard_bypassed()) then
    new.role    := old.role;
    new.status  := old.status;
    new.team_id := old.team_id;
    new.email   := old.email;
  end if;
  return new;
end $$;
drop trigger if exists members_guard_trg on public.members;
create trigger members_guard_trg before update on public.members
  for each row execute function public.members_guard();

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

  insert into public.activity (team_id, task_id, actor_id, actor_name, type, detail)
  values (new.team_id, new.id, public.me(), public.my_name(), v_type, new.title);
  return new;
end $$;

drop trigger if exists tasks_activity_trg on public.tasks;
create trigger tasks_activity_trg after insert or update on public.tasks
  for each row execute function public.log_task_activity();

create or replace function public.log_photo_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (team_id, task_id, actor_id, actor_name, type, detail)
  select t.team_id, new.task_id, public.me(), public.my_name(), 'photo.added', t.title
    from public.tasks t where t.id = new.task_id;

  update public.tasks
     set status = 'in_progress', started_at = coalesce(started_at, now())
   where id = new.task_id and status = 'open';
  return new;
end $$;

drop trigger if exists photos_activity_trg on public.task_photos;
create trigger photos_activity_trg after insert on public.task_photos
  for each row execute function public.log_photo_activity();

-- =============================================================================
--  ROW LEVEL SECURITY — everything is scoped to your own team
-- =============================================================================

alter table public.accounts       enable row level security;
alter table public.teams          enable row level security;
alter table public.members        enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_photos    enable row level security;
alter table public.blocks         enable row level security;
alter table public.block_items    enable row level security;
alter table public.activity       enable row level security;

-- accounts: only ever your own
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
  using (id = auth.uid());

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- teams: any team you belong to. Codes change only through the RPCs above.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (exists (
    select 1 from public.members m
     where m.team_id = public.teams.id and m.account_id = auth.uid() and m.status = 'active'
  ));

-- members
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (account_id = auth.uid() or (team_id is not null and team_id = public.my_team()));

drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated
  using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists members_manager on public.members;
create policy members_manager on public.members for all to authenticated
  using (public.is_manager() and team_id = public.my_team())
  with check (public.is_manager() and team_id = public.my_team());

-- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    team_id = public.my_team()
    and (public.is_manager() or assigned_to = public.me() or assigned_to is null or created_by = public.me())
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (team_id = public.my_team());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (team_id = public.my_team()
         and (public.is_manager() or assigned_to = public.me() or assigned_to is null))
  with check (team_id = public.my_team());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (team_id = public.my_team()
         and (public.is_manager() or (created_by = public.me() and status <> 'verified')));

-- photos
-- Must stay at least as wide as photos_insert below: the app inserts a photo
-- and asks for the row back, and that RETURNING is checked against this policy.
-- A shared task is unassigned, so leaving that case out here made every crew
-- upload fail with "violates row-level security".
drop policy if exists photos_select on public.task_photos;
create policy photos_select on public.task_photos for select to authenticated
  using (
    task_photos.member_id = public.me()
    or exists (
      select 1 from public.tasks t
       where t.id = task_photos.task_id and t.team_id = public.my_team()
         and (public.is_manager()
              or t.assigned_to = public.me()
              or t.assigned_to is null
              or t.created_by = public.me())
    )
  );

drop policy if exists photos_insert on public.task_photos;
create policy photos_insert on public.task_photos for insert to authenticated
  with check (
    task_photos.member_id = public.me()
    and exists (
      select 1 from public.tasks t
       where t.id = task_photos.task_id and t.team_id = public.my_team()
         and t.status <> 'verified'
         and (public.is_manager() or t.assigned_to = public.me() or t.assigned_to is null)
    )
  );

drop policy if exists photos_update on public.task_photos;
create policy photos_update on public.task_photos for update to authenticated
  using (task_photos.member_id = public.me() or public.is_manager())
  with check (task_photos.member_id = public.me() or public.is_manager());

drop policy if exists photos_delete on public.task_photos;
create policy photos_delete on public.task_photos for delete to authenticated
  using (
    exists (select 1 from public.tasks t
             where t.id = task_photos.task_id and t.team_id = public.my_team())
    and (public.is_manager()
         or (task_photos.member_id = public.me()
             and exists (select 1 from public.tasks t
                          where t.id = task_photos.task_id and t.status <> 'verified')))
  );

-- blocks and their standing items: everyone reads the day's plan, managers edit
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select to authenticated
  using (team_id = public.my_team());

drop policy if exists blocks_manager on public.blocks;
create policy blocks_manager on public.blocks for all to authenticated
  using (public.is_manager() and team_id = public.my_team())
  with check (public.is_manager() and team_id = public.my_team());

drop policy if exists block_items_select on public.block_items;
create policy block_items_select on public.block_items for select to authenticated
  using (team_id = public.my_team());

drop policy if exists block_items_manager on public.block_items;
create policy block_items_manager on public.block_items for all to authenticated
  using (public.is_manager() and team_id = public.my_team())
  with check (public.is_manager() and team_id = public.my_team());

-- activity
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (team_id = public.my_team() and (public.is_manager() or actor_id = public.me()));

-- =============================================================================
--  RPCs used by the app
-- =============================================================================

/**
 * Builds today's shared list from the blocks. A task set to particular weekdays
 * only appears on those days. Idempotent — safe on every load, and safe after
 * the manager edits a block mid-day (it only adds what's new). Tasks come out
 * unassigned: anyone on the crew can pick one up.
 */
create or replace function public.ensure_todays_tasks(p_date date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; v_team uuid := public.my_team();
begin
  if v_team is null then return 0; end if;

  with inserted as (
    insert into public.tasks (team_id, title, description, location, priority, requires_photo,
                              assigned_to, created_by, work_date, due_date,
                              block_id, block_item_id, status)
    select i.team_id, i.title, i.description, i.location, i.priority, i.requires_photo,
           i.assigned_to, i.created_by, p_date, p_date, i.block_id, i.id, 'open'
      from public.block_items i
      join public.blocks b on b.id = i.block_id
     where i.active and b.active and i.team_id = v_team
       and (
         i.weekdays is null
         or array_length(i.weekdays, 1) is null
         or extract(dow from p_date)::smallint = any (i.weekdays)
       )
       and not exists (
         select 1 from public.tasks t where t.block_item_id = i.id and t.work_date = p_date
       )
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $$;

create or replace function public.complete_task(
  p_task_id bigint,
  p_notes   text default '',
  p_minutes integer default null
) returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if v_task.team_id <> public.my_team() then raise exception 'That task belongs to another team'; end if;
  if not (public.is_manager() or v_task.assigned_to = public.me() or v_task.assigned_to is null) then
    raise exception 'That task belongs to a teammate';
  end if;

  update public.tasks
     set status        = 'submitted',
         assigned_to   = coalesce(assigned_to, public.me()),
         completed_by  = public.me(),          -- whose name goes on the finished job
         notes         = coalesce(nullif(p_notes, ''), notes),
         minutes_spent = coalesce(p_minutes, minutes_spent),
         review_note   = ''
   where id = p_task_id
   returning * into v_task;

  return v_task;
end $$;

create or replace function public.employee_day_stats(p_date date default current_date)
returns table (
  id uuid, name text, job_title text, last_seen_at timestamptz,
  assigned bigint, completed bigint, remaining bigint, awaiting_review bigint, photos bigint,
  last_completed_at timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.job_title, p.last_seen_at,
         count(t.id) filter (where t.id is not null)                                as assigned,
         count(t.id) filter (where t.status in ('submitted', 'verified'))           as completed,
         count(t.id) filter (where t.status in ('open', 'in_progress', 'rejected')) as remaining,
         count(t.id) filter (where t.status = 'submitted')                          as awaiting_review,
         (select count(*) from public.task_photos ph
            join public.tasks t2 on t2.id = ph.task_id
           where ph.member_id = p.id and t2.work_date = p_date)                     as photos,
         max(t.completed_at)                                                        as last_completed_at
    from public.members p
    left join public.tasks t on t.assigned_to = p.id and t.work_date = p_date
   where p.status = 'active' and p.team_id = public.my_team() and public.is_manager()
   group by p.id
   order by completed desc, p.name;
$$;

create or replace function public.daily_trend(p_from date, p_to date)
returns table (day date, total bigint, completed bigint)
language sql stable security definer set search_path = public as $$
  select d::date as day,
         count(t.id) as total,
         count(t.id) filter (where t.status in ('submitted', 'verified')) as completed
    from generate_series(p_from, p_to, interval '1 day') d
    left join public.tasks t on t.work_date = d::date and t.team_id = public.my_team()
   where public.is_manager()
   group by d
   order by d;
$$;

create or replace function public.range_stats(p_from date, p_to date, p_member uuid default null)
returns table (total bigint, open bigint, submitted bigint, verified bigint, rejected bigint,
               completed bigint, photos bigint)
language sql stable security definer set search_path = public as $$
  select count(*)                                                    as total,
         count(*) filter (where status in ('open', 'in_progress'))   as open,
         count(*) filter (where status = 'submitted')                as submitted,
         count(*) filter (where status = 'verified')                 as verified,
         count(*) filter (where status = 'rejected')                 as rejected,
         count(*) filter (where status in ('submitted', 'verified')) as completed,
         (select count(*) from public.task_photos ph
            join public.tasks t2 on t2.id = ph.task_id
           where t2.team_id = public.my_team()
             and t2.work_date between p_from and p_to
             and (p_member is null or t2.assigned_to = p_member)
             and (public.is_manager() or t2.assigned_to = public.me()))  as photos
    from public.tasks t
   where t.team_id = public.my_team()
     and t.work_date between p_from and p_to
     and (p_member is null or t.assigned_to = p_member)
     and (public.is_manager() or t.assigned_to = public.me());
$$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.members set last_seen_at = now() where id = public.me();
$$;

-- =============================================================================
--  GRANTS — RLS decides what each row lets you do; these open the doors.
-- =============================================================================

grant usage on schema public to anon, authenticated;
grant select, update on public.accounts to authenticated;
grant select, insert, update, delete on
  public.tasks, public.task_photos, public.members,
  public.blocks, public.block_items to authenticated;
grant select on public.teams, public.activity to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

grant execute on function public.whoami()                              to authenticated;
grant execute on function public.set_my_name(text)                     to authenticated;
grant execute on function public.ensure_account()                      to authenticated;
grant execute on function public.my_teams()                            to authenticated;
grant execute on function public.my_membership()                       to authenticated;
grant execute on function public.switch_team(uuid)                     to authenticated;
grant execute on function public.create_team(text, text)               to authenticated;
grant execute on function public.join_team(text, text)                 to authenticated;
grant execute on function public.leave_team()                          to authenticated;
grant execute on function public.rotate_team_code(text)                to authenticated;
grant execute on function public.rename_team(text)                     to authenticated;
grant execute on function public.me()                                  to authenticated;
grant execute on function public.my_team()                             to authenticated;
grant execute on function public.is_manager()                          to authenticated;
grant execute on function public.acts_as_manager()                     to authenticated;
grant execute on function public.guard_bypassed()                      to authenticated;
grant execute on function public.ensure_todays_tasks(date)             to authenticated;
grant execute on function public.complete_task(bigint, text, integer)  to authenticated;
grant execute on function public.employee_day_stats(date)              to authenticated;
grant execute on function public.daily_trend(date, date)               to authenticated;
grant execute on function public.range_stats(date, date, uuid)         to authenticated;
grant execute on function public.touch_last_seen()                     to authenticated;
grant execute on function public.remove_member(uuid)                   to authenticated;
grant execute on function public.restore_member(uuid)                  to authenticated;

-- =============================================================================
--  STORAGE — private bucket for the photo proof
--  Files live at  <member-id>/<task-id>/<file>
--
--  On a hosted project storage.objects belongs to supabase_storage_admin, and
--  depending on how old the project is, the SQL editor may not be allowed to
--  touch it. The whole block is therefore wrapped so a privilege error prints
--  instructions instead of aborting the rest of this file.
-- =============================================================================

do $storage$
begin
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('task-photos', 'task-photos', false, 15728640,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  exception when insufficient_privilege then
    raise notice 'Could not create the task-photos bucket from SQL. Create it by hand: Storage -> New bucket -> name "task-photos", Public OFF.';
  end;

  begin
    execute 'drop policy if exists task_photos_insert on storage.objects';
    execute $p$
      create policy task_photos_insert on storage.objects for insert to authenticated
        with check (
          bucket_id = 'task-photos'
          and (storage.foldername(storage.objects.name))[1] = public.me()::text
        )$p$;

    execute 'drop policy if exists task_photos_select on storage.objects';
    execute $p$
      create policy task_photos_select on storage.objects for select to authenticated
        using (
          bucket_id = 'task-photos'
          and (
            (storage.foldername(storage.objects.name))[1] = public.me()::text
            or (
              public.is_manager()
              and exists (
                select 1 from public.members m
                 where m.id::text = (storage.foldername(storage.objects.name))[1]
                   and m.team_id = public.my_team()
              )
            )
          )
        )$p$;

    execute 'drop policy if exists task_photos_update on storage.objects';
    execute $p$
      create policy task_photos_update on storage.objects for update to authenticated
        using (
          bucket_id = 'task-photos'
          and (storage.foldername(storage.objects.name))[1] = public.me()::text
        )$p$;

    execute 'drop policy if exists task_photos_delete on storage.objects';
    execute $p$
      create policy task_photos_delete on storage.objects for delete to authenticated
        using (
          bucket_id = 'task-photos'
          and (
            (storage.foldername(storage.objects.name))[1] = public.me()::text
            or (
              public.is_manager()
              and exists (
                select 1 from public.members m
                 where m.id::text = (storage.foldername(storage.objects.name))[1]
                   and m.team_id = public.my_team()
              )
            )
          )
        )$p$;
  exception when insufficient_privilege then
    raise notice 'Could not create the storage policies from SQL (storage.objects is owned by supabase_storage_admin on this project). See SETUP.md - "Photos will not upload" - for the four policies to add under Storage -> Policies.';
  end;
end
$storage$;

-- =============================================================================
--  REALTIME — so a change on one phone shows up on the others
--  Every table the app watches has to be in the publication, and needs full
--  replica identity or a delete event arrives without the row, which means it
--  cannot be matched against the team filter.
-- =============================================================================
do $realtime$
declare
  v_table text;
begin
  foreach v_table in array array['tasks', 'activity', 'blocks', 'block_items',
                                 'members', 'task_photos'] loop
    if to_regclass('public.' || v_table) is null then continue; end if;

    execute format('alter table public.%I replica identity full', v_table);

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      exception when undefined_object then
        raise notice 'No supabase_realtime publication on this project — live updates will fall back to polling.';
      when insufficient_privilege then
        raise notice 'Could not add % to the realtime publication; live updates fall back to polling.', v_table;
      end;
    end if;
  end loop;
end
$realtime$;

insert into public.schema_meta (id, version, applied_at)
values (1, '2026.08.25-b', now())
on conflict (id) do update set version = excluded.version, applied_at = now();

grant select on public.schema_meta to authenticated;
