-- API keys: read-only access to one lifter's log for AI apps that can't do the OAuth sign-in
-- (api/mcp.js, api/tools.js). A lifter makes a key in Settings → AI assistants; the app shows it
-- once. Only its SHA-256 is stored.
--
-- The functions api/_lifter.js calls with a key are the gate: each one finds the key's owner and
-- reads only that lifter's rows, the way the own-rows policies do for a signed-in token. The server
-- calls them with the publishable key, so nothing it holds can read anyone else.

create extension if not exists pgcrypto with schema extensions;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  hint text not null, -- the key's last 4 characters, to tell keys apart in the list
  key_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index api_keys_user on public.api_keys (user_id);

alter table public.api_keys enable row level security;
create policy "select own rows" on public.api_keys for select using ((select auth.uid()) = user_id);
create policy "delete own rows" on public.api_keys for delete using ((select auth.uid()) = user_id);

-- Lifters list and delete their keys; only create_api_key makes them; nobody reads a hash.
revoke all on public.api_keys from anon, authenticated;
grant select (id, name, hint, created_at, last_used_at), delete on public.api_keys to authenticated;

/** Makes a key for the signed-in lifter and returns it. The only time it's ever readable. */
create or replace function public.create_api_key(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  k text := 'gbk_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (select count(*) from public.api_keys where user_id = auth.uid()) >= 10 then
    raise exception 'You have 10 keys. Delete one first.' using errcode = 'P0001';
  end if;
  insert into public.api_keys (user_id, name, hint, key_hash)
  values (auth.uid(), left(coalesce(nullif(trim(p_name), ''), 'AI assistant'), 60), right(k, 4), extensions.digest(k, 'sha256'));
  return k;
end $$;
revoke execute on function public.create_api_key(text) from public, anon;
grant execute on function public.create_api_key(text) to authenticated;

/** The key's owner, or null. Notes when it was last used (at most every 10 minutes). Not callable by clients. */
create or replace function public.api_key_owner(p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if p_key is null or p_key !~ '^gbk_[0-9a-f]{48}$' then return null; end if;
  update public.api_keys set last_used_at = now()
  where key_hash = extensions.digest(p_key, 'sha256') and (last_used_at is null or last_used_at < now() - interval '10 minutes')
  returning user_id into u;
  if u is null then select user_id into u from public.api_keys where key_hash = extensions.digest(p_key, 'sha256'); end if;
  return u;
end $$;
revoke execute on function public.api_key_owner(text) from public, anon, authenticated;

/** Who the key belongs to: { name } (first name, or null), or null for a bad key. */
create or replace function public.api_whoami(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public.api_key_owner(p_key);
begin
  if u is null then return null; end if;
  return (select jsonb_build_object('name', raw_user_meta_data ->> 'first_name') from auth.users where id = u);
end $$;

/** The account record or a saved week in review: only those keys, only the key owner's row. */
create or replace function public.api_kv(p_key text, p_kv_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare u uuid := public.api_key_owner(p_key);
begin
  if u is null then raise exception 'bad api key' using errcode = '28000'; end if;
  if p_kv_key <> 'ironlog-v2' and p_kv_key !~ '^week-review:\d{4}-\d{2}-\d{2}$' then return null; end if;
  return (select value from public.storage_kv where user_id = u and key = p_kv_key);
end $$;

/** The key of the owner's latest saved week in review, or null. */
create or replace function public.api_latest_review_key(p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare u uuid := public.api_key_owner(p_key);
begin
  if u is null then raise exception 'bad api key' using errcode = '28000'; end if;
  return (select key from public.storage_kv where user_id = u and key ~ '^week-review:\d{4}-\d{2}-\d{2}$' order by key desc limit 1);
end $$;

/** The owner's food log between two dates (at most 366 days, 5,000 rows). */
create or replace function public.api_food(p_key text, p_start date, p_end date)
returns table (date date, meal text, name text, amount numeric, unit text, kcal numeric, protein numeric, carbs numeric, fat numeric)
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.api_key_owner(p_key);
begin
  if u is null then raise exception 'bad api key' using errcode = '28000'; end if;
  if p_end - p_start > 366 then raise exception 'range too long' using errcode = '22023'; end if;
  return query select e.date, e.meal, e.name, e.amount, e.unit, e.kcal, e.protein, e.carbs, e.fat
    from public.food_entries e where e.user_id = u and e.date between p_start and p_end
    order by e.date, e.id limit 5000;
end $$;

-- The API calls these with the publishable key (role anon), the key itself being the credential.
revoke execute on function public.api_whoami(text), public.api_kv(text, text), public.api_latest_review_key(text), public.api_food(text, date, date) from public;
grant execute on function public.api_whoami(text), public.api_kv(text, text), public.api_latest_review_key(text), public.api_food(text, date, date) to anon, authenticated;
