-- ===================================================================
-- Daily 5pm (IST) archive + clear job
-- Run this once in the Supabase SQL Editor.
-- ===================================================================

-- 1. Table to store each day's archived log text per location
create table log_archives (
  id bigint generated always as identity primary key,
  location text not null,
  archive_date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  unique (location, archive_date)
);

alter table log_archives enable row level security;
create policy "anon full access" on log_archives for all using (true) with check (true);

-- 2. Enable the pg_cron extension (also available under
--    Database -> Extensions -> pg_cron in the dashboard)
create extension if not exists pg_cron;

-- 3. Function: for each location, format that location's logs as text
--    (same format as the in-app "Export Logs (TXT)" button), save it to
--    log_archives, then clear logs and both request queues for everyone.
create or replace function archive_and_clear_daily()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loc text;
  loc_content text;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  foreach loc in array array['warehouse','kitchen','shop1','shop2','shop3','shop4']
  loop
    select string_agg(
      '[' || to_char(to_timestamp(ts / 1000.0) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') || '] ' ||
      upper(case category
        when 'manager' then 'Manager'
        when 'warehouse' then 'Warehouse'
        when 'shop1' then 'Shop 1'
        when 'shop2' then 'Shop 2'
        when 'shop3' then 'Shop 3'
        when 'shop4' then 'Shop 4'
        when 'kitchen' then 'Kitchen'
        else coalesce(category, '')
      end) || ': ' ||
      case when action_type = 'add' then 'Added' else 'Subtracted' end || ' ' ||
      trim_scale(qty)::text || ' ' || item_name ||
      case when source is not null
        then ' — ' || (case source when 'online' then 'Online' when 'supermarket' then 'Supermarket' else source end)
        else ''
      end,
      E'\r\n' order by ts
    )
    into loc_content
    from logs
    where location = loc;

    if loc_content is not null then
      insert into log_archives (location, archive_date, content)
      values (loc, today, loc_content)
      on conflict (location, archive_date)
      do update set content = excluded.content, created_at = now();
    end if;
  end loop;

  delete from logs;
  delete from warehouse_requests;
  delete from kitchen_requests;

  -- 30-day retention: drop archives older than 30 days so they stop
  -- showing up (and taking up space) in the Archived Daily Logs list.
  delete from log_archives where archive_date < today - interval '30 days';
end;
$$;

-- 4. Schedule: every day at 11:30 UTC = 5:00 PM IST (India has no DST,
--    so this offset never changes).
select cron.schedule('daily-archive-and-clear', '30 11 * * *', $$select archive_and_clear_daily();$$);
