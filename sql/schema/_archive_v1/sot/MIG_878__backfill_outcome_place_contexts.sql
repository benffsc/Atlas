\echo '=== MIG_878: Backfill Outcome Place Contexts ==='
\echo 'Problem: When outcome events were first processed (MIG_874b), most people had no'
\echo 'place links. MIG_877 backfilled addresses. Now tag places with context types.'
\echo ''

-- ============================================================================
-- 1. PRE-DIAGNOSTIC
-- ============================================================================

\echo '--- Step 1: Pre-backfill diagnostic ---'

\echo 'Current place contexts from SL outcomes:'
SELECT context_type, COUNT(*) as count
FROM trapper.place_contexts
WHERE assigned_by = 'shelterluv_events_processor'
GROUP BY context_type ORDER BY count DESC;

\echo ''
\echo 'Person-cat relationships from SL events that could get place contexts:'
SELECT
  pcr.relationship_type,
  COUNT(*) AS total,
  COUNT(ppr.place_id) AS has_place,
  COUNT(*) - COUNT(ppr.place_id) AS missing_place
FROM trapper.person_cat_relationships pcr
LEFT JOIN LATERAL (
  SELECT ppr2.place_id
  FROM trapper.person_place_relationships ppr2
  WHERE ppr2.person_id = pcr.person_id
    AND ppr2.role = 'resident'::trapper.person_place_role
  LIMIT 1
) ppr ON TRUE
WHERE pcr.source_system = 'shelterluv' AND pcr.source_table = 'events'
GROUP BY pcr.relationship_type
ORDER BY total DESC;

-- ============================================================================
-- 2. BACKFILL PLACE CONTEXTS
-- ============================================================================

\echo ''
\echo '--- Step 2: Backfilling place contexts ---'

DO $$
DECLARE
  v_rec RECORD;
  v_place_id UUID;
  v_context_type TEXT;
  v_context_id UUID;
  v_tagged INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
BEGIN
  FOR v_rec IN
    SELECT
      pcr.person_cat_id,
      pcr.person_id,
      pcr.cat_id,
      pcr.relationship_type,
      pcr.context_notes
    FROM trapper.person_cat_relationships pcr
    WHERE pcr.source_system = 'shelterluv'
      AND pcr.source_table = 'events'
      AND pcr.relationship_type IN ('adopter', 'foster', 'owner', 'caretaker')
    ORDER BY pcr.person_cat_id
  LOOP
    BEGIN
      -- Find person's residential place
      SELECT ppr.place_id INTO v_place_id
      FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = v_rec.person_id
        AND ppr.role = 'resident'::trapper.person_place_role
      ORDER BY ppr.created_at DESC
      LIMIT 1;

      IF v_place_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Determine context type based on relationship_type
      v_context_type := CASE
        WHEN v_rec.relationship_type = 'adopter' THEN
          CASE
            WHEN v_rec.context_notes LIKE '%Relocation%' THEN 'relocation_destination'
            ELSE 'adopter_residence'
          END
        WHEN v_rec.relationship_type = 'foster' THEN 'foster_home'
        WHEN v_rec.relationship_type = 'owner' THEN 'colony_site'
        WHEN v_rec.relationship_type = 'caretaker' THEN 'colony_site'
        ELSE NULL
      END;

      IF v_context_type IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Check if context already exists for this place
      IF EXISTS (
        SELECT 1 FROM trapper.place_contexts pc
        WHERE pc.place_id = v_place_id
          AND pc.context_type = v_context_type
          AND pc.valid_to IS NULL
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Assign context
      SELECT trapper.assign_place_context(
        v_place_id,
        v_context_type,
        NULL,                          -- valid_from
        'system_derived',              -- evidence_type
        v_rec.cat_id,                  -- evidence_entity_id
        'Backfilled from SL outcome event (MIG_878). Relationship: ' || v_rec.relationship_type,
        0.75,                          -- confidence
        'shelterluv',                  -- source_system
        v_rec.person_cat_id::text,     -- source_record_id
        'shelterluv_events_processor'  -- assigned_by
      ) INTO v_context_id;

      v_tagged := v_tagged + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      IF v_errors <= 5 THEN
        RAISE NOTICE 'Error for pcr %: %', v_rec.person_cat_id, SQLERRM;
      END IF;
    END;
  END LOOP;

  RAISE NOTICE 'Context backfill complete: % tagged, % skipped (no place or already tagged), % errors',
    v_tagged, v_skipped, v_errors;
END $$;

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Step 3: Post-backfill verification ---'

\echo 'Place contexts from SL outcomes (after backfill):'
SELECT context_type, COUNT(*) as count
FROM trapper.place_contexts
WHERE assigned_by = 'shelterluv_events_processor'
GROUP BY context_type ORDER BY count DESC;

\echo ''
\echo 'Comparison: before vs after should show significant increase'
\echo ''

\echo '=== MIG_878 Complete ==='
\echo 'Backfilled place context tags for SL outcome relationships.'
\echo 'Places now tagged: adopter_residence, foster_home, relocation_destination, colony_site.'
