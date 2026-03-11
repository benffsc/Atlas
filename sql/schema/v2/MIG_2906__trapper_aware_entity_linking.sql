-- MIG_2906: Trapper-Aware Entity Linking
--
-- FFS-449: link_cats_to_places() staff exclusion only checks person_roles,
-- missing 7 trapper_profiles entries without roles. Creates false cat-place
-- links through trapper→home address chain.
--
-- Fix:
--   1. Centralized exclusion helper: sot.is_excluded_from_cat_place_linking()
--   2. Replace inline person_roles checks in link_cats_to_places()
--   3. Add 'trapper_excluded' skip reason to entity linking logging
--
-- Created: 2026-03-11

\echo ''
\echo '=============================================='
\echo '  MIG_2906: Trapper-Aware Entity Linking'
\echo '  FFS-449'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE CENTRALIZED EXCLUSION HELPER
-- ============================================================================

\echo '1. Creating sot.is_excluded_from_cat_place_linking()...'

CREATE OR REPLACE FUNCTION sot.is_excluded_from_cat_place_linking(p_person_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  -- Returns TRUE if this person should be excluded from person→place→cat linking.
  -- Checks BOTH person_roles AND trapper_profiles.
  -- Colony caretakers intentionally NOT excluded — they genuinely manage colony locations.
  SELECT EXISTS (
    -- Check 1: person_roles (expanded role list)
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = p_person_id
      AND pr.role_status = 'active'
      AND pr.role IN ('staff', 'trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator')
  )
  OR EXISTS (
    -- Check 2: trapper_profiles (catches entries without person_roles)
    SELECT 1 FROM sot.trapper_profiles tp
    WHERE tp.person_id = p_person_id
      AND tp.is_active = TRUE
      AND tp.trapper_type NOT IN ('colony_caretaker')
  );
$$;

COMMENT ON FUNCTION sot.is_excluded_from_cat_place_linking IS
'FFS-449: Centralized check for whether a person should be excluded from
person→place→cat linking. Checks both sot.person_roles AND sot.trapper_profiles.
Colony caretakers are intentionally NOT excluded — they genuinely manage colony locations.
Used by link_cats_to_places() and the TypeScript ingest route.';

\echo '   Created sot.is_excluded_from_cat_place_linking()'

-- ============================================================================
-- 2. REPLACE link_cats_to_places() WITH TRAPPER-AWARE VERSION
-- ============================================================================

\echo ''
\echo '2. Replacing sot.link_cats_to_places() with trapper-aware version...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE (
    cats_linked_home INT,
    cats_linked_appointment INT,
    cats_skipped INT,
    total_edges INT
)
LANGUAGE plpgsql
AS $$
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
    -- Link cats to places via person_cat -> person_place chain.
    -- Maps person_cat relationship types to cat_place relationship types.
    --
    -- MIG_889 FIX: Uses LIMIT 1 per person (highest confidence, most recent)
    -- MIG_2433 FIX: Logs skipped cats, excludes clinic/blacklisted places
    -- MIG_2601 FIX: Added place_kind filter to exclude business/clinic/outdoor_site
    -- MIG_2906 FIX: Uses centralized is_excluded_from_cat_place_linking() (FFS-449)

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
              -- MIG_2601 FIX: Exclude non-residential place_kinds
              AND (
                  pl.place_kind IS NULL
                  OR pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood', 'shelter')
              )
            ORDER BY pp.confidence DESC NULLS LAST, pp.created_at DESC
            LIMIT 1
        ) best_place ON TRUE
        JOIN sot.cats sc ON sc.cat_id = pc.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- MIG_2906/FFS-449: Centralized trapper/staff exclusion
        AND NOT sot.is_excluded_from_cat_place_linking(pc.person_id)
        AND NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = pc.cat_id
              AND cp.place_id = best_place.place_id
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

    -- MIG_2433 FIX: Log cats that couldn't be linked
    -- MIG_2601 UPDATE: Also captures business/work address cases
    -- MIG_2855 / FFS-264: FFSC-only cats get specific reason
    -- MIG_2906 / FFS-449: Add 'trapper_excluded' reason for trapper-linked cats
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT DISTINCT 'cat', pc.cat_id,
           CASE
               -- FFS-449: Cats whose only person link is a trapper/staff
               WHEN sot.is_excluded_from_cat_place_linking(pc.person_id)
               THEN 'trapper_excluded'
               -- FFS-264: FFSC-only cats (all appointments are FFSC program bookings)
               WHEN NOT EXISTS (
                   SELECT 1 FROM ops.appointments a2
                   WHERE a2.cat_id = pc.cat_id AND a2.ffsc_program IS NULL
               ) AND EXISTS (
                   SELECT 1 FROM ops.appointments a3
                   WHERE a3.cat_id = pc.cat_id AND a3.ffsc_program IS NOT NULL
               ) THEN 'ffsc_program_cat'
               -- Original reasons unchanged
               WHEN NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.person_id = pc.person_id)
               THEN 'person_has_no_place'
               WHEN NOT EXISTS (
                   SELECT 1 FROM sot.person_place pp
                   JOIN sot.places pl ON pl.place_id = pp.place_id
                   WHERE pp.person_id = pc.person_id
                   AND sot.should_compute_disease_for_place(pp.place_id)
               )
               THEN 'person_only_has_clinic_or_blacklisted_places'
               WHEN NOT EXISTS (
                   SELECT 1 FROM sot.person_place pp
                   JOIN sot.places pl ON pl.place_id = pp.place_id
                   WHERE pp.person_id = pc.person_id
                   AND (
                       pl.place_kind IS NULL
                       OR pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood', 'shelter')
                   )
               )
               THEN 'person_only_has_business_or_nonresidential_places'
               ELSE 'person_chain_no_match'
           END,
           NOW()
    FROM sot.person_cat pc
    JOIN sot.people sp ON sp.person_id = pc.person_id
        AND sp.merged_into_person_id IS NULL
    JOIN sot.cats sc ON sc.cat_id = pc.cat_id
        AND sc.merged_into_cat_id IS NULL
    WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
    -- Cat doesn't have any place link yet
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id)
    -- MIG_2906: Log ALL unlinked cats including trapper-excluded ones
    -- (previously trapper-excluded cats were silently filtered and never logged)
    ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    cats_skipped := v_skipped;
    total_edges := v_total;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'V2/MIG_2906: Links cats to places via person_cat -> person_place chain.
