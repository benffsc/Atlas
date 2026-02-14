\echo '=== MIG_711: Entity Summary Functions (Live AI Summaries) ==='

-- ============================================================
-- PERSON SUMMARY FUNCTION
-- Aggregates all data about a person with confidence filtering
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.get_person_summary(p_person_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'person_id', p.person_id,
    'display_name', p.display_name,
    'first_name', p.first_name,
    'last_name', p.last_name,

    -- Contact info (verified)
    'contact', jsonb_build_object(
      'emails', (SELECT COALESCE(jsonb_agg(DISTINCT pi.id_value), '[]'::jsonb)
                 FROM trapper.person_identifiers pi
                 WHERE pi.person_id = p.person_id AND pi.id_type = 'email'),
      'phones', (SELECT COALESCE(jsonb_agg(DISTINCT pi.id_value), '[]'::jsonb)
                 FROM trapper.person_identifiers pi
                 WHERE pi.person_id = p.person_id AND pi.id_type = 'phone')
    ),

    -- Roles (verified)
    'roles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'role', pr.role_type,
                'is_ffsc', pr.is_ffsc_affiliated,
                'active', pr.ended_at IS NULL
              )), '[]'::jsonb)
              FROM trapper.person_roles pr
              WHERE pr.person_id = p.person_id),

    -- AI-extracted attributes with confidence levels
    'attributes', jsonb_build_object(
      'high_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'person' AND ea.entity_id = p.person_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.8
      ),
      'medium_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'person' AND ea.entity_id = p.person_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.5 AND ea.confidence < 0.8
      ),
      'low_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'person' AND ea.entity_id = p.person_id
          AND ea.superseded_at IS NULL AND ea.confidence < 0.5
      )
    ),

    -- Alerts (high-priority flags that should always show)
    'alerts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', ea.attribute_key,
        'value', ea.attribute_value,
        'confidence', ea.confidence,
        'source_text', ea.source_text
      )), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'person' AND ea.entity_id = p.person_id
        AND ea.superseded_at IS NULL
        AND ea.attribute_key IN ('safety_concern')
        AND ea.attribute_value::text = 'true'
    ),

    -- Request history
    'request_history', jsonb_build_object(
      'total_requests', (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id),
      'active_requests', (SELECT COUNT(*) FROM trapper.sot_requests r
                          WHERE r.requester_person_id = p.person_id
                          AND r.status IN ('new','triaged','scheduled','in_progress')),
      'as_trapper', (SELECT COUNT(DISTINCT rta.request_id) FROM trapper.request_trapper_assignments rta
                     WHERE rta.person_id = p.person_id),
      'service_zones', (SELECT COALESCE(jsonb_agg(DISTINCT pl.service_zone), '[]'::jsonb)
                        FROM trapper.sot_requests r
                        JOIN trapper.places pl ON pl.place_id = r.place_id
                        WHERE r.requester_person_id = p.person_id)
    ),

    -- Clinic history (cats brought in)
    'clinic_history', jsonb_build_object(
      'cats_brought', (SELECT COUNT(DISTINCT pcr.cat_id)
                       FROM trapper.person_cat_relationships pcr
                       WHERE pcr.person_id = p.person_id AND pcr.relationship_type = 'brought_in_by'),
      'cats_owned', (SELECT COUNT(DISTINCT pcr.cat_id)
                     FROM trapper.person_cat_relationships pcr
                     WHERE pcr.person_id = p.person_id AND pcr.relationship_type = 'owner'),
      'last_clinic_activity', (SELECT MAX(a.appointment_date)
                               FROM trapper.sot_appointments a
                               JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = a.cat_id
                               WHERE pcr.person_id = p.person_id)
    ),

    -- Place associations
    'places', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'place_id', ppr.place_id,
        'address', pl.formatted_address,
        'relationship', ppr.relationship_type,
        'is_primary', ppr.is_primary
      )), '[]'::jsonb)
      FROM trapper.person_place_relationships ppr
      JOIN trapper.places pl ON pl.place_id = ppr.place_id
      WHERE ppr.person_id = p.person_id AND ppr.ended_at IS NULL
    ),

    -- Google Maps mentions (within 200m of their places)
    'google_maps_mentions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'entry_id', g.entry_id,
        'name', g.kml_name,
        'classification', g.ai_meaning,
        'summary', LEFT(COALESCE(g.ai_summary, g.original_content), 200)
      )), '[]'::jsonb)
      FROM trapper.google_map_entries g
      WHERE g.linked_person_id = p.person_id
         OR (g.ai_classification->'signals'->'person_names' IS NOT NULL
             AND g.ai_classification->'signals'->'person_names' @> to_jsonb(p.display_name))
      LIMIT 5
    ),

    -- Data sources (for transparency)
    'data_sources', (
      SELECT COALESCE(jsonb_agg(DISTINCT ea.source_system), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'person' AND ea.entity_id = p.person_id AND ea.superseded_at IS NULL
    ),

    -- Metadata
    'created_at', p.created_at,
    'merged_from', (SELECT COALESCE(jsonb_agg(m.person_id), '[]'::jsonb)
                    FROM trapper.sot_people m WHERE m.merged_into_person_id = p.person_id)

  ) INTO v_result
  FROM trapper.sot_people p
  WHERE p.person_id = p_person_id AND p.merged_into_person_id IS NULL;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_person_summary(UUID) IS
