-- Daily food totals before a date, for the head coach's month-by-month view of the whole history.
-- The app loads the last 120 days of entries in full; older days only need their totals.
-- security invoker: it runs as the signed-in lifter, so food_entries' own-rows policy applies and
-- each lifter only ever sees their own days.

create or replace function public.food_daily_totals(p_before date)
returns table (date date, kcal numeric, protein numeric, entries integer)
language sql stable security invoker set search_path = '' as $$
  select e.date, round(sum(e.kcal)), round(sum(e.protein)), count(*)::integer
  from public.food_entries e
  where e.date < p_before
  group by e.date
  order by e.date
$$;

revoke execute on function public.food_daily_totals(date) from public, anon;
grant execute on function public.food_daily_totals(date) to authenticated;
