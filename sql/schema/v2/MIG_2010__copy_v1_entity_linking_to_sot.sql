-- MIG_2010: Copy V1 Entity Linking Functions to V2 sot Schema
--
-- Purpose: Port the V1 entity linking pipeline to V2
-- These functions link cats to places, appointments to places, etc.
--
-- Key V1 functions being copied:
-- 1. sot.link_cats_to_appointment_places() - Primary: uses inferred_place_id (MIG_889)
-- 2. sot.link_cats_to_places() - Secondary: person_cat → person_place chain (MIG_889)
-- 3. sot.link_appointments_to_places() - Creates inferred_place_id
-- 4. sot.run_all_entity_linking() - Orchestrator function
--
-- Key invariants preserved:
-- - LIMIT 1 per person for cat-place linking (INV-26)
-- - Staff/trappers excluded from auto-linking (INV-12)
-- - appointment_site relationship type for appointment-based links
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2010: Copy V1 Entity Linking to V2'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. LINK APPOINTMENTS TO PLACES
-- ============================================================================

\echo '1. Creating sot.link_appointments_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_appointments_to_places()
RETURNS TABLE(
    source TEXT,
    appointments_linked INT
) AS $$
DECLARE
    v_count INT;
BEGIN
    -- Link via owner address from appointments
    -- This resolves the inferred_place_id on ops.appointments

    WITH address_links AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = pl.place_id,
            resolution_status = 'auto_linked'
        FROM sot.places pl
        WHERE a.inferred_place_id IS NULL
          AND a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          AND pl.normalized_address = sot.normalize_address(a.owner_address)
          AND pl.merged_into_place_id IS NULL
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_count FROM address_links;

    source := 'owner_address';
    appointments_linked := v_count;
    RETURN NEXT;

    -- Link via resolved_person_id → person_place
    WITH person_links AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = (
                SELECT pp.place_id
                FROM sot.person_place pp
                JOIN sot.places pl ON pl.place_id = pp.place_id
                WHERE pp.person_id = a.resolved_person_id
                  AND pl.merged_into_place_id IS NULL
                ORDER BY pp.confidence DESC, pp.created_at DESC
                LIMIT 1
            )
        WHERE a.inferred_place_id IS NULL
          AND a.resolved_person_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM sot.person_place pp
              WHERE pp.person_id = a.resolved_person_id
          )
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_count FROM person_links;

    source := 'person_place';
    appointments_linked := v_count;
    RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_appointments_to_places IS
'V2: Links appointments to places via owner_address or person_place chain.
Sets inferred_place_id on ops.appointments.
Priority: 1. normalized_address match, 2. person_place (best confidence)';

\echo '   Created sot.link_appointments_to_places()'

-- ============================================================================
-- 2. LINK CATS TO APPOINTMENT PLACES (MIG_889 - PRIMARY)
-- ============================================================================

\echo ''
\echo '2. Creating sot.link_cats_to_appointment_places()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_appointment_places()
RETURNS TABLE(cats_linked INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_total INT := 0;
    v_result UUID;
    v_cat_id UUID;
    v_place_id UUID;
BEGIN
    -- Link cats to places using the pre-computed inferred_place_id from appointments.
    -- This is more accurate than the person_cat → person_place chain because:
    -- 1. inferred_place_id comes from the appointment's actual owner address
    -- 2. It uses the most recent appointment per cat (not all historical addresses)

    FOR v_cat_id, v_place_id IN
        WITH appointment_places AS (
            SELECT DISTINCT ON (a.cat_id)
                a.cat_id,
                COALESCE(a.inferred_place_id, a.place_id) AS place_id
            FROM ops.appointments a
            WHERE a.cat_id IS NOT NULL
              AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM sot.cats sc
                  WHERE sc.cat_id = a.cat_id AND sc.merged_into_cat_id IS NULL
              )
            ORDER BY a.cat_id, a.appointment_date DESC  -- most recent appointment wins
        )
        SELECT ap.cat_id, ap.place_id
        FROM appointment_places ap
        JOIN sot.places pl ON pl.place_id = ap.place_id
          AND pl.merged_into_place_id IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = ap.cat_id AND cp.place_id = ap.place_id
        )
    LOOP
        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := 'appointment_site',
            p_evidence_type := 'appointment',
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_appointment_places',
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_appointment_places IS
'V2: Links cats to places using appointment inferred_place_id.
Ported from V1 MIG_889.
More accurate than person_cat → person_place chain because it uses
the pre-computed best-place from the most recent appointment.
Uses link_cat_to_place() gatekeeper (INV-10).';

