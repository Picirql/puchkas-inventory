-- ===================================================================
-- Adds an optional hidden "tag" to each item (e.g. 'Chaats', 'Sweets',
-- 'Veggies') for sub-category search. The tag never appears alongside
-- the item name anywhere in the app — typing "(Chaats)" into any item
-- search box matches every item tagged 'Chaats', without the word
-- "Chaats" ever being part of the item's actual name.
-- Run this once in the Supabase SQL Editor.
-- ===================================================================

alter table items add column if not exists tag text;
