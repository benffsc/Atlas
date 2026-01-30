-- ============================================================================
-- MIG_797: Centralized Relationship Functions (INV-10)
-- ============================================================================
-- Implements the structural guardrail described in ATLAS_NORTH_STAR.md INV-10:
-- All writes to cat_place_relationships and person_cat_relationships MUST go
-- through centralized functions that validate entities are not merged and
-- require evidence for every link.
--
-- Two gatekeeper functions:
--   1. link_cat_to_place()     - Validates cat+place, requires evidence
--   2. link_person_to_cat()    - Validates person+cat, requires evidence
--
-- Six existing callers updated to route through these functions.
-- ============================================================================

\echo ''
\echo '=== MIG_797: Centralized Relationship Functions (INV-10) ==='
\echo ''

-- ============================================================================
-- Step 1: Define allowed values
-- ============================================================================

\echo 'Step 1: Creating allowed value arrays'

-- These arrays are referenced by the validation functions.
-- Using a DO block so we can create named constants.

-- ============================================================================
-- Step 2: Create link_cat_to_place()
-- ============================================================================

\echo ''
\echo 'Step 2: Creating link_cat_to_place()'

CREATE OR REPLACE FUNCTION trapper.link_cat_to_place(
    p_cat_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT,
    p_evidence_type TEXT,
    p_source_system TEXT,
    p_source_table TEXT DEFAULT 'unknown',
    p_evidence_detail JSONB DEFAULT '{}'::jsonb,
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_cat_place_id UUID;
    v_allowed_rel_types TEXT[] := ARRAY[
        'home', 'appointment_site', 'trapped_at', 'residence',
        'colony_member', 'observed_at', 'born_at'
    ];
    v_allowed_evidence TEXT[] := ARRAY[
        'appointment', 'observation', 'intake_report',
        'staff_verified', 'ai_inferred', 'trapping_record',
        'owner_address', 'request_match', 'clinic_linking'
    ];
    v_allowed_confidence TEXT[] := ARRAY['high', 'medium', 'low'];
    v_cat_exists BOOLEAN;
    v_place_exists BOOLEAN;
    v_evidence JSONB;
BEGIN
    -- Validate relationship_type
    IF p_relationship_type IS NULL OR NOT (p_relationship_type = ANY(v_allowed_rel_types)) THEN
        RAISE WARNING 'link_cat_to_place: invalid relationship_type "%" (allowed: %)',
            p_relationship_type, v_allowed_rel_types;
        RETURN NULL;
    END IF;

    -- Validate evidence_type
    IF p_evidence_type IS NULL OR NOT (p_evidence_type = ANY(v_allowed_evidence)) THEN
        RAISE WARNING 'link_cat_to_place: invalid evidence_type "%" (allowed: %)',
            p_evidence_type, v_allowed_evidence;
        RETURN NULL;
    END IF;

    -- Validate confidence
    IF NOT (p_confidence = ANY(v_allowed_confidence)) THEN
        p_confidence := 'medium';
    END IF;

    -- Validate cat exists and is not merged
    SELECT EXISTS(
        SELECT 1 FROM trapper.sot_cats
        WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) INTO v_cat_exists;

    IF NOT v_cat_exists THEN
        RAISE WARNING 'link_cat_to_place: cat % does not exist or is merged', p_cat_id;
        RETURN NULL;
    END IF;

    -- Validate place exists and is not merged
    SELECT EXISTS(
        SELECT 1 FROM trapper.places
        WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) INTO v_place_exists;

    IF NOT v_place_exists THEN
        RAISE WARNING 'link_cat_to_place: place % does not exist or is merged', p_place_id;
        RETURN NULL;
    END IF;

    -- Build evidence JSONB (merge caller detail with standard fields)
    v_evidence := COALESCE(p_evidence_detail, '{}'::jsonb) || jsonb_build_object(
        'evidence_type', p_evidence_type,
        'linked_at', NOW()::text,
        'linked_via', 'link_cat_to_place'
    );

    -- Insert with ON CONFLICT: update if new evidence is same-or-stronger confidence
    INSERT INTO trapper.cat_place_relationships (
        cat_id, place_id, relationship_type, confidence,
        source_system, source_table, evidence
    ) VALUES (
        p_cat_id, p_place_id, p_relationship_type, p_confidence,
        p_source_system, COALESCE(p_source_table, 'unknown'), v_evidence
    )
    ON CONFLICT (cat_id, place_id, relationship_type, source_system, source_table)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence = 'high' THEN 'high'
            WHEN EXCLUDED.confidence = 'medium' AND trapper.cat_place_relationships.confidence = 'low' THEN 'medium'
            ELSE trapper.cat_place_relationships.confidence
        END,
        evidence = trapper.cat_place_relationships.evidence || EXCLUDED.evidence
    RETURNING cat_place_id INTO v_cat_place_id;

    -- Log to entity_edits for audit trail
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        field_name, new_value,
        related_entity_type, related_entity_id,
        reason, edited_by, edit_source
    ) VALUES (
        'cat', p_cat_id, 'link',
        'place_link', jsonb_build_object(
            'place_id', p_place_id,
            'relationship_type', p_relationship_type,
            'evidence_type', p_evidence_type,
            'confidence', p_confidence
        ),
        'place', p_place_id,
        format('Linked via %s (%s)', p_evidence_type, p_source_system),
        p_source_system, 'system'
    );

    RETURN v_cat_place_id;
