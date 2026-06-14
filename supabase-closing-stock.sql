-- ===================================================================
-- Closing Stock / Stock Used tracking for Shop 1-4 and Kitchen
-- General Inventory.
-- Run this once in the Supabase SQL Editor (before re-running
-- supabase-daily-archive.sql, which clears this table daily).
-- ===================================================================

-- Presence of a (location, item_name) row means that item's Add and
-- Closing Stock inputs are locked ('-') for the rest of the day.
-- stock_used is the computed "Stock Used" value to display, or null when
-- the item was locked via "Update Stock" with a Closing Stock input
-- present (the closing-stock action itself was not performed).
create table closing_stock_locks (
  location text not null,
  item_name text not null,
  stock_used numeric,
  primary key (location, item_name)
);

alter table closing_stock_locks enable row level security;
create policy "anon full access" on closing_stock_locks for all using (true) with check (true);
