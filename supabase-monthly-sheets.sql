-- ===================================================================
-- Monthly Inventory Sheets (Excel/CSV)
-- Run this once in the Supabase SQL Editor.
--
-- This adds three new tables, updates archive_and_clear_daily() (5pm IST —
-- still only responsible for archiving + clearing logs/request queues), and
-- adds a NEW function + cron job that runs at midnight IST to record each
-- completed calendar day's per-item activity and end-of-day stock totals.
-- The front end uses that data to build the "Monthly Inventory Sheets" CSV
-- (current month so far, generated on demand) and to generate + store a
-- finished CSV for each completed month (kept for 3 months).
--
-- Note: stocks are NEVER cleared by either job — only the daily logs/request
-- queues continue to be cleared at 5pm, as before.
-- ===================================================================

-- 1. Per-day, per-item, per-source activity totals (added/subtracted).
create table daily_item_activity (
  id bigint generated always as identity primary key,
  location text not null,
  activity_date date not null,
  item_name text not null,
  source text not null,
  added numeric not null default 0,
  subtracted numeric not null default 0,
  unique (location, activity_date, item_name, source)
);

alter table daily_item_activity enable row level security;
create policy "anon full access" on daily_item_activity for all using (true) with check (true);

-- 2. End-of-day (midnight IST) stock totals per item.
create table daily_stock_snapshots (
  location text not null,
  activity_date date not null,
  item_name text not null,
  qty numeric not null default 0,
  primary key (location, activity_date, item_name)
);

alter table daily_stock_snapshots enable row level security;
create policy "anon full access" on daily_stock_snapshots for all using (true) with check (true);

-- 3. Finished monthly CSV sheets, generated client-side once a month is
--    complete and stored here for download (kept for 3 months).
create table inventory_sheets (
  id bigint generated always as identity primary key,
  location text not null,
  sheet_month date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  unique (location, sheet_month)
);

alter table inventory_sheets enable row level security;
create policy "anon full access" on inventory_sheets for all using (true) with check (true);

-- 4. 5pm IST job: archive + clear logs/request queues (unchanged purpose),
--    plus record TODAY's activity so far (midnight-to-5pm) into
--    daily_item_activity, split by source — same classification as
--    classifyLogEntry() in app.js. The evening (5pm-to-midnight) portion of
--    today gets added on top by snapshot_end_of_day() at midnight.
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

    -- Record only today's (midnight-to-5pm) entries — yesterday evening's
    -- entries (still in `logs` from before today's midnight job ran... no,
    -- they were already counted by today's midnight job) are excluded by
    -- the date filter, avoiding double-counting.
    insert into daily_item_activity (location, activity_date, item_name, source, added, subtracted)
    select loc, today, item_name, src,
      sum(case when action_type = 'add' then qty else 0 end),
      sum(case when action_type = 'subtract' then qty else 0 end)
    from (
      select
        item_name,
        action_type,
        qty,
        case
          when request_tag is null then 'own'
          when loc = 'warehouse' then
            case
              when request_tag in ('Received from Kitchen','Partial receipt from Kitchen','Request from Kitchen','Partial dispatch to Kitchen') then 'kitchen'
              when request_tag in ('Request from Shop 1','Partial dispatch to Shop 1') then 'shop1'
              when request_tag in ('Request from Shop 2','Partial dispatch to Shop 2') then 'shop2'
              when request_tag in ('Request from Shop 3','Partial dispatch to Shop 3') then 'shop3'
              when request_tag in ('Request from Shop 4','Partial dispatch to Shop 4') then 'shop4'
              else 'own'
            end
          else
            case
              when request_tag in ('Warehouse Request','Dispatched to Warehouse','Partial dispatch to Warehouse') then 'warehouse'
              else 'own'
            end
        end as src
      from logs
      where location = loc
        and (to_timestamp(ts / 1000.0) at time zone 'Asia/Kolkata')::date = today
    ) classified
    group by item_name, src
    on conflict (location, activity_date, item_name, source)
    do update set added = daily_item_activity.added + excluded.added,
                   subtracted = daily_item_activity.subtracted + excluded.subtracted;
  end loop;

  delete from logs;
  delete from warehouse_requests;
  delete from kitchen_requests;

  -- 30-day retention: drop archives older than 30 days so they stop
  -- showing up (and taking up space) in the Archived Daily Logs list.
  delete from log_archives where archive_date < today - interval '30 days';
end;
$$;

-- 5. Midnight IST job: finalize YESTERDAY's activity by adding the
--    5pm-to-midnight portion (still sitting in `logs`, untouched since the
--    5pm job already ran and only counted the midnight-to-5pm portion), and
--    snapshot end-of-day (midnight) stock totals for yesterday. `logs` is
--    NOT cleared here — only the 5pm job clears it.
create or replace function snapshot_end_of_day()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loc text;
  yesterday date := ((now() at time zone 'Asia/Kolkata')::date) - 1;
begin
  foreach loc in array array['warehouse','kitchen','shop1','shop2','shop3','shop4']
  loop
    insert into daily_item_activity (location, activity_date, item_name, source, added, subtracted)
    select loc, yesterday, item_name, src,
      sum(case when action_type = 'add' then qty else 0 end),
      sum(case when action_type = 'subtract' then qty else 0 end)
    from (
      select
        item_name,
        action_type,
        qty,
        case
          when request_tag is null then 'own'
          when loc = 'warehouse' then
            case
              when request_tag in ('Received from Kitchen','Partial receipt from Kitchen','Request from Kitchen','Partial dispatch to Kitchen') then 'kitchen'
              when request_tag in ('Request from Shop 1','Partial dispatch to Shop 1') then 'shop1'
              when request_tag in ('Request from Shop 2','Partial dispatch to Shop 2') then 'shop2'
              when request_tag in ('Request from Shop 3','Partial dispatch to Shop 3') then 'shop3'
              when request_tag in ('Request from Shop 4','Partial dispatch to Shop 4') then 'shop4'
              else 'own'
            end
          else
            case
              when request_tag in ('Warehouse Request','Dispatched to Warehouse','Partial dispatch to Warehouse') then 'warehouse'
              else 'own'
            end
        end as src
      from logs
      where location = loc
        and (to_timestamp(ts / 1000.0) at time zone 'Asia/Kolkata')::date = yesterday
    ) classified
    group by item_name, src
    on conflict (location, activity_date, item_name, source)
    do update set added = daily_item_activity.added + excluded.added,
                   subtracted = daily_item_activity.subtracted + excluded.subtracted;

    -- End-of-day (midnight) snapshot of current stock totals.
    insert into daily_stock_snapshots (location, activity_date, item_name, qty)
    select loc, yesterday, item_name, qty
    from stocks
    where location = loc
    on conflict (location, activity_date, item_name) do update set qty = excluded.qty;
  end loop;

  -- 60-day retention for the structured daily activity/snapshot data —
  -- comfortably covers "current month so far" plus the monthly sheet
  -- generation that runs early the following month.
  delete from daily_item_activity where activity_date < yesterday - interval '60 days';
  delete from daily_stock_snapshots where activity_date < yesterday - interval '60 days';
end;
$$;

-- 6. Schedule the midnight job: 18:30 UTC = 00:00 IST (India has no DST).
select cron.schedule('daily-end-of-day-snapshot', '30 18 * * *', $$select snapshot_end_of_day();$$);
