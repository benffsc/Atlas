\echo '=== MIG_789: Fix comprehensive_place_lookup for Tippy ==='
\echo 'Adds: formatted_address search, entity_attributes, place_contexts'
\echo 'Fixes: Tippy could not look up "816 Santa Barbara Dr in Santa Rosa"'
\echo ''

-- Drop and recreate with improvements
CREATE OR REPLACE FUNCTION trapper.comprehensive_place_lookup(
  p_address TEXT
) RETURNS JSONB AS $$
DECLARE
  v_place_id UUID;
  v_result JSONB;
  v_search TEXT;
BEGIN
  -- Normalize search: strip "in <city>" suffix that users naturally add
  v_search := LOWER(TRIM(p_address));
  v_search := regexp_replace(v_search, '\s+in\s+(santa rosa|petaluma|rohnert park|cotati|sebastopol|sonoma|healdsburg|windsor|cloverdale|ukiah|novato|san rafael|napa)\s*$', '', 'i');
  v_search := TRIM(v_search);

  -- 1. Find place by address (search all address columns including formatted_address)
  SELECT place_id INTO v_place_id
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND (
      LOWER(normalized_address) LIKE '%' || v_search || '%'
      OR LOWER(label) LIKE '%' || v_search || '%'
      OR LOWER(raw_address) LIKE '%' || v_search || '%'
      OR LOWER(formatted_address) LIKE '%' || v_search || '%'
    )
  ORDER BY
    CASE WHEN LOWER(normalized_address) = v_search THEN 0 ELSE 1 END,
    similarity(LOWER(COALESCE(formatted_address, label)), v_search) DESC
  LIMIT 1;

  -- If no match, try similarity-based fuzzy search as fallback
  IF v_place_id IS NULL THEN
    SELECT place_id INTO v_place_id
    FROM trapper.places
    WHERE merged_into_place_id IS NULL
      AND (
        similarity(LOWER(COALESCE(formatted_address, label, normalized_address)), v_search) > 0.3
      )
    ORDER BY similarity(LOWER(COALESCE(formatted_address, label, normalized_address)), v_search) DESC
    LIMIT 1;
  END IF;

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
        'formatted_address', pl.formatted_address,
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

    -- AI-extracted attributes (from entity_attributes)
    'ai_attributes', (
      SELECT COALESCE(jsonb_object_agg(
        ea.attribute_key, jsonb_build_object(
          'value', ea.attribute_value,
          'confidence', ea.confidence,
          'source', ea.source_system,
          'extracted_at', ea.extracted_at
        )
      ), '{}'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'place'
        AND ea.entity_id = v_place_id
        AND ea.superseded_at IS NULL
    ),

    -- Place contexts (colony_site, foster_home, etc.)
    'contexts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'context_type', pc.context_type,
        'evidence_summary', pc.evidence_summary,
        'confidence', pc.confidence,
        'valid_from', pc.valid_from,
        'source', pc.source_system
      )), '[]'::jsonb)
      FROM trapper.place_contexts pc
      WHERE pc.place_id = v_place_id
        AND pc.valid_to IS NULL
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

\echo ''
\echo '=== MIG_789 Complete ==='
\echo 'comprehensive_place_lookup now:'
\echo '  - Searches formatted_address column'
\echo '  - Strips "in <city>" from natural language queries'
\echo '  - Falls back to similarity() fuzzy matching'
\echo '  - Returns AI-extracted entity_attributes'
\echo '  - Returns place_contexts (colony_site, etc.)'