'Returns comprehensive summary of a person with AI-extracted attributes grouped by confidence level. Use for person detail pages and Tippy queries.';

-- ============================================================
-- PLACE SUMMARY FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.get_place_summary(p_place_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'place_id', p.place_id,
    'formatted_address', p.formatted_address,
    'service_zone', p.service_zone,
    'location', jsonb_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry)),

    -- AI-extracted attributes with confidence levels
    'attributes', jsonb_build_object(
      'high_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.8
      ),
      'medium_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.5 AND ea.confidence < 0.8
      ),
      'low_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
          AND ea.superseded_at IS NULL AND ea.confidence < 0.5
      )
    ),

    -- Alerts (disease, safety)
    'alerts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', ea.attribute_key,
        'value', ea.attribute_value,
        'confidence', ea.confidence,
        'source_text', ea.source_text
      )), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
        AND ea.superseded_at IS NULL
        AND ea.attribute_key IN ('has_disease_history', 'has_hostile_environment')
        AND ea.attribute_value::text = 'true'
    ),

    -- Request history
    'request_history', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = p.place_id),
      'active', (SELECT COUNT(*) FROM trapper.sot_requests r
                 WHERE r.place_id = p.place_id AND r.status IN ('new','triaged','scheduled','in_progress')),
      'completed', (SELECT COUNT(*) FROM trapper.sot_requests r
                    WHERE r.place_id = p.place_id AND r.status = 'completed')
    ),

    -- Clinic history
    'clinic_history', jsonb_build_object(
      'cats_linked', (SELECT COUNT(DISTINCT cpr.cat_id) FROM trapper.cat_place_relationships cpr
                      WHERE cpr.place_id = p.place_id),
      'appointments_6mo', (SELECT COUNT(*) FROM trapper.sot_appointments a
                           JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
                           WHERE cpr.place_id = p.place_id
                           AND a.appointment_date > NOW() - INTERVAL '6 months'),
      'last_clinic_visit', (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a
                            JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
                            WHERE cpr.place_id = p.place_id)
    ),

    -- Google Maps context
    'google_maps_context', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'entry_id', g.entry_id,
        'name', g.kml_name,
        'classification', g.ai_meaning,
        'summary', LEFT(COALESCE(g.ai_summary, g.original_content), 200),
        'distance_m', ST_Distance(ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography, p.location::geography)::INT
      ) ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography, p.location::geography)), '[]'::jsonb)
      FROM trapper.google_map_entries g
      WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography, p.location::geography, 200)
      LIMIT 5
    ),

    -- People associated
    'people', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'person_id', pe.person_id,
        'name', pe.display_name,
        'relationship', ppr.relationship_type,
        'is_primary', ppr.is_primary
      )), '[]'::jsonb)
      FROM trapper.person_place_relationships ppr
      JOIN trapper.sot_people pe ON pe.person_id = ppr.person_id
      WHERE ppr.place_id = p.place_id AND ppr.ended_at IS NULL
    ),

    -- Colony estimates if available
    'colony_estimate', (
      SELECT jsonb_build_object(
        'total_cats', ce.total_cats,
        'altered_cats', ce.altered_cats,
        'alteration_rate', ce.alteration_rate,
        'observation_date', ce.observation_date,
        'source', ce.source_type
      )
      FROM trapper.place_colony_estimates ce
      WHERE ce.place_id = p.place_id
      ORDER BY ce.observation_date DESC LIMIT 1
    ),

    -- Historical conditions (ecological layer)
    'historical_conditions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'condition', pch.condition_type,
        'severity', pch.severity,
        'valid_from', pch.valid_from,
        'valid_to', pch.valid_to,
        'outcome', pch.outcome,
        'is_current', pch.valid_to IS NULL
      ) ORDER BY pch.valid_from DESC), '[]'::jsonb)
      FROM trapper.place_condition_history pch
      WHERE pch.place_id = p.place_id AND pch.superseded_at IS NULL
    ),

    -- Data sources
    'data_sources', (
      SELECT COALESCE(jsonb_agg(DISTINCT ea.source_system), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id AND ea.superseded_at IS NULL
    )

  ) INTO v_result
  FROM trapper.places p
  WHERE p.place_id = p_place_id AND p.merged_into_place_id IS NULL;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_place_summary(UUID) IS