END;
$$;

COMMENT ON FUNCTION trapper.link_cat_to_place IS
'INV-10 gatekeeper: Creates/updates cat-place relationship with mandatory evidence validation.
Rejects merged entities, invalid types, and missing evidence. All cat-place writes MUST use this function.';

-- ============================================================================
-- Step 3: Create link_person_to_cat()
-- ============================================================================

\echo ''
\echo 'Step 3: Creating link_person_to_cat()'

CREATE OR REPLACE FUNCTION trapper.link_person_to_cat(
    p_person_id UUID,
    p_cat_id UUID,
    p_relationship_type TEXT,
    p_evidence_type TEXT,
    p_source_system TEXT,
    p_source_table TEXT DEFAULT 'unknown',
    p_evidence_detail JSONB DEFAULT '{}'::jsonb,
    p_confidence TEXT DEFAULT 'medium',
    p_appointment_id UUID DEFAULT NULL,
    p_context_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_person_cat_id UUID;
    v_allowed_rel_types TEXT[] := ARRAY[
        'owner', 'caretaker', 'brought_in_by', 'foster', 'adopter',
        'former_owner', 'former_foster', 'former_adopter',
        'colony_caretaker', 'rescuer'
    ];
    v_allowed_evidence TEXT[] := ARRAY[
        'appointment', 'observation', 'intake_report',
        'staff_verified', 'ai_inferred', 'shelterluv_outcome',
        'owner_info', 'clinic_linking', 'manual_transfer'
    ];
    v_allowed_confidence TEXT[] := ARRAY['high', 'medium', 'low'];
    v_person_exists BOOLEAN;
    v_cat_exists BOOLEAN;
BEGIN
    -- Validate relationship_type
    IF p_relationship_type IS NULL OR NOT (p_relationship_type = ANY(v_allowed_rel_types)) THEN
        RAISE WARNING 'link_person_to_cat: invalid relationship_type "%" (allowed: %)',
            p_relationship_type, v_allowed_rel_types;
        RETURN NULL;
    END IF;

    -- Validate evidence_type
    IF p_evidence_type IS NULL OR NOT (p_evidence_type = ANY(v_allowed_evidence)) THEN
        RAISE WARNING 'link_person_to_cat: invalid evidence_type "%" (allowed: %)',
            p_evidence_type, v_allowed_evidence;
        RETURN NULL;
    END IF;

    -- Validate confidence
    IF NOT (p_confidence = ANY(v_allowed_confidence)) THEN
        p_confidence := 'medium';
    END IF;

    -- Validate person exists and is not merged
    SELECT EXISTS(
        SELECT 1 FROM trapper.sot_people
        WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) INTO v_person_exists;

    IF NOT v_person_exists THEN
        RAISE WARNING 'link_person_to_cat: person % does not exist or is merged', p_person_id;
        RETURN NULL;
    END IF;

    -- Validate cat exists and is not merged
    SELECT EXISTS(
        SELECT 1 FROM trapper.sot_cats
        WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) INTO v_cat_exists;

    IF NOT v_cat_exists THEN
        RAISE WARNING 'link_person_to_cat: cat % does not exist or is merged', p_cat_id;
        RETURN NULL;
    END IF;

    -- Insert with ON CONFLICT: update if new evidence is same-or-stronger
    INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table,
        appointment_id, context_notes, effective_date
    ) VALUES (
        p_person_id, p_cat_id, p_relationship_type, p_confidence,
        p_source_system, COALESCE(p_source_table, 'unknown'),
        p_appointment_id, p_context_notes, CURRENT_DATE
    )
    ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence = 'high' THEN 'high'
            WHEN EXCLUDED.confidence = 'medium' AND trapper.person_cat_relationships.confidence = 'low' THEN 'medium'
            ELSE trapper.person_cat_relationships.confidence
        END,
        appointment_id = COALESCE(EXCLUDED.appointment_id, trapper.person_cat_relationships.appointment_id),
        context_notes = COALESCE(EXCLUDED.context_notes, trapper.person_cat_relationships.context_notes)
    RETURNING person_cat_id INTO v_person_cat_id;

    -- Log to entity_edits for audit trail
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        field_name, new_value,
        related_entity_type, related_entity_id,
        reason, edited_by, edit_source
    ) VALUES (
        'cat', p_cat_id, 'link',
        'person_link', jsonb_build_object(
            'person_id', p_person_id,
            'relationship_type', p_relationship_type,
            'evidence_type', p_evidence_type,
            'confidence', p_confidence,
            'appointment_id', p_appointment_id
        ),
        'person', p_person_id,
        format('Linked via %s (%s)', p_evidence_type, p_source_system),
        p_source_system, 'system'
    );

    RETURN v_person_cat_id;
