\echo '=== MIG_872: DQ_004 — ShelterLuv Phantom Cat Cleanup ==='
\echo 'Problem: ShelterLuv import created a phantom cat "Daphne" (52324760) with'
\echo 'junk microchip 981020000000000. This phantom accumulated 2,155 ShelterLuv IDs'
\echo 'and polluted 1,202 person_cat_relationships + 1,331 cat_place_relationships.'
\echo '76.9% of SL adopter links and 86.2% of SL foster links point to this phantom.'
\echo ''
\echo 'Also fixes: 23 cats with concatenated microchips (two chips stuck together).'
\echo ''

-- ============================================================================
-- 1. DIAGNOSTIC
-- ============================================================================

\echo '--- Step 1: Pre-cleanup diagnostic ---'

SELECT 'phantom_daphne_identifiers' as metric,
  (SELECT COUNT(*) FROM trapper.cat_identifiers
   WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c') as count
UNION ALL
SELECT 'phantom_daphne_person_cat_rels',
  (SELECT COUNT(*) FROM trapper.person_cat_relationships
   WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c')
UNION ALL
SELECT 'phantom_daphne_cat_place_rels',
  (SELECT COUNT(*) FROM trapper.cat_place_relationships
   WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c')
UNION ALL
SELECT 'concatenated_microchips',
  (SELECT COUNT(*) FROM trapper.cat_identifiers
   WHERE id_type = 'microchip' AND LENGTH(id_value) > 15);

-- ============================================================================
-- 2. CLEAN PHANTOM DAPHNE
-- The phantom has NO ClinicHQ data, NO appointments — it exists only as a
-- ShelterLuv import artifact. All 5 real Daphnes have ClinicHQ IDs.
-- ============================================================================

\echo ''
\echo '--- Step 2: Cleaning phantom Daphne ---'

-- 2a. Delete cat_place_relationships (most derived, delete first)
WITH deleted_cpl AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c'
  RETURNING cat_place_id
)
SELECT count(*) as deleted_cat_place_links FROM deleted_cpl \gset

\echo '  → Deleted :deleted_cat_place_links cat_place_relationships'

-- 2b. Delete person_cat_relationships
WITH deleted_pcr AS (
  DELETE FROM trapper.person_cat_relationships
  WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c'
  RETURNING person_cat_id
)
SELECT count(*) as deleted_person_cat_links FROM deleted_pcr \gset

\echo '  → Deleted :deleted_person_cat_links person_cat_relationships'

-- 2c. Delete cat_identifiers (the 2,155 stolen ShelterLuv IDs)
WITH deleted_ids AS (
  DELETE FROM trapper.cat_identifiers
  WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c'
  RETURNING cat_identifier_id
)
SELECT count(*) as deleted_identifiers FROM deleted_ids \gset

\echo '  → Deleted :deleted_identifiers cat_identifiers'

-- 2d. Soft-delete: merge phantom into real Daphne (785b has ClinicHQ appointments)
UPDATE trapper.sot_cats
SET merged_into_cat_id = '785b8d5f-3710-4b3a-9755-92a244579beb',
    updated_at = NOW()
WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c'
  AND merged_into_cat_id IS NULL;

\echo '  → Phantom Daphne merged into real Daphne (785b8d5f)'

-- ============================================================================
-- 3. FIX CONCATENATED MICROCHIPS
-- Some cats have two microchips concatenated into one string (30-31 chars).
-- Split them into separate identifier records.
-- Handles: source_table NOT NULL constraint, unique constraint conflicts.
-- ============================================================================

\echo ''
\echo '--- Step 3: Fixing concatenated microchips ---'

DO $$
DECLARE
  v_rec RECORD;
  v_chip1 TEXT;
  v_chip2 TEXT;
  v_chip1_exists BOOLEAN;
  v_fixed INT := 0;
BEGIN
  FOR v_rec IN
    SELECT ci.cat_identifier_id, ci.cat_id, ci.id_value, ci.source_system, ci.source_table
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip'
      AND LENGTH(ci.id_value) >= 30
      AND LENGTH(ci.id_value) <= 31
    ORDER BY ci.cat_id
  LOOP
    v_chip1 := SUBSTRING(v_rec.id_value FROM 1 FOR 15);
    v_chip2 := SUBSTRING(v_rec.id_value FROM 16);

    IF v_chip1 ~ '^\d{15}$' AND v_chip2 ~ '^\d{15,16}$' THEN
      -- Check if first chip already exists (for any cat)
      SELECT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers
        WHERE id_type = 'microchip' AND id_value = v_chip1
      ) INTO v_chip1_exists;

      IF v_chip1_exists THEN
        -- First chip already exists — just delete the concatenated record
        DELETE FROM trapper.cat_identifiers WHERE cat_identifier_id = v_rec.cat_identifier_id;
        RAISE NOTICE 'Deleted concat (chip1 exists): % → kept existing %', v_rec.id_value, v_chip1;
      ELSE
        -- Replace concatenated with first chip
        UPDATE trapper.cat_identifiers
        SET id_value = v_chip1
        WHERE cat_identifier_id = v_rec.cat_identifier_id;
        RAISE NOTICE 'Updated: % → %', v_rec.id_value, v_chip1;
      END IF;

      -- Try to add second chip for this cat (with source_table from original)
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_rec.cat_id, 'microchip', v_chip2, v_rec.source_system, COALESCE(v_rec.source_table, 'microchip_split'))
      ON CONFLICT DO NOTHING;

      v_fixed := v_fixed + 1;
    ELSE
      RAISE NOTICE 'Skipped (not splittable): %', v_rec.id_value;
    END IF;
  END LOOP;

  RAISE NOTICE 'Total processed: %', v_fixed;
