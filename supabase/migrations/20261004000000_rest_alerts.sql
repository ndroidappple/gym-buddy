-- Rest alerts: a push notification when a rest timer ends, so it arrives with the phone locked.
-- A web app can't schedule a notification on the phone, so the server sends it:
--   1. The app saves this phone's push address (save_push_subscription) once alerts are on.
--   2. Each rest timer schedules one alert for that phone (schedule_rest_alert); +15/−15 moves it,
--      Skip/Finish/Discard cancel it (cancel_rest_alert).
--   3. Every 2 seconds, pg_cron hands the alerts that are due to api/rest-alert.js (a Vercel
--      Function), which signs and sends the pushes. Its URL and shared secret live in Vault:
--        select vault.create_secret('https://<app>/api/rest-alert', 'rest_alert_url');
--        select vault.create_secret('<same value as REST_ALERT_SECRET in Vercel>', 'rest_alert_secret');
-- The tables have no policies: the app reaches them only through the functions below, which act
-- for the signed-in user. A phone belongs to whoever signed in on it last.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.push_subscriptions (
  endpoint text primary key check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- At most one pending alert per phone: a new rest replaces the last one.
create table public.rest_alerts (
  endpoint text primary key references public.push_subscriptions(endpoint) on delete cascade,
  due_at timestamptz not null,
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 200),
  url text not null check (char_length(url) <= 200)
);
create index rest_alerts_due on public.rest_alerts (due_at);

alter table public.push_subscriptions enable row level security;
alter table public.rest_alerts enable row level security;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create function public.forget_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- False when this phone isn't saved for the signed-in user (the app saves it again and retries).
create function public.schedule_rest_alert(p_endpoint text, p_seconds int, p_title text, p_body text, p_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()) then return false; end if;
  insert into public.rest_alerts (endpoint, due_at, title, body, url)
  values (p_endpoint, now() + make_interval(secs => least(greatest(p_seconds, 1), 3600)), p_title, p_body, p_url)
  on conflict (endpoint) do update set due_at = excluded.due_at, title = excluded.title, body = excluded.body, url = excluded.url;
  return true;
end $$;

create function public.cancel_rest_alert(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.rest_alerts a using public.push_subscriptions s
  where a.endpoint = p_endpoint and s.endpoint = a.endpoint and s.user_id = auth.uid();
$$;

-- Takes the alerts that are due (1 s early, to cover delivery) and posts them to the push sender.
-- An alert more than a minute late (the job was down) is dropped rather than sent stale.
create function public.dispatch_rest_alerts()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_batch jsonb;
begin
  if not exists (select 1 from public.rest_alerts where due_at <= now() + interval '1 second') then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'rest_alert_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'rest_alert_secret';
  if v_url is null or v_secret is null then return; end if;
  with due as (
    delete from public.rest_alerts a using public.push_subscriptions s
    where s.endpoint = a.endpoint and a.due_at <= now() + interval '1 second'
    returning s.endpoint, s.p256dh, s.auth, a.title, a.body, a.url, a.due_at
  )
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth, 'title', title, 'body', body, 'url', url))
  into v_batch from due where due_at > now() - interval '1 minute';
  if v_batch is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('alerts', v_batch),
    headers := jsonb_build_object('content-type', 'application/json', 'x-rest-alert-secret', v_secret),
    timeout_milliseconds := 10000
  );
end $$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.forget_push_subscription(text) from public, anon;
revoke execute on function public.schedule_rest_alert(text, int, text, text, text) from public, anon;
revoke execute on function public.cancel_rest_alert(text) from public, anon;
revoke execute on function public.dispatch_rest_alerts() from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.forget_push_subscription(text) to authenticated;
grant execute on function public.schedule_rest_alert(text, int, text, text, text) to authenticated;
grant execute on function public.cancel_rest_alert(text) to authenticated;

select cron.schedule('rest-alerts', '2 seconds', 'select public.dispatch_rest_alerts()');
-- Running every 2 seconds logs 43,000 runs a day: keep an hour of them.
select cron.schedule('rest-alerts-log-cleanup', '7 * * * *',
  $$delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'rest-alerts') and end_time < now() - interval '1 hour'$$);