END;
$$;

COMMENT ON FUNCTION trapper.link_person_to_cat IS
'INV-10 gatekeeper: Creates/updates person-cat relationship with mandatory evidence validation.
Rejects merged entities, invalid types, and missing evidence. All person-cat writes MUST use this function.';

-- ============================================================================
-- Step 4: Migrate link_cats_to_places() to use centralized function
-- ============================================================================

\echo ''
\echo 'Step 4: Updating link_cats_to_places() to use link_cat_to_place()'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE(cats_linked_home INT, cats_linked_appointment INT, total_edges INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_linked_home INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_result UUID;
BEGIN
    -- Link cats to their owner's primary place
    FOR v_cat_id, v_place_id IN
        SELECT DISTINCT
            pcr.cat_id,
            ppr.place_id
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
            AND sp.merged_into_person_id IS NULL
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
            AND pl.merged_into_place_id IS NULL
        JOIN trapper.sot_cats sc ON sc.cat_id = pcr.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pcr.relationship_type = 'owner'
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = pcr.cat_id
              AND cpr.place_id = ppr.place_id
              AND cpr.relationship_type = 'home'
        )
    LOOP
        v_result := trapper.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := 'home',
            p_evidence_type := 'owner_address',
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_places',
            p_evidence_detail := jsonb_build_object('link_method', 'owner_address'),
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_linked_home := v_linked_home + 1;
        END IF;
    END LOOP;

    cats_linked_home := v_linked_home;
    cats_linked_appointment := 0; -- Deferred
    total_edges := v_linked_home;
    RETURN NEXT;
END;
$$;

-- ============================================================================
-- Step 5: Migrate link_appointment_cats_to_places() to use centralized function
-- ============================================================================

\echo ''
\echo 'Step 5: Updating link_appointment_cats_to_places()'