\echo '   Created sot.link_cats_to_appointment_places()'

-- ============================================================================
-- 3. LINK CATS TO PLACES VIA PERSON CHAIN (MIG_889 - SECONDARY)
-- ============================================================================

\echo ''
\echo '3. Creating sot.link_cats_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
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
    -- Link cats to places via person_cat → person_place chain.
    -- Maps person_cat relationship types to cat_place relationship types.
    --
    -- MIG_889 FIX: Uses LIMIT 1 per person (highest confidence, most recent)
    -- instead of linking to ALL historical addresses. This prevents pollution.

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
              AND pp.role IN ('resident', 'owner', 'requester')
            ORDER BY
                CASE pp.confidence
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END,
                pp.created_at DESC
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
              AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
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
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_places',
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

COMMENT ON FUNCTION sot.link_cats_to_places IS
'V2: Links cats to places via person_cat → person_place chain.
Ported from V1 MIG_889 with critical fixes:
1. LIMIT 1 per person (INV-26) - prevents cats linking to ALL historical addresses
2. Staff/trapper exclusion (INV-12) - prevents pollution from staff cats
3. Uses best confidence + most recent ordering
Uses link_cat_to_place() gatekeeper (INV-10).';

\echo '   Created sot.link_cats_to_places()'

-- ============================================================================
-- 4. RUN ALL ENTITY LINKING (Orchestrator)
-- ============================================================================

\echo ''
\echo '4. Creating sot.run_all_entity_linking()...'

CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}';
    v_start TIMESTAMPTZ;
    v_row RECORD;
    v_count INT;
BEGIN
    v_start := clock_timestamp();

    -- Step 1: Link appointments to places
    FOR v_row IN SELECT * FROM sot.link_appointments_to_places() LOOP
        v_result := v_result || jsonb_build_object(
            'appointments_' || v_row.source,
            v_row.appointments_linked
        );
    END LOOP;

    -- Step 2: Link cats to places via appointments (PRIMARY)
    SELECT cats_linked INTO v_count FROM sot.link_cats_to_appointment_places();
    v_result := v_result || jsonb_build_object('cats_via_appointments', v_count);

    -- Step 3: Link cats to places via person chain (SECONDARY)
    SELECT total_edges INTO v_count FROM sot.link_cats_to_places();
    v_result := v_result || jsonb_build_object('cats_via_person_chain', v_count);

    -- Add timing
    v_result := v_result || jsonb_build_object(
        'duration_ms',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS
'V2: Master orchestrator for entity linking pipeline.
Order of execution:
1. link_appointments_to_places() - Resolve inferred_place_id
2. link_cats_to_appointment_places() - PRIMARY: appointment-based linking
3. link_cats_to_places() - SECONDARY: person chain fallback

Returns JSONB with counts from each step and total duration.';

\echo '   Created sot.run_all_entity_linking()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Entity linking functions created:'
SELECT
    p.proname AS function_name,
    pg_catalog.pg_get_function_result(p.oid) AS return_type
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'sot'
  AND p.proname LIKE 'link_%' OR p.proname = 'run_all_entity_linking'
ORDER BY p.proname;

\echo ''
\echo '=============================================='
\echo '  MIG_2010 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V2 Entity Linking functions:'
\echo '  - sot.link_appointments_to_places()'
\echo '  - sot.link_cats_to_appointment_places() [PRIMARY]'
\echo '  - sot.link_cats_to_places() [SECONDARY]'
\echo '  - sot.run_all_entity_linking() [ORCHESTRATOR]'
\echo ''
\echo 'Key invariants preserved:'
\echo '  - INV-26: LIMIT 1 per person for cat-place linking'
\echo '  - INV-12: Staff/trappers excluded from auto-linking'
\echo '  - INV-10: All links go through gatekeeper functions'
\echo ''
\echo 'Usage: SELECT * FROM sot.run_all_entity_linking();'
\echo ''
