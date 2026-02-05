-- ============================================================================
-- MIG_884: Backfill ClinicHQ Owner Addresses + Requester Role Expansion
-- ============================================================================
-- Problem: ~105 ClinicHQ people have 'Owner Address' in staged_records payload
-- but no person_place_relationships. Also, link_cats_to_places() only uses
-- resident/owner roles — adding 'requester' unlocks ~47 more cats.
--
-- Pattern: Follows MIG_877 (ShelterLuv address backfill).
-- ClinicHQ uses person_identifiers matching (not resulting_entity_id).
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_884: ClinicHQ Owner Address Backfill + Requester Expansion'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Pre-diagnostic
-- ============================================================================

\echo 'Phase 1: Pre-backfill diagnostic...'

SELECT 'cat_place_coverage_before' AS metric,
  ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) /
    NULLIF((SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL), 0), 1) AS value;

SELECT 'clinichq_people_needing_place_links' AS metric,
  COUNT(DISTINCT pi.person_id) AS count
FROM trapper.staged_records sr
JOIN trapper.person_identifiers pi ON (
  (pi.id_type = 'email'
    AND pi.id_value_norm = LOWER(TRIM(sr.payload->>'Owner Email'))
    AND TRIM(sr.payload->>'Owner Email') != '')
  OR
  (pi.id_type = 'phone'
    AND pi.id_value_norm = trapper.norm_phone_us(
      COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))
    )
    AND COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone')) IS NOT NULL
    AND LENGTH(COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))) >= 7
  )
)
JOIN trapper.sot_people sp ON sp.person_id = pi.person_id AND sp.merged_into_person_id IS NULL
WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info'
  AND sr.processed_at IS NOT NULL
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND TRIM(sr.payload->>'Owner Address') != ''
  AND LENGTH(TRIM(sr.payload->>'Owner Address')) > 10
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = pi.person_id
  );

-- ============================================================================
-- Phase 2: Backfill ClinicHQ owner addresses
-- ============================================================================

\echo ''
\echo 'Phase 2: Backfilling ClinicHQ owner addresses...'

DO $$
DECLARE
  v_rec RECORD;
  v_addr TEXT;
  v_place_id UUID;
  v_places_processed INT := 0;
  v_links_created INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
BEGIN
  FOR v_rec IN
    -- For each clinichq owner_info record with an address,
    -- find the person via email/phone and link them to the place
    SELECT DISTINCT ON (pi.person_id)
      sr.id AS staged_record_id,
      pi.person_id,
      TRIM(sr.payload->>'Owner Address') AS owner_address
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email'
        AND pi.id_value_norm = LOWER(TRIM(sr.payload->>'Owner Email'))
        AND TRIM(sr.payload->>'Owner Email') != '')
      OR
      (pi.id_type = 'phone'
        AND pi.id_value_norm = trapper.norm_phone_us(
          COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))
        )
        AND COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone')) IS NOT NULL
        AND LENGTH(COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))) >= 7
      )
    )
    JOIN trapper.sot_people sp ON sp.person_id = pi.person_id AND sp.merged_into_person_id IS NULL
    WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NOT NULL
      AND sr.payload->>'Owner Address' IS NOT NULL
      AND TRIM(sr.payload->>'Owner Address') != ''
      AND LENGTH(TRIM(sr.payload->>'Owner Address')) > 10
      -- Only backfill people with NO existing person_place_relationships
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = pi.person_id
      )
    ORDER BY pi.person_id, sr.processed_at DESC
  LOOP
    BEGIN
      v_addr := v_rec.owner_address;

      -- Skip obviously bad addresses
      IF v_addr IS NULL OR v_addr = '' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Create or find place (auto-queues geocoding)
      SELECT trapper.find_or_create_place_deduped(
        v_addr, NULL, NULL, NULL, 'clinichq'
      ) INTO v_place_id;

      IF v_place_id IS NOT NULL THEN
        INSERT INTO trapper.person_place_relationships (
          person_id, place_id, role, source_system, source_table,
          staged_record_id, confidence, created_by
        ) VALUES (
          v_rec.person_id, v_place_id,
          'resident'::trapper.person_place_role,
          'clinichq', 'owner_info_backfill',
          v_rec.staged_record_id, 0.7,
          'MIG_884_backfill'
        )
        ON CONFLICT (person_id, place_id, role) DO NOTHING;

        IF FOUND THEN
          v_links_created := v_links_created + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
        v_places_processed := v_places_processed + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      IF v_errors <= 5 THEN
        RAISE NOTICE 'Error for person %: %', v_rec.person_id, SQLERRM;
      END IF;
    END;

    IF (v_places_processed + v_skipped + v_errors) % 100 = 0 THEN
      RAISE NOTICE 'Progress: % processed, % links, % skipped, % errors',
        v_places_processed, v_links_created, v_skipped, v_errors;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % places processed, % links created, % skipped, % errors',
    v_places_processed, v_links_created, v_skipped, v_errors;
END $$;

-- ============================================================================
-- Phase 3: Expand link_cats_to_places() with requester role
-- ============================================================================