END $$;

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Step 4: Post-cleanup verification ---'

\echo ''
\echo 'Phantom Daphne state:'

SELECT
  (SELECT COUNT(*) FROM trapper.cat_identifiers WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c') as identifiers,
  (SELECT COUNT(*) FROM trapper.person_cat_relationships WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c') as person_cat,
  (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c') as cat_place,
  (SELECT merged_into_cat_id IS NOT NULL FROM trapper.sot_cats WHERE cat_id = '52324760-9923-4beb-b87a-9b03f1dcfb1c') as is_merged;

\echo ''
\echo 'ShelterLuv relationships now (should be all real):'

SELECT
  pcr.relationship_type,
  COUNT(*) as total,
  COUNT(DISTINCT pcr.cat_id) as distinct_cats,
  COUNT(DISTINCT pcr.person_id) as distinct_people
FROM trapper.person_cat_relationships pcr
WHERE pcr.source_system = 'shelterluv'
GROUP BY pcr.relationship_type ORDER BY total DESC;

\echo ''
\echo 'Remaining concatenated microchips:'

SELECT COUNT(*) as remaining_concat_chips
FROM trapper.cat_identifiers
WHERE id_type = 'microchip' AND LENGTH(id_value) > 15;

\echo ''
\echo 'Real Daphne cats (should be 5 with appointments):'

SELECT sc.cat_id,
  (SELECT string_agg(ci.id_value, ', ') FROM trapper.cat_identifiers ci WHERE ci.cat_id = sc.cat_id AND ci.id_type = 'microchip') as microchips,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.cat_id = sc.cat_id) as appointments,
  (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = sc.cat_id) as places
FROM trapper.sot_cats sc
WHERE sc.display_name = 'Daphne' AND sc.merged_into_cat_id IS NULL;

-- ============================================================================
-- 5. SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_872 Complete ==='
\echo 'DQ_004: ShelterLuv Phantom Cat Cleanup'
\echo ''
\echo 'Cleaned:'
\echo '  1. Phantom Daphne: Deleted ~2,155 stolen SL IDs, ~1,202 person_cat,'
\echo '     ~1,331 cat_place links. Cat merged into real Daphne (785b8d5f).'
\echo '  2. Concatenated microchips: Split 23 records into individual chips.'
\echo ''
\echo 'Root cause: ShelterLuv XLSX export converted microchip to scientific notation'
\echo '(9.8102E+14 → 981020000000000). find_or_create_cat_by_microchip() accepted it.'
\echo 'Every subsequent SL outcome with that junk chip matched to the phantom.'
\echo ''
\echo 'Prevention:'
\echo '  - MIG_869 removed the all-zeros microchip from cat_identifiers'
\echo '  - MIG_873 adds validate_microchip() gatekeeper to reject junk chips (INV-14)'
\echo '  - INV-16: SL outcomes should be pulled via API, not XLSX exports'
