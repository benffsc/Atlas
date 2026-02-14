-- MIG_232: Name Normalization Trigger
--
-- Ensure all names are normalized to Title Case on insert/update
-- Prevents ALL CAPS or all lowercase names from entering the system
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_232__name_normalization.sql

\echo ''
\echo '=============================================='
\echo 'MIG_232: Name Normalization Trigger'
\echo '=============================================='
\echo ''

-- Function to normalize a name to title case
-- Handles special cases like "McDonald", "O'Brien", etc.
CREATE OR REPLACE FUNCTION trapper.normalize_display_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_result TEXT;
BEGIN
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RETURN p_name;
  END IF;

  -- Basic INITCAP
  v_result := INITCAP(p_name);

  -- Fix common patterns that INITCAP breaks:
  -- McDonald -> Mcdonald -> McDonald
  v_result := REGEXP_REPLACE(v_result, '\bMc([a-z])', 'Mc' || UPPER(SUBSTRING(v_result FROM '\bMc([a-z])')), 'g');

  -- O'Brien -> O'brien -> O'Brien
  v_result := REGEXP_REPLACE(v_result, '''([a-z])', '''' || UPPER(SUBSTRING(v_result FROM '''([a-z])')), 'g');

  -- MacArthur -> Macarthur -> MacArthur (only if originally had Mac prefix)
  -- Skip this as it's ambiguous (Mac vs Mack)

  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger function for sot_people
CREATE OR REPLACE FUNCTION trapper.trg_normalize_person_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Only normalize if the name looks like it needs it (all caps or all lower)
  IF NEW.display_name IS NOT NULL THEN
    -- Check if ALL CAPS (more than 3 chars and all uppercase)
    IF LENGTH(NEW.display_name) > 3 AND NEW.display_name = UPPER(NEW.display_name) THEN
      NEW.display_name := trapper.normalize_display_name(NEW.display_name);
    -- Check if all lowercase (more than 3 chars and all lowercase)
    ELSIF LENGTH(NEW.display_name) > 3 AND NEW.display_name = LOWER(NEW.display_name) THEN
      NEW.display_name := trapper.normalize_display_name(NEW.display_name);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on sot_people
DROP TRIGGER IF EXISTS trg_person_name_normalize ON trapper.sot_people;
CREATE TRIGGER trg_person_name_normalize
  BEFORE INSERT OR UPDATE OF display_name ON trapper.sot_people
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trg_normalize_person_name();

\echo 'Created trigger on sot_people'

-- Similar trigger for sot_cats
CREATE OR REPLACE FUNCTION trapper.trg_normalize_cat_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_name IS NOT NULL THEN
    IF LENGTH(NEW.display_name) > 3 AND NEW.display_name = UPPER(NEW.display_name) THEN
      NEW.display_name := trapper.normalize_display_name(NEW.display_name);
    ELSIF LENGTH(NEW.display_name) > 3 AND NEW.display_name = LOWER(NEW.display_name) THEN
      NEW.display_name := trapper.normalize_display_name(NEW.display_name);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cat_name_normalize ON trapper.sot_cats;
CREATE TRIGGER trg_cat_name_normalize
  BEFORE INSERT OR UPDATE OF display_name ON trapper.sot_cats
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trg_normalize_cat_name();

\echo 'Created trigger on sot_cats'

-- Fix any remaining all-caps or all-lowercase names
\echo ''
\echo 'Fixing existing all-caps names...'
UPDATE trapper.sot_people
SET display_name = trapper.normalize_display_name(display_name)
WHERE display_name = UPPER(display_name)
  AND LENGTH(display_name) > 3
  AND merged_into_person_id IS NULL;

\echo 'Fixing existing all-lowercase names...'
UPDATE trapper.sot_people
SET display_name = trapper.normalize_display_name(display_name)
WHERE display_name = LOWER(display_name)
  AND LENGTH(display_name) > 3
  AND merged_into_person_id IS NULL;

\echo ''
\echo '=============================================='
\echo 'MIG_232 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Created normalize_display_name() function'
\echo '  - Created trigger on sot_people for name normalization'
\echo '  - Created trigger on sot_cats for name normalization'
\echo '  - Fixed any existing all-caps/all-lowercase names'
\echo ''

-- Test
\echo 'Testing normalization:'
SELECT trapper.normalize_display_name('JOHN SMITH') as all_caps,
       trapper.normalize_display_name('jane doe') as all_lower,
       trapper.normalize_display_name('John Smith') as already_ok;
