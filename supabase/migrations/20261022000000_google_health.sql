-- Applied to the ironlog project on 2026-10-22 (migration "google_health"). Uses the rest alerts' Vault secret.
-- Google Health sync (api/google-health.js).
--   1. google_health_links: one row per lifter who connected Google Health. `token` is Google's
--      refresh token, encrypted by the server before it gets here (AES-GCM, with a key only the
--      Vercel Functions have), so the database never holds it in the clear. No policies: the app
--      can't read or change it; only the functions below can, and only with the shared secret.
--      The OAuth callback has no sign-in, which is why these go through the secret too.
--   2. google_health_synced: which of the lifter's workouts, weigh-ins and food entries are in
--      Google Health, and under which data point name. Own rows only, like the food tables.

create table public.google_health_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null check (char_length(token) <= 4000),
  scopes text not null default '' check (char_length(scopes) <= 1000),
  since date not null, -- the day they connected: nothing logged before it is sent
  connected_at timestamptz not null default now(),
  synced_at timestamptz,
  error text check (error is null or char_length(error) <= 300)
);
alter table public.google_health_links enable row level security;
revoke all on public.google_health_links from anon, authenticated;

create table public.google_health_synced (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item text not null check (char_length(item) <= 80), -- w:<session id> | bw:<date> | f:<food entry id>
  name text not null check (char_length(name) <= 200), -- users/me/dataTypes/<type>/dataPoints/<id>
  primary key (user_id, item)
);
alter table public.google_health_synced enable row level security;
create policy "select own rows" on public.google_health_synced for select using ((select auth.uid()) = user_id);
create policy "insert own rows" on public.google_health_synced for insert with check ((select auth.uid()) = user_id);
create policy "update own rows" on public.google_health_synced for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.google_health_synced for delete using ((select auth.uid()) = user_id);

/* Connected (or connected again): a new link starts a fresh record of what was sent. */
create function public.google_health_link_save(p_secret text, p_user uuid, p_token text, p_scopes text, p_since date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.google_health_synced where user_id = p_user;
  insert into public.google_health_links (user_id, token, scopes, since)
  values (p_user, p_token, coalesce(p_scopes, ''), p_since)
  on conflict (user_id) do update set token = excluded.token, scopes = excluded.scopes, since = excluded.since,
    connected_at = now(), synced_at = null, error = null;
end $$;

/* The link, or null when they haven't connected. */
create function public.google_health_link_get(p_secret text, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select jsonb_build_object('token', token, 'scopes', scopes, 'since', since, 'syncedAt', synced_at, 'error', error)
    from public.google_health_links where user_id = p_user);
end $$;

/* After a sync: when it went through, or what went wrong. */
create function public.google_health_link_note(p_secret text, p_user uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.google_health_links
  set synced_at = case when p_error is null then now() else synced_at end, error = left(p_error, 300)
  where user_id = p_user;
end $$;

/* Disconnected: the link and the record of what was sent go. What's in Google Health stays there. */
create function public.google_health_link_delete(p_secret text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.google_health_synced where user_id = p_user;
  delete from public.google_health_links where user_id = p_user;
end $$;

revoke execute on function public.google_health_link_save(text, uuid, text, text, date) from public, authenticated;
revoke execute on function public.google_health_link_get(text, uuid) from public, authenticated;
revoke execute on function public.google_health_link_note(text, uuid, text) from public, authenticated;
revoke execute on function public.google_health_link_delete(text, uuid) from public, authenticated;
-- The functions call these with the project's public key; the secret is the lock.
grant execute on function public.google_health_link_save(text, uuid, text, text, date) to anon;
grant execute on function public.google_health_link_get(text, uuid) to anon;
grant execute on function public.google_health_link_note(text, uuid, text) to anon;
grant execute on function public.google_health_link_delete(text, uuid) to anon;
