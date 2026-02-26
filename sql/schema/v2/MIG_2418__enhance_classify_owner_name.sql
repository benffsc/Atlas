-- MIG_2418: Enhance classify_owner_name() Keywords
--
-- Problem: classify_owner_name() missed business keywords found in data audit
-- Missing keywords: Winery, Vineyards, Poultry, Livestock, Auction, Garden
--
-- This migration documents the required changes to:
-- 1. SQL function: sot.classify_owner_name() or trapper.classify_owner_name()
-- 2. TypeScript: lib/guards.ts classifyOwnerName()

-- Note: The actual function definition varies by environment
-- Below are the patterns to ADD to the existing BUSINESS_KEYWORDS regex

/*
BUSINESS KEYWORDS TO ADD:

SQL Pattern (for classify_owner_name):
  -- Agricultural
  '(winery|vineyards?|vineyard|poultry|livestock|auction|dairy|orchard)'
  -- Service
  '(garden|nursery|landscaping)'
  -- Auto
  '(auto|automotive|repairs?|mechanic|tire|body\s*shop)'
  -- Corporation indicators
  '(corporation|corp\.?|incorporated)'

TypeScript Pattern (for guards.ts):
  // Add to BUSINESS_SERVICE_WORDS array:
  'Winery', 'Vineyard', 'Vineyards',
  'Poultry', 'Livestock', 'Auction',
  'Dairy', 'Orchard', 'Nursery',
  'Auto', 'Automotive', 'Mechanic',
  'Corporation'
*/

-- Check if classify_owner_name exists and show current definition
DO $$
DECLARE
  v_func_exists BOOLEAN;
  v_schema TEXT;
BEGIN
  -- Check in sot schema
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'classify_owner_name'
    AND n.nspname = 'sot'
  ) INTO v_func_exists;

  IF v_func_exists THEN
    v_schema := 'sot';
  ELSE
    -- Check in trapper schema
    SELECT EXISTS(
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'classify_owner_name'
      AND n.nspname = 'trapper'
    ) INTO v_func_exists;

    IF v_func_exists THEN
      v_schema := 'trapper';
    END IF;
  END IF;

  IF v_func_exists THEN
    RAISE NOTICE 'MIG_2418: classify_owner_name() found in % schema', v_schema;
    RAISE NOTICE 'MIG_2418: Manual update required - add business keywords listed above';
  ELSE
    RAISE NOTICE 'MIG_2418: classify_owner_name() not found - may be TypeScript only';
  END IF;
END $$;

-- Test current classification on known business names
SELECT
  name,
  CASE
    WHEN name ~* '(winery|vineyards?|poultry|livestock|auction)' THEN 'SHOULD BE: organization'
    WHEN name ~* '(corp|inc|llc|ranch|farm)' THEN 'SHOULD BE: organization'
    ELSE 'Check manually'
  END as expected,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'classify_owner_name') THEN
      -- Call function if it exists (adjust schema as needed)
      'Run: SELECT sot.classify_owner_name(''' || name || ''')'
    ELSE 'Function not available'
  END as test_command
FROM (VALUES
  ('Speedy Creek Winery'),
  ('Keller Estates Vineyards'),
  ('Petaluma Poultry'),
  ('Petaluma Livestock Auction'),
  ('Mike''s Truck Garden'),
  ('Blentech Corporation'),
  ('Sartorial Auto Repairs')
) AS t(name);

-- Documentation for TypeScript update
/*
FILE: /apps/web/src/lib/guards.ts

FIND the BUSINESS_SERVICE_WORDS or similar constant and ADD:

// Agricultural businesses
'Winery', 'Vineyard', 'Vineyards',
'Poultry', 'Livestock', 'Auction',
'Dairy', 'Orchard', 'Nursery',

// Auto/mechanical
'Auto', 'Automotive', 'Mechanic', 'Tire',

// Corporate indicators
'Corporation',

// Service businesses
'Garden', // as in "Truck Garden"
*/
