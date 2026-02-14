\echo '=================================================='
\echo 'MIG_870: Close Cat-Place Linking Gap (DQ_003)'
\echo '=================================================='
\echo ''
\echo 'Problem: Cats linked to people (caretaker, foster, etc.) via'
\echo 'person_cat_relationships are NOT linked to those peoples places.'
\echo 'Only owner→home was handled. This closes the gap for all eligible types'
\echo 'and adds it as a permanent step in the ingestion pipeline.'
\echo ''

-- ============================================================================
-- PHASE 1: DIAGNOSTIC — How many cats are affected?
-- ============================================================================

\echo 'PHASE 1: DIAGNOSTIC'
\echo ''

\echo '1a. Cats with person_cat_relationships but NO cat_place_relationships:'

SELECT
  pcr.relationship_type,
  COUNT(DISTINCT pcr.cat_id) as cats_without_places,
  COUNT(DISTINCT pcr.person_id) as unique_people
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
JOIN trapper.sot_people p ON p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM trapper.cat_place_relationships cpr
  WHERE cpr.cat_id = pcr.cat_id
)
GROUP BY pcr.relationship_type
ORDER BY cats_without_places DESC;

\echo ''
\echo '1b. Of those, how many persons have places (fixable)?'

SELECT
  pcr.relationship_type,
  COUNT(DISTINCT pcr.cat_id) as fixable_cats,
  COUNT(DISTINCT pcr.person_id) as people_with_places,
  COUNT(DISTINCT ppr.place_id) as distinct_places
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
JOIN trapper.sot_people p ON p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL
JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM trapper.cat_place_relationships cpr
  WHERE cpr.cat_id = pcr.cat_id
)
GROUP BY pcr.relationship_type
ORDER BY fixable_cats DESC;

\echo ''
\echo '1c. Specific cat check — microchip 981020053820871:'

SELECT
  c.cat_id,
  c.display_name,
  pcr.relationship_type as person_cat_type,
  p.display_name as person_name,
  ppr.role as person_place_role,
  pl.formatted_address as place_address,
  EXISTS(SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id) as has_place_link
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = c.cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = pcr.person_id
LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
LEFT JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
WHERE ci.id_value = '981020053820871';

\echo ''
\echo '1d. Current cat_place_relationships count (baseline):'

SELECT COUNT(*) as total_cat_place_links FROM trapper.cat_place_relationships;

-- ============================================================================
-- PHASE 2: UPDATE link_cat_to_place() — Add person_relationship evidence type
-- ============================================================================

\echo ''
\echo 'PHASE 2: Update link_cat_to_place() allowed evidence types'

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
        'owner_address', 'request_match', 'clinic_linking',
        'person_relationship'
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
Rejects merged entities, invalid types, and missing evidence. All cat-place writes MUST use this function.
MIG_870: Added person_relationship to allowed evidence types.';

\echo '  -> link_cat_to_place() updated with person_relationship evidence type'

-- ============================================================================
-- PHASE 3: EXPAND link_cats_to_places() — Handle all eligible relationship types
-- ============================================================================

\echo ''
\echo 'PHASE 3: Expanding link_cats_to_places() for all eligible types'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE(cats_linked_home INT, cats_linked_appointment INT, total_edges INT)
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
    --   owner            → home        (high confidence)
    --   caretaker        → residence   (medium confidence)
    --   foster           → home        (medium confidence)
    --   adopter          → home        (high confidence)
    --   colony_caretaker → colony_member (medium confidence)
    --
    -- Excluded types (don't imply cat resides at person's place):
    --   brought_in_by, rescuer, former_owner, former_foster, former_adopter

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
            AND ppr.role IN ('resident', 'owner')  -- INV-12: only residential/ownership roles
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
    cats_linked_appointment := 0; -- Deferred
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION trapper.link_cats_to_places IS
'MIG_870: Links cats to places via person_cat + person_place relationships.
Handles owner, caretaker, foster, adopter, colony_caretaker types.
Safety filters (INV-12): excludes system accounts, staff/trapper roles,
and non-residential place roles (only resident/owner propagate).
Uses link_cat_to_place() gatekeeper (INV-10). Merge-aware (INV-8).
Called as Step 8 in run_all_entity_linking() pipeline — runs on every ingestion.';

\echo '  -> link_cats_to_places() expanded for caretaker, foster, adopter, colony_caretaker'

-- ============================================================================
-- PHASE 4: ADD TO PIPELINE — Step 8 in run_all_entity_linking()
-- ============================================================================

