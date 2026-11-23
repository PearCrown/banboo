create schema bamboo_analytics;
revoke all on schema bamboo_analytics from public, anon, authenticated;
grant usage on schema bamboo_analytics to anon, authenticated;

create table bamboo_analytics.started (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);
insert into bamboo_analytics.started default values;

create table bamboo_analytics.page_visits (
  day date not null,
  page text not null check (page in ('home','volunteer','blind','lowvis','review')),
  browser_id uuid not null,
  views bigint not null default 1,
  last_seen timestamptz not null default now(),
  primary key (day, page, browser_id)
);
alter table bamboo_analytics.page_visits enable row level security;
alter table bamboo_analytics.started enable row level security;
revoke all on all tables in schema bamboo_analytics from public, anon, authenticated;

create function bamboo_analytics.record_visit(p_page text, p_browser uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into bamboo_analytics.page_visits as visits (day, page, browser_id)
  values ((now() at time zone 'Asia/Shanghai')::date, p_page, p_browser)
  on conflict (day, page, browser_id) do update
    set views = visits.views + 1, last_seen = now()
    where visits.last_seen <= now() - interval '10 seconds';
$$;
revoke all on function bamboo_analytics.record_visit(text, uuid) from public, anon, authenticated;
grant execute on function bamboo_analytics.record_visit(text, uuid) to anon, authenticated;

create function public.bamboo_record_visit(p_page text, p_browser uuid)
returns void
language sql security invoker set search_path = ''
as $$ select bamboo_analytics.record_visit(p_page, p_browser); $$;
revoke all on function public.bamboo_record_visit(text, uuid) from public, anon, authenticated;
grant execute on function public.bamboo_record_visit(text, uuid) to anon, authenticated;

create function bamboo_analytics.usage_snapshot(p_days integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Shanghai')::date;
  first_day date;
  start_time timestamptz;
  first_tracking_day date;
  result jsonb;
begin
  if not bamboo_private.is_route_reviewer() then
    raise exception 'Reviewer access required' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30) then
    raise exception 'Choose 7 or 30 days' using errcode = '22023';
  end if;
  first_day := today - (p_days - 1);
  start_time := first_day::timestamp at time zone 'Asia/Shanghai';
  select (started_at at time zone 'Asia/Shanghai')::date into first_tracking_day
    from bamboo_analytics.started;

  with visits as (
    select day, page, browser_id, views
    from bamboo_analytics.page_visits
    where day between first_day and today
  ), route_totals as (
    select count(*) as total,
           count(*) filter (where status = 'pending') as pending,
           count(*) filter (where status = 'approved' and audio_path is not null) as approved_audio,
           count(*) filter (where status = 'rejected') as rejected,
           count(*) filter (where created_at >= start_time) as submissions,
           count(distinct owner_id) filter (where created_at >= start_time) as submitters
    from public.route_marks
  ), accounts as (
    select count(*) as verified,
           count(*) filter (where u.email_confirmed_at >= start_time) as new_verified
    from auth.users u
    where u.email_confirmed_at is not null
      and not exists (
        select 1 from bamboo_private.route_reviewers r where r.email = lower(u.email)
      )
  ), calendar as (
    select first_day + i as day from generate_series(0, p_days - 1) as series(i)
  ), visit_days as (
    select day, sum(views) as views from visits group by day
  ), submission_days as (
    select (created_at at time zone 'Asia/Shanghai')::date as day, count(*) as submissions
    from public.route_marks where created_at >= start_time group by 1
  ), page_names as (
    select unnest(array['home','volunteer','blind','lowvis','review']) as page
  )
  select jsonb_build_object(
    'tracking_start', first_tracking_day,
    'generated_at', now(),
    'routes', (select to_jsonb(r) from route_totals r),
    'accounts', (select to_jsonb(a) from accounts a),
    'traffic', (
      select jsonb_build_object(
        'views', coalesce(sum(views),0),
        'visitors', count(distinct browser_id),
        'trial_browsers', count(distinct browser_id) filter (where page in ('volunteer','blind','lowvis'))
      ) from visits
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', c.day,
        'views', case when c.day >= first_tracking_day then coalesce(v.views,0) end,
        'submissions', coalesce(s.submissions,0)
      ) order by c.day)
      from calendar c left join visit_days v using (day) left join submission_days s using (day)
    ),
    'pages', (
      select jsonb_object_agg(p.page, coalesce(numbers.views,0))
      from page_names p left join (select page,sum(views) views from visits group by page) numbers using (page)
    )
  ) into result;
  return result;
end;
$$;
revoke all on function bamboo_analytics.usage_snapshot(integer) from public, anon, authenticated;
grant execute on function bamboo_analytics.usage_snapshot(integer) to authenticated;

create function public.bamboo_usage_snapshot(p_days integer)
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select bamboo_analytics.usage_snapshot(p_days); $$;
revoke all on function public.bamboo_usage_snapshot(integer) from public, anon, authenticated;
grant execute on function public.bamboo_usage_snapshot(integer) to authenticated;