FFS-449: Uses centralized is_excluded_from_cat_place_linking() instead of
inline person_roles check. Now also checks trapper_profiles.
Logs trapper_excluded cats to entity_linking_skipped.';

\echo '   Replaced sot.link_cats_to_places() with trapper-aware version'

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '3. Verification...'

-- Verify function exists
SELECT
  n.nspname || '.' || p.proname as function_name,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'sot'
  AND p.proname IN ('is_excluded_from_cat_place_linking', 'link_cats_to_places');

-- Show how many people would be excluded by the new helper
\echo ''
\echo 'People excluded by is_excluded_from_cat_place_linking():'

SELECT
  COUNT(*) FILTER (WHERE sot.is_excluded_from_cat_place_linking(p.person_id)) as excluded,
  COUNT(*) FILTER (WHERE NOT sot.is_excluded_from_cat_place_linking(p.person_id)) as not_excluded,
  COUNT(*) FILTER (WHERE sot.is_excluded_from_cat_place_linking(p.person_id)
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_roles pr
      WHERE pr.person_id = p.person_id
        AND pr.role_status = 'active'
        AND (pr.role = 'staff' OR pr.role = 'trapper')
    )
  ) as newly_excluded_via_trapper_profiles
FROM sot.people p
WHERE p.merged_into_person_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2906 COMPLETE'
\echo '=============================================='