\echo ''
\echo 'Phase 3: Expanding link_cats_to_places() to include requester role...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE(cats_linked_home integer, cats_linked_appointment integer, total_edges integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence TEXT;
    v_evidence_type TEXT;
    v_result UUID;
BEGIN
    -- Link cats to places via person_cat_relationships + person_place_relationships.
    -- Maps person-cat relationship types to cat-place relationship types:
    --   owner            -> home        (high confidence)
    --   caretaker        -> residence   (medium confidence)
    --   foster           -> home        (medium confidence)
    --   adopter          -> home        (high confidence)
    --   colony_caretaker -> colony_member (medium confidence)
    --
    -- MIG_884: Added 'requester' to person_place role filter.
    -- Requesters often live at or are associated with the TNR address.

    FOR v_cat_id, v_place_id, v_pcr_type IN
        SELECT DISTINCT
            pcr.cat_id,
            ppr.place_id,
            pcr.relationship_type
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
            AND sp.merged_into_person_id IS NULL
            AND COALESCE(sp.is_system_account, FALSE) = FALSE  -- INV-12: exclude system accounts
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
            AND ppr.role IN ('resident', 'owner', 'requester')  -- MIG_884: added requester
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
            AND pl.merged_into_place_id IS NULL
        JOIN trapper.sot_cats sc ON sc.cat_id = pcr.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pcr.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- INV-12: exclude staff/trappers whose cats are clinic-processed, not residents
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_roles pr
            WHERE pr.person_id = pcr.person_id
              AND pr.role_status = 'active'
              AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
        )
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = pcr.cat_id
              AND cpr.place_id = ppr.place_id
        )
    LOOP
        -- Map person_cat type -> cat_place type + confidence
        CASE v_pcr_type
            WHEN 'owner' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'owner_address';
            WHEN 'caretaker' THEN
                v_cpr_type := 'residence';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'foster' THEN
                v_cpr_type := 'home';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'adopter' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'person_relationship';
            WHEN 'colony_caretaker' THEN
                v_cpr_type := 'colony_member';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            ELSE
                CONTINUE;
        END CASE;

        v_result := trapper.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_places',
            p_evidence_detail := jsonb_build_object(
                'link_method', 'person_cat_to_place',
                'person_cat_type', v_pcr_type
            ),
            p_confidence := v_confidence
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION trapper.link_cats_to_places() IS
'Links cats to places via person_cat + person_place chain (MIG_870, updated MIG_884).
Roles: resident, owner, requester. Excludes staff/trappers (INV-12).
Maps owner->home, caretaker->residence, foster->home, adopter->home, colony_caretaker->colony_member.';

-- ============================================================================
-- Phase 4: Re-run link_cats_to_places with expanded roles
-- ============================================================================

\echo ''
\echo 'Phase 4: Re-running link_cats_to_places with requester expansion...'

SELECT * FROM trapper.link_cats_to_places();

-- ============================================================================
-- Phase 5: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT 'cat_place_coverage_after' AS metric,
  ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) /
    NULLIF((SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL), 0), 1) AS value;

SELECT 'clinichq_people_still_needing_links' AS metric,
  COUNT(DISTINCT pi.person_id) AS count
FROM trapper.staged_records sr
JOIN trapper.person_identifiers pi ON (
  (pi.id_type = 'email'
    AND pi.id_value_norm = LOWER(TRIM(sr.payload->>'Owner Email'))
    AND TRIM(sr.payload->>'Owner Email') != '')
  OR
  (pi.id_type = 'phone'
    AND pi.id_value_norm = trapper.norm_phone_us(
      COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))
    )
    AND COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone')) IS NOT NULL
    AND LENGTH(COALESCE(NULLIF(TRIM(sr.payload->>'Owner Phone'), ''), TRIM(sr.payload->>'Owner Cell Phone'))) >= 7
  )
)
JOIN trapper.sot_people sp ON sp.person_id = pi.person_id AND sp.merged_into_person_id IS NULL
WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info'
  AND sr.processed_at IS NOT NULL
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND TRIM(sr.payload->>'Owner Address') != ''
  AND LENGTH(TRIM(sr.payload->>'Owner Address')) > 10
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = pi.person_id
  );

-- Show remaining gap breakdown
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM trapper.person_cat_relationships pcr WHERE pcr.cat_id = sc.cat_id) THEN 'no_person_cat_rel'
    WHEN EXISTS (
      SELECT 1 FROM trapper.person_cat_relationships pcr
      JOIN trapper.person_roles pr ON pr.person_id = pcr.person_id
        AND pr.role IN ('staff','coordinator','head_trapper','ffsc_trapper','community_trapper')
        AND pr.role_status = 'active'
      WHERE pcr.cat_id = sc.cat_id
    ) THEN 'staff_trapper_filter'
    WHEN NOT EXISTS (
      SELECT 1 FROM trapper.person_cat_relationships pcr
      JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
        AND ppr.role IN ('resident', 'owner', 'requester')
      WHERE pcr.cat_id = sc.cat_id
    ) THEN 'person_has_no_place'
    ELSE 'other_reason'
  END AS reason,
  COUNT(*) AS cat_count
FROM trapper.sot_cats sc
WHERE sc.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = sc.cat_id)
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== MIG_884 Complete ==='