'Returns comprehensive summary of a place with AI-extracted attributes grouped by confidence level. Includes historical conditions and Google Maps context.';

-- ============================================================
-- CAT SUMMARY FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.get_cat_summary(p_cat_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'cat_id', c.cat_id,
    'display_name', c.display_name,
    'altered_status', c.altered_status,
    'sex', c.sex,
    'breed', c.breed,
    'color', c.color,

    -- Microchips
    'microchips', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'chip', ci.id_value,
        'type', ci.id_type
      )), '[]'::jsonb)
      FROM trapper.cat_identifiers ci
      WHERE ci.cat_id = c.cat_id AND ci.id_type LIKE 'microchip%'
    ),

    -- AI-extracted attributes
    'attributes', jsonb_build_object(
      'high_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.8
      ),
      'medium_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
          AND ea.superseded_at IS NULL AND ea.confidence >= 0.5 AND ea.confidence < 0.8
      ),
      'low_confidence', (
        SELECT COALESCE(jsonb_object_agg(
          ea.attribute_key,
          jsonb_build_object('value', ea.attribute_value, 'confidence', ea.confidence, 'source', ea.source_system)
        ), '{}'::jsonb)
        FROM trapper.entity_attributes ea
        WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
          AND ea.superseded_at IS NULL AND ea.confidence < 0.5
      )
    ),

    -- Alerts (disease)
    'alerts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', ea.attribute_key,
        'value', ea.attribute_value,
        'confidence', ea.confidence,
        'source_text', ea.source_text
      )), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
        AND ea.superseded_at IS NULL
        AND ea.attribute_key IN ('has_disease', 'disease_type')
        AND (ea.attribute_value::text = 'true' OR ea.attribute_key = 'disease_type')
    ),

    -- Appointment history
    'appointments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', a.appointment_date,
        'procedures', a.procedures,
        'notes_preview', LEFT(a.medical_notes, 100)
      ) ORDER BY a.appointment_date DESC), '[]'::jsonb)
      FROM trapper.sot_appointments a
      WHERE a.cat_id = c.cat_id
      LIMIT 10
    ),

    -- People relationships
    'people', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'person_id', pe.person_id,
        'name', pe.display_name,
        'relationship', pcr.relationship_type,
        'first_seen', pcr.first_seen_at
      )), '[]'::jsonb)
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.sot_people pe ON pe.person_id = pcr.person_id
      WHERE pcr.cat_id = c.cat_id
    ),

    -- Places
    'places', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'place_id', pl.place_id,
        'address', pl.formatted_address,
        'relationship', cpr.relationship_type
      )), '[]'::jsonb)
      FROM trapper.cat_place_relationships cpr
      JOIN trapper.places pl ON pl.place_id = cpr.place_id
      WHERE cpr.cat_id = c.cat_id
    ),

    -- Data sources
    'data_sources', (
      SELECT COALESCE(jsonb_agg(DISTINCT ea.source_system), '[]'::jsonb)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id AND ea.superseded_at IS NULL
    )

  ) INTO v_result
  FROM trapper.sot_cats c
  WHERE c.cat_id = p_cat_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_cat_summary(UUID) IS
'Returns comprehensive summary of a cat with AI-extracted attributes grouped by confidence level.';

