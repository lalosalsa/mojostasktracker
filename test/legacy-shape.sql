-- The shape a project had under the previous release, before accounts and
-- memberships were split. Applying the current schema.sql on top of this must
-- upgrade it in place — that is what test/upgrade-test.sql then exercises.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  manager_code text not null unique,
  created_at timestamptz not null default now());

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,   -- no default
  team_id uuid references public.teams(id) on delete set null,
  email text not null,
  name text not null default '',
  role text not null default 'employee' check (role in ('employee','manager')),
  status text not null default 'active' check (status in ('active','disabled')),
  job_title text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz);

create table public.blocks (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null, starts_at time, ends_at time,
  position integer not null default 0, active boolean not null default true,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now());

create table public.block_items (
  id bigint generated always as identity primary key,
  block_id bigint not null references public.blocks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null, description text not null default '',
  location text not null default '',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  requires_photo boolean not null default true,
  position integer not null default 0, active boolean not null default true,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now());

create table public.tasks (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null, description text not null default '',
  location text not null default '',
  status text not null default 'open'
    check (status in ('open','in_progress','submitted','verified','rejected')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.members(id) on delete set null,
  created_by uuid references public.members(id) on delete set null,
  requires_photo boolean not null default true,
  work_date date not null default current_date, due_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz, completed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.members(id) on delete set null);

create table public.task_photos (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  user_id uuid,                                   -- was renamed to member_id
  storage_path text not null, mime text not null default 'image/jpeg',
  bytes integer not null default 0, width integer, height integer,
  latitude double precision, longitude double precision,
  taken_at timestamptz, created_at timestamptz not null default now());

create table public.activity (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  task_id bigint references public.tasks(id) on delete cascade,
  actor_id uuid references public.members(id) on delete set null,
  actor_name text not null default '', type text not null,
  detail text not null default '', created_at timestamptz not null default now());
