-- Applied to the ironlog project on 2026-10-09 (migration "week_review_schedule"). Uses the rest alerts' Vault secrets.
-- Week in review on a schedule: each lifter's review is written at their review day and hour (in
-- their time zone) and, if they want, a push notification says it's ready.
--   1. The app keeps one row per lifter in week_review_schedule (on/off, day, hour, time zone,
--      notify). A trigger works out next_at, the next time it's due.
--   2. Every 5 minutes, pg_cron posts each due lifter to api/review.js (a Vercel Function) and moves
--      next_at on a week. The URL and shared secret are the rest alerts' (Vault: rest_alert_url,
--      with /api/rest-alert swapped for /api/review, and rest_alert_secret).
--   3. That request has no sign-in, so the function reads the lifter's data and saves the review
--      through review_job_input / review_job_save, which only work with the shared secret.

create table public.week_review_schedule (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  notify boolean not null default true,
  day smallint not null default 0 check (day between 0 and 6), -- 0 = Sunday
  hour smallint not null default 10 check (hour between 0 and 23),
  tz text not null default 'UTC' check (char_length(tz) <= 64),
  next_at timestamptz,
  fired_at timestamptz,
  updated_at timestamptz not null default now()
);
create index week_review_schedule_due on public.week_review_schedule (next_at) where enabled;

alter table public.week_review_schedule enable row level security;
create policy "select own row" on public.week_review_schedule for select using ((select auth.uid()) = user_id);
create policy "insert own row" on public.week_review_schedule for insert with check ((select auth.uid()) = user_id);
create policy "update own row" on public.week_review_schedule for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own row" on public.week_review_schedule for delete using ((select auth.uid()) = user_id);
-- The app sets the schedule; only the database sets when it's next due.
revoke all on public.week_review_schedule from anon, authenticated;
grant select, delete on public.week_review_schedule to authenticated;
grant insert (user_id, enabled, notify, day, hour, tz), update (user_id, enabled, notify, day, hour, tz) on public.week_review_schedule to authenticated;

/** The first review day + hour strictly after p_after, as wall-clock time in p_tz (DST included). */
create function public.next_review_at(p_day int, p_hour int, p_tz text, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_after at time zone p_tz;
  v_at timestamp := (v_local::date + ((p_day - extract(dow from v_local)::int + 7) % 7)) + make_interval(hours => p_hour);
begin
  if v_at <= v_local then v_at := v_at + interval '7 days'; end if;
  return v_at at time zone p_tz;
end $$;

create function public.week_review_schedule_set()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then new.tz := 'UTC'; end if;
  if tg_op = 'INSERT' or (new.enabled, new.day, new.hour, new.tz) is distinct from (old.enabled, old.day, old.hour, old.tz) then
    -- Looking back 15 minutes, a change made just after the hour still catches this week's review.
    new.next_at := public.next_review_at(new.day, new.hour, new.tz, now() - interval '15 minutes');
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger week_review_schedule_set before insert or update on public.week_review_schedule
  for each row execute function public.week_review_schedule_set();

/** Posts every due lifter to the review function, one request each (a review takes up to a minute). */
create function public.dispatch_week_reviews()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  r record;
begin
  if not exists (select 1 from public.week_review_schedule where enabled and next_at <= now()) then return; end if;
  select regexp_replace(decrypted_secret, '/api/rest-alert/?$', '/api/review') into v_url from vault.decrypted_secrets where name = 'rest_alert_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'rest_alert_secret';
  if v_url is null or v_secret is null or v_url !~ '/api/review$' then return; end if;
  for r in
    select s.user_id, s.notify, s.tz, s.next_at, (s.next_at at time zone s.tz)::date - 1 as week_end
    from public.week_review_schedule s where s.enabled and s.next_at <= now()
    for update skip locked
  loop
    update public.week_review_schedule
      set next_at = public.next_review_at(day, hour, tz, greatest(now(), r.next_at)), fired_at = now()
      where user_id = r.user_id;
    -- Hours late (the job was down): skip it. The app still offers the review when it's opened.
    if r.next_at > now() - interval '6 hours' then
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('job', jsonb_build_object('userId', r.user_id, 'weekEnd', r.week_end, 'tz', r.tz, 'notify', r.notify)),
        headers := jsonb_build_object('content-type', 'application/json', 'x-review-secret', v_secret),
        timeout_milliseconds := 180000
      );
    end if;
  end loop;
end $$;

create function public.review_job_allowed(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_secret is not null and length(p_secret) >= 16
    and p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'rest_alert_secret');
$$;

/** What a scheduled review needs about one lifter: their account, food (8 weeks), phones, and any review already saved. */
create function public.review_job_input(p_secret text, p_user uuid, p_week_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'account', (select value from public.storage_kv where user_id = p_user and key = 'ironlog-v2'),
    'review', (select value from public.storage_kv where user_id = p_user and key = 'week-review:' || to_char(p_week_end, 'YYYY-MM-DD')),
    'pending', (select value from public.storage_kv where user_id = p_user and key = 'week-review-pending:' || to_char(p_week_end, 'YYYY-MM-DD')),
    'food', coalesce((
      select jsonb_agg(jsonb_build_object('date', date, 'meal', meal, 'name', name, 'amount', amount, 'unit', unit,
        'kcal', kcal, 'protein', protein, 'carbs', carbs, 'fat', fat) order by date, id)
      from public.food_entries where user_id = p_user and date between p_week_end - 55 and p_week_end), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
      from public.push_subscriptions where user_id = p_user), '[]'::jsonb)
  );
end $$;

/** Saves (or, with a null value, removes) a lifter's review or its "being written" marker. Nothing else. */
create function public.review_job_save(p_secret text, p_user uuid, p_key text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.review_job_allowed(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key !~ '^week-review(-pending)?:\d{4}-\d{2}-\d{2}$' then raise exception 'bad key' using errcode = '22023'; end if;
  if p_value is null then
    delete from public.storage_kv where user_id = p_user and key = p_key;
  else
    insert into public.storage_kv (user_id, key, value, updated_at) values (p_user, p_key, p_value, now())
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end $$;

revoke execute on function public.dispatch_week_reviews() from public, anon, authenticated;
revoke execute on function public.review_job_allowed(text) from public, anon, authenticated;
revoke execute on function public.review_job_input(text, uuid, date) from public, authenticated;
revoke execute on function public.review_job_save(text, uuid, text, text) from public, authenticated;
-- The function calls these with the project's public key and no sign-in; the secret is the lock.
grant execute on function public.review_job_input(text, uuid, date) to anon;
grant execute on function public.review_job_save(text, uuid, text, text) to anon;

select cron.schedule('week-reviews', '*/5 * * * *', 'select public.dispatch_week_reviews()');
