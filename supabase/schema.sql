-- Haiduc database setup.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Then add the people allowed in at the bottom of this file (or later with the same INSERT).

create table if not exists public.members (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  title text not null default 'Untitled',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.tasks (
  id text primary key,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due date,
  note_id text references public.notes(id) on delete set null,
  assignee text,
  created_at timestamptz not null default now(),
  created_by text
);

-- Is the signed-in person on the members list?
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email'));
$$;

alter table public.members enable row level security;
alter table public.notes   enable row level security;
alter table public.tasks   enable row level security;

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using (public.is_member());

drop policy if exists "notes all" on public.notes;
create policy "notes all" on public.notes for all to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists "tasks all" on public.tasks;
create policy "tasks all" on public.tasks for all to authenticated using (public.is_member()) with check (public.is_member());

-- Live updates between people
do $$ begin
  begin alter publication supabase_realtime add table public.notes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end;
end $$;

-- Welcome note
insert into public.notes (id, title, body) values
('welcome', 'Welcome', E'This is Haiduc, your shared notes. Everyone on the members list sees the same notes and tasks, live.\n\n## How it works\n- Press **+ Note** to create a note, then **Edit** to write in Markdown.\n- Link notes with double brackets, like [[Ideas]]. A dashed link means the note doesn''t exist yet. Click it to create it.\n- The right panel shows **backlinks**: every note that links to the one you''re reading.\n- Open **Tasks** for a simple board. Drag cards or use the arrows.\n\n- [ ] Write a first note\n- [ ] Invite someone\n\nShortcuts: Ctrl/Cmd + E toggles Edit/Read, Ctrl/Cmd + S saves now.')
on conflict (id) do nothing;

-- People allowed in (edit these emails):
insert into public.members (email) values
  ('you@example.com'),
  ('friend@example.com')
on conflict do nothing;
