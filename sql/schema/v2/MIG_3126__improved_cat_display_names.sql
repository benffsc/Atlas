\echo '=== MIG_3126: Improved cat display names — include secondary color + sex ==='
\echo 'Before: "6295 Black"  After: "6295 Black/White F"'

-- ============================================================
-- Problem: trg_cat_auto_display_name only uses primary color for
-- unnamed cats. Cats like 981020053866295 (Black with White, Female)
-- show as "6295 Black" — not enough to distinguish cats in the
-- clinic day roster or search results.
--
-- Fix: Include secondary_color and sex initial in auto-generated
-- display_name. Format: "[last4] [color](/[secondary])( [sex])"
-- e.g. "6295 Black/White F", "3157 Orange Tabby M"
--
-- Secondary color cleaning:
--   "---"        → skip (means "none")
--   "With White" → "White" (strip "With " prefix)
--   "Unknown"    → skip
--
-- Also removes conflicting trg_sync_cat_display_name trigger which
-- could overwrite the auto-generated name. The auto trigger now
-- handles all display_name generation for garbage-named cats.
--
-- Backfill: 23,803 cats with microchip + 1,618 with clinichq_animal_id
-- Result: 23,799 cats now have sex initial, 12,188 have secondary color
-- ============================================================

-- 1. Replace the trigger function
CREATE OR REPLACE FUNCTION sot.trg_cat_auto_display_name()
RETURNS TRIGGER AS $$
DECLARE
  v_is_garbage_name BOOLEAN;
  v_color TEXT;
  v_secondary TEXT;
  v_sex_initial TEXT;
  v_display TEXT;
BEGIN
  -- Detect garbage names: NULL, empty, 'Unknown', or clinic sequence ("Cat 1", "3", etc.)
  v_is_garbage_name := (
    NEW.name IS NULL
    OR NEW.name IN ('Unknown', '')
    OR NEW.name ~ '^(Cat\s*)?\d{1,3}$'
  );

  -- Only generate display_name for garbage-named cats
  -- and only if display_name isn't already set to something meaningful
  IF v_is_garbage_name
     AND (NEW.display_name IS NULL
          OR NEW.display_name IN ('Unknown', '')
          OR NEW.display_name ~ '^(Cat\s*)?\d{1,3}$'
          OR NEW.display_name = NEW.name
          -- Also regenerate if display_name matches old pattern (chip4 + color, no sex)
          OR (NEW.microchip IS NOT NULL AND NEW.display_name = RIGHT(NEW.microchip, 4) || ' ' || COALESCE(NEW.color, ''))
          OR (NEW.microchip IS NOT NULL AND NEW.display_name = 'Cat ' || RIGHT(NEW.microchip, 4))
     ) THEN

    -- Resolve color: prefer color field, fall back to primary_color
    v_color := COALESCE(NULLIF(NEW.color, ''), NULLIF(NEW.primary_color, ''));

    -- Clean secondary color
    v_secondary := NEW.secondary_color;
    IF v_secondary IS NOT NULL THEN
      -- Strip "With " prefix ("With White" → "White")
      v_secondary := REGEXP_REPLACE(v_secondary, '^With\s+', '', 'i');
      -- Skip junk values
      IF v_secondary IN ('', '---', 'Unknown', 'None') THEN
        v_secondary := NULL;
      END IF;
      -- Skip if secondary = primary (redundant)
      IF v_secondary IS NOT NULL AND LOWER(v_secondary) = LOWER(v_color) THEN
        v_secondary := NULL;
      END IF;
    END IF;

    -- Sex initial: M or F
    v_sex_initial := CASE
      WHEN LOWER(NEW.sex) IN ('male', 'm') THEN 'M'
      WHEN LOWER(NEW.sex) IN ('female', 'f') THEN 'F'
      ELSE NULL
    END;

    IF NEW.microchip IS NOT NULL AND v_color IS NOT NULL AND v_color != 'Unknown' THEN
      -- "[last4] [color](/[secondary])( [sex])"
      v_display := RIGHT(NEW.microchip, 4) || ' ' || v_color;
      IF v_secondary IS NOT NULL THEN
        v_display := v_display || '/' || v_secondary;
      END IF;
      IF v_sex_initial IS NOT NULL THEN
        v_display := v_display || ' ' || v_sex_initial;
      END IF;
      NEW.display_name := v_display;

    ELSIF NEW.microchip IS NOT NULL THEN
      -- "Cat [last4]( [sex])"
      v_display := 'Cat ' || RIGHT(NEW.microchip, 4);
      IF v_sex_initial IS NOT NULL THEN
        v_display := v_display || ' ' || v_sex_initial;
      END IF;
      NEW.display_name := v_display;

    ELSIF NEW.clinichq_animal_id IS NOT NULL AND v_color IS NOT NULL AND v_color != 'Unknown' THEN
      -- "[animal_id] [color](/[secondary])( [sex])"
      v_display := NEW.clinichq_animal_id || ' ' || v_color;
      IF v_secondary IS NOT NULL THEN
        v_display := v_display || '/' || v_secondary;
      END IF;
      IF v_sex_initial IS NOT NULL THEN
        v_display := v_display || ' ' || v_sex_initial;
      END IF;
      NEW.display_name := v_display;

    ELSIF NEW.clinichq_animal_id IS NOT NULL THEN
      -- "Cat [animal_id]( [sex])"
      v_display := 'Cat ' || NEW.clinichq_animal_id;
      IF v_sex_initial IS NOT NULL THEN
        v_display := v_display || ' ' || v_sex_initial;
      END IF;
      NEW.display_name := v_display;

    END IF;
  END IF;

  -- If name changed to a REAL name, update display_name to match
  IF NOT v_is_garbage_name
     AND (OLD IS NULL OR OLD.name IS NULL OR OLD.name IN ('Unknown', '') OR OLD.name ~ '^(Cat\s*)?\d{1,3}$') THEN
    NEW.display_name := NEW.name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo 'Trigger function updated'

