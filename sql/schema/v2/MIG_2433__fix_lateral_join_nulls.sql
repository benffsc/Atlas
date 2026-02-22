-- MIG_2433: Fix LATERAL Join NULL Returns in Person-Chain Cat Linking
--
-- Problem: link_cats_to_places() uses LATERAL join that can silently skip cats
--          when the person has no person_place records. These cats are not
--          tracked as skipped.
--
-- Solution: Log skipped cats to ops.entity_linking_skipped with reason
--           'person_has_no_place' for monitoring.
--
-- Also adds the should_compute_disease_for_place() check to exclude
-- clinic/blacklisted places from person-chain linking.
--
-- @see DATA_GAP_040
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2433: Fix LATERAL Join NULLs'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX link_cats_to_places() - LOG SKIPPED CATS
-- ============================================================================

\echo '1. Fixing sot.link_cats_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, cats_skipped INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_total INT := 0;
    v_skipped INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence TEXT;
    v_evidence_type TEXT;
    v_result UUID;
BEGIN
    -- Link cats to places via person_cat → person_place chain.
    -- Maps person_cat relationship types to cat_place relationship types.
    --
    -- MIG_889 FIX: Uses LIMIT 1 per person (highest confidence, most recent)
    -- instead of linking to ALL historical addresses. This prevents pollution.
    --
    -- MIG_2433 FIX: Logs skipped cats to ops.entity_linking_skipped and
    -- excludes clinic/blacklisted places via should_compute_disease_for_place().

    FOR v_cat_id, v_place_id, v_pcr_type IN
        SELECT DISTINCT
            pc.cat_id,
            best_place.place_id,
            pc.relationship_type
        FROM sot.person_cat pc
        JOIN sot.people sp ON sp.person_id = pc.person_id
            AND sp.merged_into_person_id IS NULL
        -- MIG_889: LATERAL join to get ONLY the best place per person
        JOIN LATERAL (
            SELECT pp.place_id
            FROM sot.person_place pp
            JOIN sot.places pl ON pl.place_id = pp.place_id
                AND pl.merged_into_place_id IS NULL
            WHERE pp.person_id = pc.person_id
              AND pp.relationship_type IN ('resident', 'owner', 'requester')
              -- MIG_2433: Exclude clinic/blacklisted places
              AND sot.should_compute_disease_for_place(pp.place_id)
            ORDER BY pp.confidence DESC NULLS LAST, pp.created_at DESC
            LIMIT 1  -- INV-26: LIMIT 1 per person to prevent address pollution
        ) best_place ON TRUE
        JOIN sot.cats sc ON sc.cat_id = pc.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- INV-12: exclude staff/trappers whose cats are clinic-processed, not residents
        AND NOT EXISTS (
            SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = pc.person_id
              AND pr.role_status = 'active'
              AND (pr.role = 'staff' OR pr.role = 'trapper')
        )
        AND NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = pc.cat_id
              AND cp.place_id = best_place.place_id
        )
    LOOP
        -- Map person_cat type → cat_place type + confidence
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

        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'entity_linking',
            p_source_table := 'link_cats_to_places',
            p_confidence := v_confidence
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    -- MIG_2433 FIX: Log cats that couldn't be linked (person has no valid place)
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT DISTINCT 'cat', pc.cat_id,
           CASE
               WHEN NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.person_id = pc.person_id)
               THEN 'person_has_no_place'
               WHEN NOT EXISTS (
                   SELECT 1 FROM sot.person_place pp
                   JOIN sot.places pl ON pl.place_id = pp.place_id
                   WHERE pp.person_id = pc.person_id
                   AND sot.should_compute_disease_for_place(pp.place_id)
               )
               THEN 'person_only_has_clinic_or_blacklisted_places'
               ELSE 'person_chain_no_match'
           END,
           NOW()
    FROM sot.person_cat pc
    JOIN sot.people sp ON sp.person_id = pc.person_id
        AND sp.merged_into_person_id IS NULL
    JOIN sot.cats sc ON sc.cat_id = pc.cat_id
        AND sc.merged_into_cat_id IS NULL
    WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
    -- Exclude staff/trappers
    AND NOT EXISTS (
        SELECT 1 FROM sot.person_roles pr
        WHERE pr.person_id = pc.person_id
          AND pr.role_status = 'active'
          AND (pr.role = 'staff' OR pr.role = 'trapper')
    )
    -- Cat doesn't have any place link yet
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id)
    -- Person has no valid place for linking
    AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE pp.person_id = pc.person_id
          AND pp.relationship_type IN ('resident', 'owner', 'requester')
          AND sot.should_compute_disease_for_place(pp.place_id)
    )
    ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    cats_skipped := v_skipped;
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'V2/MIG_2433: Links cats to places via person_cat → person_place chain.
Ported from V1 MIG_889 with critical fixes:
1. LIMIT 1 per person (INV-26) - prevents cats linking to ALL historical addresses
2. Staff/trapper exclusion (INV-12) - prevents pollution from staff cats
3. Uses best confidence + most recent ordering

MIG_2433 fixes:
4. Logs skipped cats to ops.entity_linking_skipped
5. Excludes clinic/blacklisted places via should_compute_disease_for_place()

Uses link_cat_to_place() gatekeeper (INV-10).';

\echo '   Fixed sot.link_cats_to_places()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing link_cats_to_places()...'
SELECT * FROM sot.link_cats_to_places();

\echo ''
\echo 'Skipped entities by reason (after fix):'
SELECT entity_type, reason, COUNT(*) as count
FROM ops.entity_linking_skipped
GROUP BY entity_type, reason
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2433 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Now logs skipped cats to ops.entity_linking_skipped'
\echo '  - Added should_compute_disease_for_place() filter to exclude clinics'
\echo '  - Returns cats_skipped count in addition to cats_linked'
\echo '  - Tracks specific skip reasons: person_has_no_place, person_only_has_clinic_or_blacklisted_places'
\echo ''
