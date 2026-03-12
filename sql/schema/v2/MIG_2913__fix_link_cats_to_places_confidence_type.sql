-- MIG_2913: Fix link_cats_to_places() confidence type mismatch (FFS-467)
--
-- Bug: v_confidence was declared as TEXT and assigned string values ('high', 'medium')
-- but sot.link_cat_to_place() expects p_confidence NUMERIC. This caused:
--   "function sot.link_cat_to_place(...p_confidence => text) does not exist"
-- which made ALL person-chain cat-place linking fail silently during ingest.
--
-- Fix: Change v_confidence to NUMERIC, map values to proper numeric confidences.
-- Also add explicit ::TEXT casts on string literals to avoid 'unknown' type resolution.

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INT, cats_linked_appointment INT, cats_skipped INT, total_edges INT) AS $$
DECLARE
    v_total INT := 0;
    v_skipped INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence NUMERIC;      -- FIX: was TEXT, link_cat_to_place expects NUMERIC
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
                v_confidence := 0.9;              -- was 'high'
                v_evidence_type := 'owner_address';
            WHEN 'caretaker' THEN
                v_cpr_type := 'residence';
                v_confidence := 0.7;              -- was 'medium'
                v_evidence_type := 'person_relationship';
            WHEN 'foster' THEN
                v_cpr_type := 'home';
                v_confidence := 0.7;              -- was 'medium'
                v_evidence_type := 'person_relationship';
            WHEN 'adopter' THEN
                v_cpr_type := 'home';
                v_confidence := 0.9;              -- was 'high'
                v_evidence_type := 'person_relationship';
            WHEN 'colony_caretaker' THEN
                v_cpr_type := 'colony_member';
                v_confidence := 0.7;              -- was 'medium'
                v_evidence_type := 'person_relationship';
            ELSE
                CONTINUE;
        END CASE;

        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'entity_linking'::TEXT,
            p_source_table := 'link_cats_to_places'::TEXT,
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
    ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    cats_skipped := v_skipped;
    total_edges := v_total;
    RETURN NEXT;  -- MIG_2913: was missing — function never returned result row
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'Links cats to places via person_cat → person_place chain.
MIG_2913: Fixed v_confidence type from TEXT to NUMERIC — was causing
"function does not exist" error against link_cat_to_place().';