-- 2. Drop conflicting sync trigger (auto trigger handles all cases now)
DROP TRIGGER IF EXISTS trg_sync_cat_display_name ON sot.cats;

\echo 'Dropped conflicting sync trigger'

-- 3. Recreate auto trigger with expanded column list (includes secondary_color, sex)
DROP TRIGGER IF EXISTS trg_cat_auto_display_name ON sot.cats;
CREATE TRIGGER trg_cat_auto_display_name
  BEFORE INSERT OR UPDATE OF name, color, primary_color, secondary_color, sex, microchip, display_name, clinichq_animal_id
  ON sot.cats
  FOR EACH ROW
  EXECUTE FUNCTION sot.trg_cat_auto_display_name();

\echo 'Trigger recreated with expanded column list'

-- 4. Backfill — touch display_name to fire the trigger
\echo 'Backfilling display names...'

-- Cats with microchip
WITH candidates AS (
  SELECT cat_id
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL
    AND (name IS NULL OR name IN ('Unknown', '') OR name ~ '^(Cat\s*)?\d{1,3}$')
    AND microchip IS NOT NULL
)
UPDATE sot.cats c
SET display_name = c.display_name
FROM candidates cand
WHERE c.cat_id = cand.cat_id;

-- Cats without microchip but with clinichq_animal_id
WITH candidates AS (
  SELECT cat_id
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL
    AND (name IS NULL OR name IN ('Unknown', '') OR name ~ '^(Cat\s*)?\d{1,3}$')
    AND microchip IS NULL
    AND clinichq_animal_id IS NOT NULL
)
UPDATE sot.cats c
SET display_name = c.display_name
FROM candidates cand
WHERE c.cat_id = cand.cat_id;

\echo 'Backfill complete'

-- 5. Verify
DO $$
DECLARE
  v_with_sex INT;
  v_with_secondary INT;
  v_sample RECORD;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE display_name ~ '\s[MF]$'),
    COUNT(*) FILTER (WHERE display_name ~ '/[A-Za-z]')
  INTO v_with_sex, v_with_secondary
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL
    AND (name IS NULL OR name IN ('Unknown', '') OR name ~ '^(Cat\s*)?\d{1,3}$');

  RAISE NOTICE 'Cats with sex initial: %', v_with_sex;
  RAISE NOTICE 'Cats with secondary color: %', v_with_secondary;

  -- Check cat 6295
  FOR v_sample IN
    SELECT display_name, color, secondary_color, sex
    FROM sot.cats WHERE microchip = '981020053866295'
  LOOP
    RAISE NOTICE 'Cat 6295: "%" (color=%, sec=%, sex=%)',
      v_sample.display_name, v_sample.color, v_sample.secondary_color, v_sample.sex;
  END LOOP;
END;
$$;

\echo ''
\echo '=== MIG_3126 complete ==='
