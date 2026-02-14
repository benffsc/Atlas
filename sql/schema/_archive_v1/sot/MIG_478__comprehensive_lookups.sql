-- =====================================================
-- MIG_478: Comprehensive Lookup Functions
-- =====================================================
-- Enables Tippy to trace the full data graph across ALL sources
-- Person, Cat, and Place lookups that traverse:
-- - SOT tables (canonical data)
-- - ClinicHQ (appointments, procedures)
-- - ShelterLuv (adoptions, fosters, outcomes)
-- - Volunteer Hub (volunteer status)
-- - Airtable (historical data)
-- =====================================================

\echo '=========================================='
\echo 'MIG_478: Comprehensive Lookup Functions'
\echo '=========================================='

-- -----------------------------------------------------
-- Function: comprehensive_person_lookup
-- -----------------------------------------------------
-- Traces: email/phone/name → person → ALL connected data

CREATE OR REPLACE FUNCTION trapper.comprehensive_person_lookup(
  p_identifier TEXT,
  p_identifier_type TEXT DEFAULT 'auto'
) RETURNS JSONB AS $$
DECLARE
  v_person_id UUID;
  v_result JSONB;
BEGIN
  -- 1. Find person by identifier
  IF p_identifier_type = 'email' OR (p_identifier_type = 'auto' AND p_identifier LIKE '%@%') THEN
    SELECT person_id INTO v_person_id
    FROM trapper.person_identifiers
    WHERE id_type = 'email' AND id_value_norm = LOWER(TRIM(p_identifier))
    LIMIT 1;
  ELSIF p_identifier_type = 'phone' OR (p_identifier_type = 'auto' AND p_identifier ~ '^[\d\-\(\)\s\.]+$') THEN
    SELECT person_id INTO v_person_id
    FROM trapper.person_identifiers
    WHERE id_type = 'phone' AND id_value_norm = trapper.norm_phone_us(p_identifier)
    LIMIT 1;
  ELSE
    -- Name search (fuzzy)
    SELECT person_id INTO v_person_id
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND (
        LOWER(display_name) LIKE '%' || LOWER(TRIM(p_identifier)) || '%'
        OR EXISTS (
          SELECT 1 FROM trapper.person_aliases pa
          WHERE pa.person_id = sot_people.person_id
            AND LOWER(pa.name_raw) LIKE '%' || LOWER(TRIM(p_identifier)) || '%'
        )
      )
    ORDER BY similarity(LOWER(display_name), LOWER(p_identifier)) DESC
    LIMIT 1;
  END IF;

  IF v_person_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'No person found with identifier: ' || p_identifier,
      'searched_as', CASE
        WHEN p_identifier LIKE '%@%' THEN 'email'
        WHEN p_identifier ~ '^[\d\-\(\)\s\.]+$' THEN 'phone'
        ELSE 'name'
      END
    );
  END IF;

  -- Follow merge chain to canonical person
  v_person_id := trapper.canonical_person_id(v_person_id);

  -- 2. Build comprehensive result
  SELECT jsonb_build_object(
    'found', true,
    'person_id', v_person_id,

    -- Basic person info
    'person', (
      SELECT jsonb_build_object(
        'display_name', p.display_name,
        'created_at', p.created_at,
        'identifiers', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'type', pi.id_type,
            'value', pi.id_value
          )), '[]'::jsonb)
          FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
        ),
        'aliases', (
          SELECT COALESCE(jsonb_agg(pa.name_raw), '[]'::jsonb)
          FROM trapper.person_aliases pa
          WHERE pa.person_id = p.person_id
        )
      )
      FROM trapper.sot_people p
      WHERE p.person_id = v_person_id
    ),

    -- Roles (trapper, foster, volunteer, adopter, etc.)
    'roles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'role', pr.role,
        'status', pr.role_status,
        'source', pr.source_system,
        'started_at', pr.started_at,
        'notes', pr.notes
      )), '[]'::jsonb)
      FROM trapper.person_roles pr
      WHERE pr.person_id = v_person_id
    ),

    -- Connected cats (all relationships)
    'cats', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'cat_id', c.cat_id,
        'name', c.display_name,
        'relationship', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source', pcr.source_system,
        'microchip', (
          SELECT ci.id_value
          FROM trapper.cat_identifiers ci
          WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
          LIMIT 1
        )
      )), '[]'::jsonb)
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
      WHERE pcr.person_id = v_person_id
    ),

    -- Connected places
    'places', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'place_id', pl.place_id,
        'address', pl.label,
        'role', ppr.role,
        'source', ppr.source_system
      )), '[]'::jsonb)
      FROM trapper.person_place_relationships ppr
      JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
      WHERE ppr.person_id = v_person_id
    ),

    -- Requests as requester
    'requests_as_requester', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', r.request_id,
        'address', r.short_address,
        'status', r.status,
        'created_at', r.created_at,
        'cats_attributed', (
          SELECT COUNT(*) FROM trapper.v_request_alteration_stats ras
          WHERE ras.request_id = r.request_id
        )
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM trapper.sot_requests r
      WHERE r.requester_person_id = v_person_id
    ),

    -- Requests as trapper
    'requests_as_trapper', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', rta.request_id,
        'address', r.short_address,
        'status', r.status,
        'is_primary', rta.is_primary,
        'assigned_at', rta.assigned_at
      ) ORDER BY rta.assigned_at DESC), '[]'::jsonb)
      FROM trapper.request_trapper_assignments rta
      JOIN trapper.sot_requests r ON r.request_id = rta.request_id
      WHERE rta.trapper_person_id = v_person_id
        AND rta.unassigned_at IS NULL
    ),

    -- Clinic appointments (as owner or trapper)
    'clinic_appointments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'appointment_id', a.appointment_id,
        'date', a.appointment_date,
        'cat_name', c.display_name,
        'role', CASE
          WHEN a.trapper_person_id = v_person_id THEN 'trapper'
          ELSE 'owner'
        END,
        'procedures', a.procedures
      ) ORDER BY a.appointment_date DESC), '[]'::jsonb)
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      WHERE a.person_id = v_person_id OR a.trapper_person_id = v_person_id
      LIMIT 25
    ),

    -- Volunteer Hub info
    'volunteer_hub', (
      SELECT jsonb_build_object(
        'status', vh.status,
        'hours_logged', vh.hours_logged,
        'last_activity', vh.last_activity_at,
        'roles', vh.roles,
        'joined_at', vh.joined_at
      )
      FROM trapper.volunteerhub_volunteers vh
      WHERE vh.matched_person_id = v_person_id
      LIMIT 1
    ),

    -- ShelterLuv activity summary
    'shelterluv_summary', (
      SELECT jsonb_build_object(
        'adoption_count', COUNT(*) FILTER (WHERE pcr.relationship_type = 'adopter'),
        'foster_count', COUNT(*) FILTER (WHERE pcr.relationship_type = 'fosterer')
      )
      FROM trapper.person_cat_relationships pcr
      WHERE pcr.person_id = v_person_id
        AND pcr.source_system = 'shelterluv'
    ),

    -- Staff record if exists
    'staff_info', (
      SELECT jsonb_build_object(
        'staff_id', s.staff_id,
        'role', s.role,
        'department', s.department,
        'is_active', s.is_active
      )
      FROM trapper.staff s
      WHERE s.person_id = v_person_id
      LIMIT 1
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.comprehensive_person_lookup IS 'Get complete information about a person by tracing all data sources';

-- -----------------------------------------------------
-- Function: comprehensive_cat_lookup
-- -----------------------------------------------------
-- Traces: microchip/name/id → cat → ALL connected data

CREATE OR REPLACE FUNCTION trapper.comprehensive_cat_lookup(
  p_identifier TEXT,
  p_identifier_type TEXT DEFAULT 'auto'
) RETURNS JSONB AS $$
DECLARE
  v_cat_id UUID;
  v_result JSONB;
BEGIN
  -- 1. Find cat by identifier
  IF p_identifier_type = 'microchip' OR (p_identifier_type = 'auto' AND p_identifier ~ '^[\d]{9,15}$') THEN
    SELECT cat_id INTO v_cat_id
    FROM trapper.cat_identifiers
    WHERE id_type = 'microchip' AND id_value = TRIM(p_identifier)
    LIMIT 1;
  ELSIF p_identifier_type = 'clinichq_id' THEN
    SELECT cat_id INTO v_cat_id
    FROM trapper.cat_identifiers
    WHERE id_type = 'clinichq_animal_id' AND id_value = TRIM(p_identifier)
    LIMIT 1;
  ELSIF p_identifier_type = 'shelterluv_id' THEN
    SELECT cat_id INTO v_cat_id
    FROM trapper.cat_identifiers
    WHERE id_type = 'shelterluv_animal_id' AND id_value = TRIM(p_identifier)
    LIMIT 1;
  ELSE
    -- Name search
    SELECT cat_id INTO v_cat_id
    FROM trapper.sot_cats
    WHERE merged_into_cat_id IS NULL
      AND LOWER(display_name) LIKE '%' || LOWER(TRIM(p_identifier)) || '%'
    ORDER BY similarity(LOWER(display_name), LOWER(p_identifier)) DESC
    LIMIT 1;
  END IF;

  IF v_cat_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'No cat found with identifier: ' || p_identifier,
      'searched_as', COALESCE(p_identifier_type, 'auto')
    );
  END IF;

  -- Follow merge chain
  v_cat_id := trapper.canonical_cat_id(v_cat_id);

  -- 2. Build comprehensive result
  SELECT jsonb_build_object(
    'found', true,
    'cat_id', v_cat_id,

    -- Basic cat info
    'cat', (
      SELECT jsonb_build_object(
        'display_name', c.display_name,
        'sex', c.sex,
        'breed', c.breed,
        'primary_color', c.primary_color,
        'altered_status', c.altered_status,
        'notes', c.notes,
        'created_at', c.created_at
      )
      FROM trapper.sot_cats c
      WHERE c.cat_id = v_cat_id
    ),

    -- All identifiers
    'identifiers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', ci.id_type,
        'value', ci.id_value,
        'source', ci.source_system
      )), '[]'::jsonb)
      FROM trapper.cat_identifiers ci
      WHERE ci.cat_id = v_cat_id
    ),

    -- Connected people (owners, trappers, fosters, adopters)
    'people', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'person_id', p.person_id,
        'name', p.display_name,
        'relationship', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source', pcr.source_system,
        'email', (
          SELECT pi.id_value FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
          LIMIT 1
        )
      )), '[]'::jsonb)
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.sot_people p ON p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL
      WHERE pcr.cat_id = v_cat_id
    ),

    -- Connected places
    'places', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'place_id', pl.place_id,
        'address', pl.label,
        'relationship', cpr.relationship_type,
        'confidence', cpr.confidence
      )), '[]'::jsonb)
      FROM trapper.cat_place_relationships cpr
      JOIN trapper.places pl ON pl.place_id = cpr.place_id AND pl.merged_into_place_id IS NULL
      WHERE cpr.cat_id = v_cat_id
    ),

    -- Clinic appointments
    'clinic_visits', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'appointment_id', a.appointment_id,
        'date', a.appointment_date,
        'owner_name', COALESCE(p.display_name, a.owner_name),
        'trapper_name', tp.display_name,
        'procedures', a.procedures,
        'felv_fiv_result', a.felv_fiv_result
      ) ORDER BY a.appointment_date DESC), '[]'::jsonb)
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
      LEFT JOIN trapper.sot_people tp ON tp.person_id = a.trapper_person_id
      WHERE a.cat_id = v_cat_id
    ),

    -- Request attributions
    'requests', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', ras.request_id,
        'address', r.short_address,
        'status', r.status,
        'confidence', ras.confidence
      )), '[]'::jsonb)
      FROM trapper.v_request_alteration_stats ras
      JOIN trapper.sot_requests r ON r.request_id = ras.request_id
      WHERE ras.cat_id = v_cat_id
    ),

    -- ShelterLuv data (from staged records)
    'shelterluv_data', (
      SELECT jsonb_build_object(
        'intake_date', sr.payload->>'Intake Date',
        'status', sr.payload->>'Status',
        'hold_for', sr.payload->>'Hold For',
        'age_months', sr.payload->>'Age (months)',
        'outcome_type', (
          SELECT o.payload->>'Outcome Type'
          FROM trapper.staged_records o
          WHERE o.source_system = 'shelterluv'
            AND o.source_table = 'outcomes'
            AND o.payload->>'Animal ID' = (
              SELECT ci.id_value FROM trapper.cat_identifiers ci
              WHERE ci.cat_id = v_cat_id AND ci.id_type = 'shelterluv_animal_id'
              LIMIT 1
            )
          LIMIT 1
        )
      )
      FROM trapper.staged_records sr
      WHERE sr.source_system = 'shelterluv'
        AND sr.source_table = 'animals'
        AND sr.source_row_id = (
          SELECT ci.id_value FROM trapper.cat_identifiers ci
          WHERE ci.cat_id = v_cat_id AND ci.id_type = 'shelterluv_animal_id'
          LIMIT 1
        )
      LIMIT 1
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.comprehensive_cat_lookup IS 'Get complete information about a cat by tracing all data sources';

-- -----------------------------------------------------
-- Function: comprehensive_place_lookup
-- -----------------------------------------------------
-- Traces: address → place → ALL activity at location

CREATE OR REPLACE FUNCTION trapper.comprehensive_place_lookup(
  p_address TEXT
) RETURNS JSONB AS $$
DECLARE
  v_place_id UUID;
  v_result JSONB;
BEGIN
  -- 1. Find place by address (fuzzy match on normalized)
  SELECT place_id INTO v_place_id
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND (
      LOWER(normalized_address) LIKE '%' || LOWER(TRIM(p_address)) || '%'
      OR LOWER(label) LIKE '%' || LOWER(TRIM(p_address)) || '%'
      OR LOWER(raw_address) LIKE '%' || LOWER(TRIM(p_address)) || '%'
    )
  ORDER BY
    CASE WHEN LOWER(normalized_address) = LOWER(TRIM(p_address)) THEN 0 ELSE 1 END,
    similarity(LOWER(label), LOWER(p_address)) DESC
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'No place found matching: ' || p_address
    );
  END IF;

  -- Follow merge chain
  v_place_id := trapper.canonical_place_id(v_place_id);

  -- 2. Build comprehensive result
  SELECT jsonb_build_object(
    'found', true,
    'place_id', v_place_id,

    -- Basic place info
    'place', (
      SELECT jsonb_build_object(
        'label', pl.label,
        'normalized_address', pl.normalized_address,
        'city', pl.city,
        'lat', pl.lat,
        'lng', pl.lng,
        'created_at', pl.created_at
      )
      FROM trapper.places pl
      WHERE pl.place_id = v_place_id
    ),

    -- Colony status
    'colony_status', (
      SELECT jsonb_build_object(
        'estimated_size', vcs.weighted_estimate,
        'alteration_rate', vcs.alteration_rate,
        'confirmed_altered', vcs.confirmed_altered,
        'last_observation', vcs.latest_observation_date,
        'estimate_confidence', vcs.estimate_confidence
      )
      FROM trapper.v_place_colony_status vcs
      WHERE vcs.place_id = v_place_id
    ),

    -- All cats at this location
    'cats', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'cat_id', c.cat_id,
        'name', c.display_name,
        'relationship', cpr.relationship_type,
        'altered_status', c.altered_status,
        'microchip', (
          SELECT ci.id_value FROM trapper.cat_identifiers ci
          WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
          LIMIT 1
        )
      )), '[]'::jsonb)
      FROM trapper.cat_place_relationships cpr
      JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
      WHERE cpr.place_id = v_place_id
    ),

    -- Connected people (residents, requesters, trappers)
    'people', (
      SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'person_id', p.person_id,
        'name', p.display_name,
        'role', ppr.role,
        'source', ppr.source_system
      )), '[]'::jsonb)
      FROM trapper.person_place_relationships ppr
      JOIN trapper.sot_people p ON p.person_id = ppr.person_id AND p.merged_into_person_id IS NULL
      WHERE ppr.place_id = v_place_id
    ),

    -- Requests at this location
    'requests', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', r.request_id,
        'status', r.status,
        'created_at', r.created_at,
        'resolved_at', r.resolved_at,
        'requester_name', p.display_name,
        'cats_attributed', (
          SELECT COUNT(*) FROM trapper.v_request_alteration_stats ras
          WHERE ras.request_id = r.request_id
        )
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM trapper.sot_requests r
      LEFT JOIN trapper.sot_people p ON p.person_id = r.requester_person_id
      WHERE r.place_id = v_place_id
    ),

    -- Trappers who have worked here
    'trappers', (
      SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'person_id', tp.person_id,
        'name', tp.display_name,
        'request_count', COUNT(rta.request_id)
      )), '[]'::jsonb)
      FROM trapper.request_trapper_assignments rta
      JOIN trapper.sot_requests r ON r.request_id = rta.request_id
      JOIN trapper.sot_people tp ON tp.person_id = rta.trapper_person_id
      WHERE r.place_id = v_place_id
      GROUP BY tp.person_id, tp.display_name
    ),

    -- Recent clinic appointments for cats from here
    'recent_clinic_visits', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', a.appointment_date,
        'cat_name', c.display_name,
        'procedures', a.procedures
      ) ORDER BY a.appointment_date DESC), '[]'::jsonb)
      FROM trapper.sot_appointments a
      JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
      JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      WHERE cpr.place_id = v_place_id
      LIMIT 20
    ),

    -- Web intake submissions for this address
    'intake_submissions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'submission_id', wis.submission_id,
        'status', wis.status,
        'call_type', wis.call_type,
        'estimated_cats', wis.estimated_cat_count,
        'submitted_at', wis.submitted_at
      ) ORDER BY wis.submitted_at DESC), '[]'::jsonb)
      FROM trapper.web_intake_submissions wis
      WHERE wis.place_id = v_place_id
         OR LOWER(wis.address) LIKE '%' || LOWER((
           SELECT normalized_address FROM trapper.places WHERE place_id = v_place_id
         )) || '%'
      LIMIT 10
    ),

    -- Colony estimates over time
    'colony_estimate_history', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', pce.observation_date,
        'estimate', pce.total_cats,
        'source', pce.source_type,
        'confidence', pce.confidence
      ) ORDER BY pce.observation_date DESC), '[]'::jsonb)
      FROM trapper.place_colony_estimates pce
      WHERE pce.place_id = v_place_id
      LIMIT 10
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.comprehensive_place_lookup IS 'Get complete information about a place by tracing all activity';

-- -----------------------------------------------------
-- Summary
-- -----------------------------------------------------

\echo ''
\echo 'Created functions:'
\echo '  - comprehensive_person_lookup(identifier, type): Full person data graph'
\echo '  - comprehensive_cat_lookup(identifier, type): Full cat journey'
\echo '  - comprehensive_place_lookup(address): Full place activity'
\echo ''
\echo 'These functions trace connections across:'
\echo '  - SOT tables (canonical people, cats, requests)'
\echo '  - ClinicHQ (appointments, procedures)'
\echo '  - ShelterLuv (adoptions, fosters, outcomes)'
\echo '  - Volunteer Hub (volunteer status)'
\echo '  - Web intake submissions'
\echo '  - Colony estimates'
\echo ''
\echo 'MIG_478 complete'
\echo '=========================================='
