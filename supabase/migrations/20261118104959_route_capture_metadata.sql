alter table public.route_marks
  add column latitude double precision,
  add column longitude double precision,
  add column audio_seconds integer,
  add constraint route_marks_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude is not null and latitude between -90 and 90
        and longitude is not null and longitude between -180 and 180)
  ),
  add constraint route_marks_audio_seconds_check check (audio_seconds between 1 and 180),
  drop constraint route_marks_path_status_check,
  add constraint route_marks_path_status_check
    check (path_status in ('unknown', 'ok', 'cleared', 'blocked', 'broken'));

grant select (latitude, longitude, audio_seconds) on public.route_marks to anon, authenticated;
grant insert (latitude, longitude, audio_seconds) on public.route_marks to authenticated;
