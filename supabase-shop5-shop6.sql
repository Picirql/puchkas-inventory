-- ===================================================================
-- Adds Shop 5 and Shop 6 as two more shop locations, alongside Shop 1-4.
-- Run this once in the Supabase SQL Editor.
--
-- stocks/logs/warehouse_requests/etc. all store location as free text, so
-- they need no schema change — shop5/shop6 rows just work. The only two
-- things that hardcode the existing location set are:
--   1. profiles.role's check constraint (only lets a profile be assigned
--      one of the known roles).
--   2. archive_and_clear_daily() / snapshot_end_of_day() (current versions
--      in supabase-closing-stock-midnight-clear.sql), which loop over an
--      explicit array of locations and classify request_tag strings like
--      'Request from Shop 4' per-location. Both are redefined below with
--      Shop 5/6 added; everything else in those functions is unchanged.
-- ===================================================================

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'profiles' and con.contype = 'c';

  if constraint_name is not null then
    execute format('alter table profiles drop constraint %I', constraint_name);
  end if;
end $$;

alter table profiles
  add constraint profiles_role_check
  check (role in ('manager', 'warehouse', 'shop1', 'shop2', 'shop3', 'shop4', 'shop5', 'shop6', 'kitchen'));

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
  foreach loc in array array['warehouse','kitchen','shop1','shop2','shop3','shop4','shop5','shop6']
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
        when 'shop5' then 'Shop 5'
        when 'shop6' then 'Shop 6'
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
    -- entries were already counted by today's midnight job.
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
              when request_tag in ('Request from Shop 5','Partial dispatch to Shop 5') then 'shop5'
              when request_tag in ('Request from Shop 6','Partial dispatch to Shop 6') then 'shop6'
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
  foreach loc in array array['warehouse','kitchen','shop1','shop2','shop3','shop4','shop5','shop6']
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
              when request_tag in ('Request from Shop 5','Partial dispatch to Shop 5') then 'shop5'
              when request_tag in ('Request from Shop 6','Partial dispatch to Shop 6') then 'shop6'
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

  -- Persist yesterday's "Stock Used" values (from Closing Stock updates)
  -- before closing_stock_locks is cleared below. Rows with stock_used null
  -- (locked via "Update Stock" without a closing-stock action) are not
  -- meaningful "Stock Used" values, so they're skipped.
  insert into daily_closing_stock (location, activity_date, item_name, stock_used)
  select location, yesterday, item_name, stock_used
  from closing_stock_locks
  where stock_used is not null
  on conflict (location, activity_date, item_name) do update set stock_used = excluded.stock_used;

  -- Unlock every item's Add/Closing Stock inputs for the new day.
  delete from closing_stock_locks;

  -- 60-day retention for the structured daily activity/snapshot/closing-
  -- stock data — comfortably covers "current month so far" plus the
  -- monthly sheet generation that runs early the following month.
  delete from daily_item_activity where activity_date < yesterday - interval '60 days';
  delete from daily_stock_snapshots where activity_date < yesterday - interval '60 days';
  delete from daily_closing_stock where activity_date < yesterday - interval '60 days';
end;
$$;