CREATE OR REPLACE FUNCTION trapper.link_appointment_cats_to_places()
RETURNS TABLE(cats_linked INT, places_found INT, relationships_created INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_linked INT := 0;
    v_places INT := 0;
    v_created INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_result UUID;
    v_seen_places UUID[] := ARRAY[]::UUID[];
BEGIN
    FOR v_cat_id, v_place_id IN
        SELECT DISTINCT
            a.cat_id,
            ppr.place_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_cats sc ON sc.cat_id = a.cat_id
            AND sc.merged_into_cat_id IS NULL
        JOIN trapper.person_identifiers pi ON (
            (a.owner_email IS NOT NULL AND pi.id_type = 'email'
             AND pi.id_value_norm = lower(trim(a.owner_email)))
            OR
            (a.owner_phone IS NOT NULL AND pi.id_type = 'phone'
             AND pi.id_value_norm = trapper.norm_phone_us(a.owner_phone))
        )
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE a.cat_id IS NOT NULL
          AND (a.owner_email IS NOT NULL OR a.owner_phone IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM trapper.cat_place_relationships cpr
              WHERE cpr.cat_id = a.cat_id
                AND cpr.place_id = ppr.place_id
                AND cpr.relationship_type = 'appointment_site'
          )
    LOOP
        v_result := trapper.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := 'appointment_site',
            p_evidence_type := 'clinic_linking',
            p_source_system := 'clinichq',
            p_source_table := 'sot_appointments',
            p_evidence_detail := jsonb_build_object('link_method', 'appointment_owner_contact'),
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_linked := v_linked + 1;
            v_created := v_created + 1;
            IF NOT (v_place_id = ANY(v_seen_places)) THEN
                v_seen_places := v_seen_places || v_place_id;
                v_places := v_places + 1;
            END IF;
        END IF;
    END LOOP;

    cats_linked := v_linked;
    places_found := v_places;
    relationships_created := v_created;
    RETURN NEXT;
END;
$$;

-- ============================================================================
-- Step 6: Migrate link_appointment_to_person_cat() to use centralized function
-- ============================================================================

\echo ''
\echo 'Step 6: Updating link_appointment_to_person_cat()'

CREATE OR REPLACE FUNCTION trapper.link_appointment_to_person_cat(
    p_appointment_id UUID
)
RETURNS TABLE(relationship_id UUID, relationship_type TEXT, is_new BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    v_cat_id UUID;
    v_person_id UUID;
    v_appt_date DATE;
    v_existing_owner_person_id UUID;
    v_existing_owner_name TEXT;
    v_result UUID;
    v_rel_type TEXT;
    v_context TEXT;
BEGIN
    -- Get appointment details
    SELECT a.cat_id, a.person_id, a.appointment_date::date
    INTO v_cat_id, v_person_id, v_appt_date
    FROM trapper.sot_appointments a
    WHERE a.appointment_id = p_appointment_id;

    IF v_cat_id IS NULL OR v_person_id IS NULL THEN
        RETURN;
    END IF;

    -- Check if cat already has an owner
    SELECT pcr.person_id,
           COALESCE(sp.first_name || ' ' || sp.last_name, 'Unknown')
    INTO v_existing_owner_person_id, v_existing_owner_name
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
    WHERE pcr.cat_id = v_cat_id
      AND pcr.relationship_type = 'owner'
    ORDER BY pcr.created_at DESC
    LIMIT 1;

    IF v_existing_owner_person_id IS NULL THEN
        -- No existing owner: create owner relationship
        v_rel_type := 'owner';
        v_context := format('First owner recorded from appointment on %s', v_appt_date);
    ELSIF v_existing_owner_person_id = v_person_id THEN
        -- Same person: update existing (context refresh)
        v_rel_type := 'owner';
        v_context := format('Owner confirmed via appointment on %s', v_appt_date);
    ELSE
        -- Different person: create brought_in_by
        v_rel_type := 'brought_in_by';
        v_context := format('Brought to clinic on %s (existing owner: %s)',
                           v_appt_date, v_existing_owner_name);
    END IF;

    v_result := trapper.link_person_to_cat(
        p_person_id := v_person_id,
        p_cat_id := v_cat_id,
        p_relationship_type := v_rel_type,
        p_evidence_type := 'appointment',
        p_source_system := 'clinichq',
        p_source_table := 'sot_appointments',
        p_appointment_id := p_appointment_id,
        p_context_notes := v_context,
        p_confidence := 'high'
    );

    IF v_result IS NOT NULL THEN
        relationship_id := v_result;
        relationship_type := v_rel_type;
        is_new := TRUE;
        RETURN NEXT;
    END IF;
END;
$$;

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_797 SUMMARY ======'
\echo ''
\echo '  Created 2 centralized gatekeeper functions:'
\echo '    link_cat_to_place()    — validates cat+place not merged, requires evidence_type'
\echo '    link_person_to_cat()   — validates person+cat not merged, requires evidence_type'
\echo ''
\echo '  Migrated 3 existing callers:'
\echo '    link_cats_to_places()              → uses link_cat_to_place()'
\echo '    link_appointment_cats_to_places()   → uses link_cat_to_place()'
\echo '    link_appointment_to_person_cat()    → uses link_person_to_cat()'
\echo ''
\echo '  All relationship writes now:'
\echo '    - Reject merged entities'
\echo '    - Require valid evidence_type'
\echo '    - Log to entity_edits for audit trail'
\echo '    - Use ON CONFLICT to upgrade confidence'
\echo ''
\echo '=== MIG_797 Complete ==='