-- ============================================================
-- TIPPY-FRIENDLY TEXT SUMMARY GENERATOR
-- Returns human-readable summary for any entity
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.generate_entity_text_summary(
  p_entity_type TEXT,
  p_entity_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_summary TEXT := '';
  v_data JSONB;
BEGIN
  -- Get the appropriate summary
  CASE p_entity_type
    WHEN 'person' THEN
      v_data := trapper.get_person_summary(p_entity_id);
      v_summary := format(E'**%s**\n', v_data->>'display_name');

      -- Roles
      IF jsonb_array_length(v_data->'roles') > 0 THEN
        v_summary := v_summary || 'Roles: ' || (
          SELECT string_agg(r->>'role', ', ')
          FROM jsonb_array_elements(v_data->'roles') r
          WHERE (r->>'active')::boolean = true
        ) || E'\n';
      END IF;

      -- High-confidence attributes
      IF v_data->'attributes'->'high_confidence' != '{}'::jsonb THEN
        v_summary := v_summary || E'\nVerified info:\n';
        SELECT v_summary || string_agg(
          '- ' || key || ': ' || (value->>'value'),
          E'\n'
        ) INTO v_summary
        FROM jsonb_each(v_data->'attributes'->'high_confidence');
      END IF;

      -- Alerts
      IF jsonb_array_length(v_data->'alerts') > 0 THEN
        v_summary := v_summary || E'\n**ALERTS:**\n';
        SELECT v_summary || string_agg(
          '- ' || (a->>'type') || ': ' || (a->>'source_text'),
          E'\n'
        ) INTO v_summary
        FROM jsonb_array_elements(v_data->'alerts') a;
      END IF;

      -- Stats
      v_summary := v_summary || format(
        E'\nActivity: %s requests (%s active), %s cats brought to clinic',
        v_data->'request_history'->>'total_requests',
        v_data->'request_history'->>'active_requests',
        v_data->'clinic_history'->>'cats_brought'
      );

    WHEN 'place' THEN
      v_data := trapper.get_place_summary(p_entity_id);
      v_summary := format(E'**%s**\n', v_data->>'formatted_address');
      v_summary := v_summary || format('Zone: %s', v_data->>'service_zone');

      -- Alerts first
      IF jsonb_array_length(v_data->'alerts') > 0 THEN
        v_summary := v_summary || E'\n\n**ALERTS:**\n';
        SELECT v_summary || string_agg(
          '- ' || (a->>'type'),
          E'\n'
        ) INTO v_summary
        FROM jsonb_array_elements(v_data->'alerts') a;
      END IF;

      -- High-confidence attributes
      IF v_data->'attributes'->'high_confidence' != '{}'::jsonb THEN
        v_summary := v_summary || E'\n\nVerified info:\n';
        SELECT v_summary || string_agg(
          '- ' || key || ': ' || (value->>'value'),
          E'\n'
        ) INTO v_summary
        FROM jsonb_each(v_data->'attributes'->'high_confidence');
      END IF;

      -- Stats
      v_summary := v_summary || format(
        E'\n\nHistory: %s requests (%s active), %s cats linked, %s clinic visits (6mo)',
        v_data->'request_history'->>'total',
        v_data->'request_history'->>'active',
        v_data->'clinic_history'->>'cats_linked',
        v_data->'clinic_history'->>'appointments_6mo'
      );

    WHEN 'cat' THEN
      v_data := trapper.get_cat_summary(p_entity_id);
      v_summary := format(E'**%s** (%s)\n', v_data->>'display_name', v_data->>'altered_status');

      -- Alerts
      IF jsonb_array_length(v_data->'alerts') > 0 THEN
        v_summary := v_summary || E'\n**ALERTS:**\n';
        SELECT v_summary || string_agg(
          '- ' || (a->>'type') || ': ' || (a->>'value'),
          E'\n'
        ) INTO v_summary
        FROM jsonb_array_elements(v_data->'alerts') a;
      END IF;

      -- Basic info
      IF v_data->>'sex' IS NOT NULL THEN
        v_summary := v_summary || format(E'\nSex: %s', v_data->>'sex');
      END IF;

      v_summary := v_summary || format(
        E'\nAppointments: %s',
        jsonb_array_length(v_data->'appointments')
      );

    ELSE
      v_summary := 'Unknown entity type: ' || p_entity_type;
  END CASE;

  -- Add confidence warning if there's medium confidence data
  IF v_data->'attributes'->'medium_confidence' IS NOT NULL
     AND v_data->'attributes'->'medium_confidence' != '{}'::jsonb THEN
    v_summary := v_summary || E'\n\n_Some additional info available with lower confidence._';
  END IF;

  RETURN v_summary;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.generate_entity_text_summary(TEXT, UUID) IS
'Generates human-readable text summary for Tippy responses. Includes alerts and verified info, warns about lower-confidence data.';

\echo '=== MIG_711 Complete ==='
