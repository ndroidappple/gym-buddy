-- Applied to the ironlog project on 2026-09-28 (migration "nutrition_food_tables").
-- Nutrition tracking: one row per logged food, and the lifter's own saved foods.
-- Rows are written from the app with client-made ids, so an offline retry never duplicates.

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snacks')),
  name text not null check (char_length(name) between 1 and 120),
  brand text check (brand is null or char_length(brand) <= 120),
  amount numeric not null default 1 check (amount > 0 and amount < 100000),
  unit text not null default 'serving' check (char_length(unit) <= 60),
  grams numeric check (grams is null or (grams >= 0 and grams < 100000)),
  kcal numeric not null default 0 check (kcal >= 0 and kcal < 20000),
  protein numeric not null default 0 check (protein >= 0 and protein < 2000),
  carbs numeric not null default 0 check (carbs >= 0 and carbs < 2000),
  fat numeric not null default 0 check (fat >= 0 and fat < 2000),
  source text not null check (source in ('usda', 'off', 'custom', 'quick', 'ai')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 80),
  basis jsonb, -- per-100 g (or per-serving) nutrition and portion sizes, so the amount can be edited later
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_entries_user_date on public.food_entries (user_id, date);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  brand text check (brand is null or char_length(brand) <= 120),
  basis jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index foods_user on public.foods (user_id);

alter table public.food_entries enable row level security;
alter table public.foods enable row level security;

create policy "select own rows" on public.food_entries for select using ((select auth.uid()) = user_id);
create policy "insert own rows" on public.food_entries for insert with check ((select auth.uid()) = user_id);
create policy "update own rows" on public.food_entries for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.food_entries for delete using ((select auth.uid()) = user_id);

create policy "select own rows" on public.foods for select using ((select auth.uid()) = user_id);
create policy "insert own rows" on public.foods for insert with check ((select auth.uid()) = user_id);
create policy "update own rows" on public.foods for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.foods for delete using ((select auth.uid()) = user_id);
