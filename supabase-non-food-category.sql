-- ===================================================================
-- Adds "Non-Food Items" as a third item category, alongside Raw and
-- Processed. Run this once in the Supabase SQL Editor.
-- ===================================================================

-- The original items table was created with a check constraint like
--   category text not null check (category in ('raw', 'processed'))
-- Its auto-generated name varies, so find and drop it dynamically before
-- adding the replacement that also allows 'non-food'.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'items' and con.contype = 'c';

  if constraint_name is not null then
    execute format('alter table items drop constraint %I', constraint_name);
  end if;
end $$;

alter table items
  add constraint items_category_check check (category in ('raw', 'processed', 'non-food'));