\echo ''
\echo 'PHASE 4: Adding link_cats_to_places() as Step 8 in pipeline'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Step 1: Link appointments to owners (creates people + person_id on appointments)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_updated FROM trapper.link_appointments_to_owners()), 0);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Cat-place linking (cats → places via microchip + owner chain from staged_records)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT cats_linked FROM trapper.run_cat_place_linking()), 0);
    operation := 'run_cat_place_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_cat_place_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Appointment trapper linking
  BEGIN
    SELECT INTO v_count COALESCE(trapper.run_appointment_trapper_linking(), 0);
    operation := 'run_appointment_trapper_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_appointment_trapper_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link appointments to partner orgs
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_linked FROM trapper.link_all_appointments_to_partner_orgs()), 0);
    operation := 'link_all_appointments_to_partner_orgs'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_all_appointments_to_partner_orgs (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 5: Link cats to requests via attribution windows
  BEGIN
    SELECT INTO v_count COALESCE((SELECT linked FROM trapper.link_cats_to_requests_safe()), 0);
    operation := 'link_cats_to_requests_safe'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_requests_safe (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: Infer appointment places from person→place relationships
  BEGIN
    WITH inferred AS (
      UPDATE trapper.sot_appointments a
      SET place_id = ppr.place_id
      FROM trapper.person_place_relationships ppr
      WHERE a.person_id = ppr.person_id
        AND a.place_id IS NULL
        AND ppr.place_id IS NOT NULL
      RETURNING a.appointment_id
    )
    SELECT INTO v_count COUNT(*) FROM inferred;
    operation := 'infer_appointment_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7: Create person-cat relationships from linked appointments
  BEGIN
    WITH missing_rels AS (
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      )
      SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
        'clinichq', 'appointments'
      FROM trapper.sot_appointments a
      WHERE a.person_id IS NOT NULL
        AND a.cat_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
        )
      ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
      RETURNING person_id
    )
    SELECT INTO v_count COUNT(*) FROM missing_rels;
    operation := 'create_person_cat_relationships'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'create_person_cat_relationships (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 8 (NEW MIG_870): Propagate person_cat + person_place → cat_place
  -- This closes the gap where cats linked to people (caretaker, foster, etc.)
  -- were not linked to those peoples' places. Runs AFTER Step 7 creates
  -- person_cat relationships, so new ingestions are covered automatically.
  BEGIN
    SELECT INTO v_count COALESCE((SELECT total_edges FROM trapper.link_cats_to_places()), 0);
    operation := 'link_cats_to_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
  'MIG_870: Orchestrates all entity linking steps with fault tolerance. '
  'Step 8 (NEW): link_cats_to_places() propagates person_cat + person_place → cat_place '
  'for owner, caretaker, foster, adopter, colony_caretaker. Runs on every ingestion cycle.';

\echo '  -> run_all_entity_linking() updated with Step 8: link_cats_to_places()'

-- ============================================================================
-- PHASE 5: BACKFILL — Run the function to create missing links
-- ============================================================================

\echo ''
\echo 'PHASE 5: BACKFILL — Running link_cats_to_places()'

SELECT * FROM trapper.link_cats_to_places();

-- ============================================================================
-- PHASE 6: VERIFICATION
-- ============================================================================

\echo ''
\echo 'PHASE 6: VERIFICATION'
\echo ''

\echo '6a. Specific cat check — microchip 981020053820871:'

SELECT
  c.cat_id,
  c.display_name,
  cpr.relationship_type as cat_place_type,
  cpr.confidence,
  cpr.evidence->>'person_cat_type' as person_cat_type,
  pl.formatted_address as place_address
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE ci.id_value = '981020053820871';

\echo ''
\echo '6b. Post-backfill cat_place_relationships count:'

SELECT COUNT(*) as total_cat_place_links FROM trapper.cat_place_relationships;

\echo ''
\echo '6c. Remaining cats with person_cat but no cat_place (should be lower):'

SELECT
  pcr.relationship_type,
  COUNT(DISTINCT pcr.cat_id) as cats_still_without_places
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
JOIN trapper.sot_people p ON p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL
WHERE pcr.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
AND NOT EXISTS (
  SELECT 1 FROM trapper.cat_place_relationships cpr
  WHERE cpr.cat_id = pcr.cat_id
)
GROUP BY pcr.relationship_type
ORDER BY cats_still_without_places DESC;

\echo ''
\echo '6d. Top 20 places by cat count (pollution check — compare against MIG_868 baseline):'

SELECT
  pl.formatted_address,
  COUNT(DISTINCT cpr.cat_id) as cat_count,
  CASE
    WHEN opm.org_display_name IS NOT NULL THEN 'ORG'
    ELSE 'RESIDENTIAL'
  END as place_type
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id AND pl.merged_into_place_id IS NULL
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.organization_place_mappings opm ON opm.place_id = pl.place_id AND opm.auto_link_enabled = TRUE
GROUP BY pl.formatted_address, opm.org_display_name
ORDER BY cat_count DESC
LIMIT 20;

\echo ''
\echo '6e. New links created by person_cat type (breakdown):'

SELECT
  cpr.evidence->>'person_cat_type' as person_cat_type,
  COUNT(*) as links_created
FROM trapper.cat_place_relationships cpr
WHERE cpr.source_table = 'link_cats_to_places'
  AND cpr.evidence->>'link_method' = 'person_cat_to_place'
GROUP BY cpr.evidence->>'person_cat_type'
ORDER BY links_created DESC;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_870 Complete (DQ_003)'
\echo '=================================================='
\echo ''
\echo 'What changed:'
\echo '  1. link_cat_to_place(): Added person_relationship evidence type'
\echo '  2. link_cats_to_places(): Expanded from owner-only to include'
\echo '     caretaker, foster, adopter, colony_caretaker'
\echo '  3. run_all_entity_linking(): Added Step 8 — link_cats_to_places()'
\echo '     This runs on EVERY ingestion cycle automatically.'
\echo '  4. Backfill: Created missing cat_place links for existing data'
\echo ''
\echo 'Pipeline flow (stable across future ingestions):'
\echo '  Step 7: create_person_cat_relationships (from appointments)'
\echo '  Step 8: link_cats_to_places (propagates person_cat → cat_place)'
\echo ''
\echo 'North Star compliance:'
\echo '  INV-1:  Additive only (no deletions)'
\echo '  INV-4:  Full provenance (evidence_type + person_cat_type in JSONB)'
\echo '  INV-6:  Existing 7 pipeline steps untouched'
\echo '  INV-8:  All queries filter merged_into_*_id IS NULL'
\echo '  INV-10: All writes through link_cat_to_place() gatekeeper'
\echo '  INV-12: brought_in_by and rescuer excluded (no false residency)'
