-- Head coach chat: the conversation with the lifter's head coach, and what the coach remembers.
-- Written from the app with client-made ids (like food_entries), so an offline retry never duplicates.
-- Messages are kept 30 days; the memory is how anything older carries forward.

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  coach text not null check (coach in ('tank', 'wings', 'boulder', 'piston', 'brick', 'dash')), -- who said it
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  meta jsonb check (meta is null or pg_column_size(meta) <= 8000), -- a proposal shown with the reply, and whether it was applied
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_messages_user_created on public.coach_messages (user_id, created_at);

-- One row per lifter: short notes the coach keeps between conversations (injuries, schedule,
-- preferences). The lifter can read and delete them in Settings.
create table public.coach_memory (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) <= 20 and pg_column_size(notes) <= 4000),
  updated_at timestamptz not null default now()
);

alter table public.coach_messages enable row level security;
alter table public.coach_memory enable row level security;

create policy "select own rows" on public.coach_messages for select using ((select auth.uid()) = user_id);
create policy "insert own rows" on public.coach_messages for insert with check ((select auth.uid()) = user_id);
create policy "update own rows" on public.coach_messages for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.coach_messages for delete using ((select auth.uid()) = user_id);

create policy "select own rows" on public.coach_memory for select using ((select auth.uid()) = user_id);
create policy "insert own rows" on public.coach_memory for insert with check ((select auth.uid()) = user_id);
create policy "update own rows" on public.coach_memory for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.coach_memory for delete using ((select auth.uid()) = user_id);

-- Every night, messages older than 30 days go (pg_cron is already on for rest alerts).
select cron.schedule('coach-messages-30d', '17 3 * * *', $$delete from public.coach_messages where created_at < now() - interval '30 days'$$);
