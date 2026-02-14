\echo '=== MIG_726: Tippy Cat and Place Context Functions ==='

-- ============================================================
-- Comprehensive cat lookup by microchip or name
-- Cross-references clinic data with Google Maps history
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.tippy_cat_lookup(
  p_microchip TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
)
RETURNS TABLE (
  cat_id UUID,
  microchip TEXT,
  cat_name TEXT,
  place_address TEXT,
  place_id UUID,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  clinic_visits INT,
  first_clinic_visit DATE,
  last_clinic_visit DATE,
  was_spayed_neutered BOOLEAN,
  spay_neuter_date DATE,
  google_maps_context TEXT,
  historical_notes TEXT,
  pre_clinichq_history TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH cat_match AS (
    -- Find cat by microchip or name
    SELECT DISTINCT c.cat_id
    FROM trapper.sot_cats c
    LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
    WHERE (p_microchip IS NOT NULL AND ci.id_type = 'microchip' AND ci.id_value ILIKE '%' || p_microchip || '%')
       OR (p_name IS NOT NULL AND ci.id_type = 'name' AND ci.id_value ILIKE '%' || p_name || '%')
       OR (p_address IS NOT NULL AND EXISTS (
         SELECT 1 FROM trapper.cat_place_relationships cpr
         JOIN trapper.places pl ON pl.place_id = cpr.place_id
         WHERE cpr.cat_id = c.cat_id AND pl.formatted_address ILIKE '%' || p_address || '%'
       ))
    LIMIT 10
  ),
  cat_details AS (
    SELECT
      cm.cat_id,
      (SELECT ci.id_value FROM trapper.cat_identifiers ci
       WHERE ci.cat_id = cm.cat_id AND ci.id_type = 'microchip' LIMIT 1) as microchip,
      (SELECT ci.id_value FROM trapper.cat_identifiers ci
       WHERE ci.cat_id = cm.cat_id AND ci.id_type = 'name' LIMIT 1) as cat_name,
      -- Place info
      (SELECT p.formatted_address FROM trapper.cat_place_relationships cpr
       JOIN trapper.places p ON p.place_id = cpr.place_id
       WHERE cpr.cat_id = cm.cat_id LIMIT 1) as place_address,
      (SELECT cpr.place_id FROM trapper.cat_place_relationships cpr
       WHERE cpr.cat_id = cm.cat_id LIMIT 1) as place_id,
      -- Contact person
      (SELECT per.display_name FROM trapper.cat_place_relationships cpr
       JOIN trapper.person_place_relationships ppr ON ppr.place_id = cpr.place_id
       JOIN trapper.sot_people per ON per.person_id = ppr.person_id
       WHERE cpr.cat_id = cm.cat_id
       ORDER BY ppr.created_at ASC LIMIT 1) as contact_person,
      (SELECT pi.id_value_norm FROM trapper.cat_place_relationships cpr
       JOIN trapper.person_place_relationships ppr ON ppr.place_id = cpr.place_id
       JOIN trapper.person_identifiers pi ON pi.person_id = ppr.person_id AND pi.id_type = 'email'
       WHERE cpr.cat_id = cm.cat_id LIMIT 1) as contact_email,
      (SELECT pi.id_value_norm FROM trapper.cat_place_relationships cpr
       JOIN trapper.person_place_relationships ppr ON ppr.place_id = cpr.place_id
       JOIN trapper.person_identifiers pi ON pi.person_id = ppr.person_id AND pi.id_type = 'phone'
       WHERE cpr.cat_id = cm.cat_id LIMIT 1) as contact_phone,
      -- Clinic stats
      (SELECT COUNT(*)::INT FROM trapper.sot_appointments a WHERE a.cat_id = cm.cat_id) as clinic_visits,
      (SELECT MIN(a.appointment_date) FROM trapper.sot_appointments a WHERE a.cat_id = cm.cat_id) as first_clinic_visit,
      (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a WHERE a.cat_id = cm.cat_id) as last_clinic_visit,
      (SELECT bool_or(a.is_spay OR a.is_neuter) FROM trapper.sot_appointments a WHERE a.cat_id = cm.cat_id) as was_spayed_neutered,
      (SELECT MIN(a.appointment_date) FROM trapper.sot_appointments a
       WHERE a.cat_id = cm.cat_id AND (a.is_spay OR a.is_neuter)) as spay_neuter_date
    FROM cat_match cm
  )
  SELECT
    cd.cat_id,
    cd.microchip,
    cd.cat_name,
    cd.place_address,
    cd.place_id,
    cd.contact_person,
    cd.contact_email,
    cd.contact_phone,
    cd.clinic_visits,
    cd.first_clinic_visit,
    cd.last_clinic_visit,
    cd.was_spayed_neutered,
    cd.spay_neuter_date,
    -- Google Maps context at the place
    (SELECT g.kml_name || ': ' || LEFT(COALESCE(g.ai_summary, g.original_content), 300)
     FROM trapper.google_map_entries g
     WHERE g.linked_place_id = cd.place_id
     ORDER BY g.synced_at DESC LIMIT 1) as google_maps_context,
    -- Full historical notes from Google Maps
    (SELECT string_agg(LEFT(g.original_content, 500), E'\n---\n' ORDER BY g.synced_at DESC)
     FROM trapper.google_map_entries g
     WHERE g.linked_place_id = cd.place_id
       OR (cd.contact_person IS NOT NULL AND g.kml_name ILIKE '%' || cd.contact_person || '%')
     LIMIT 3) as historical_notes,
    -- Extract pre-ClinicHQ history hints
    (SELECT
      CASE
        WHEN g.original_content ~* '([0-9]+) ?y(ea)?rs? ago'
          THEN 'TNR history: ' || (regexp_match(g.original_content, '([0-9]+) ?y(ea)?rs? ago', 'i'))[1] || ' years ago per Google Maps notes (pre-ClinicHQ)'
        WHEN g.original_content ~* 'trapped|tnr.*(19|20)[0-9]{2}'
          THEN 'TNR history mentioned in Google Maps notes (pre-ClinicHQ era)'
        WHEN g.original_content ~* 'fixed (before|prior|previously|already)'
          THEN 'Notes indicate cat was already fixed before ClinicHQ records'
        WHEN g.original_content ~* 'tnr.*(female|male|cat)'
          THEN 'TNR activity mentioned in notes'
        WHEN NOT cd.was_spayed_neutered AND cd.clinic_visits > 0
          THEN 'No spay/neuter in ClinicHQ - may have been fixed elsewhere/before'
        ELSE NULL
      END
     FROM trapper.google_map_entries g
     WHERE g.linked_place_id = cd.place_id
        OR (cd.contact_person IS NOT NULL AND g.kml_name ILIKE '%' || split_part(cd.contact_person, ' ', 1) || '%')
     ORDER BY
       CASE WHEN g.original_content ~* '[0-9]+ ?y(ea)?rs? ago' THEN 0 ELSE 1 END
     LIMIT 1) as pre_clinichq_history
  FROM cat_details cd;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.tippy_cat_lookup IS
'Comprehensive cat lookup that cross-references clinic data with Google Maps history.
Search by microchip, name, or address. Returns clinic visits, contact info, and historical context
including hints about pre-ClinicHQ TNR history.';


-- ============================================================
-- Place summary with all cross-referenced data
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.tippy_place_summary(p_address TEXT)
RETURNS TABLE (
  place_id UUID,
  address TEXT,
  service_zone TEXT,
  -- People
  people_at_address JSONB,
  -- Cats
  cats_at_address JSONB,
  -- Requests
  requests JSONB,
  -- Google Maps context
  google_maps_entries JSONB,
  -- Nearby summary
  nearby_active_requests INT,
  nearby_colonies_500m INT,
  -- AI-extracted attributes
  ai_attributes JSONB
) AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Find place
  SELECT p.place_id INTO v_place_id
  FROM trapper.places p
  WHERE p.formatted_address ILIKE '%' || p_address || '%'
    AND p.merged_into_place_id IS NULL
  ORDER BY LENGTH(p.formatted_address)
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'Place not found: %', p_address;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_place_id,
    p.formatted_address,
    p.service_zone,
    -- People at address
    (SELECT jsonb_agg(jsonb_build_object(
      'name', per.display_name,
      'email', (SELECT pi.id_value_norm FROM trapper.person_identifiers pi WHERE pi.person_id = per.person_id AND pi.id_type = 'email' LIMIT 1),
      'phone', (SELECT pi.id_value_norm FROM trapper.person_identifiers pi WHERE pi.person_id = per.person_id AND pi.id_type = 'phone' LIMIT 1)
    ))
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people per ON per.person_id = ppr.person_id
     WHERE ppr.place_id = v_place_id),
    -- Cats at address
    (SELECT jsonb_agg(jsonb_build_object(
      'microchip', (SELECT ci.id_value FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
      'name', (SELECT ci.id_value FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'name' LIMIT 1),
      'last_clinic_visit', (SELECT MAX(a.appointment_date)::TEXT FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id),
      'was_fixed', (SELECT bool_or(a.is_spay OR a.is_neuter) FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id)
    ))
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = v_place_id),
    -- Requests
    (SELECT jsonb_agg(jsonb_build_object(
      'request_id', r.request_id,
      'status', r.status,
      'created', r.created_at::DATE,
      'resolved', r.resolved_at::DATE,
      'cats_reported', r.estimated_cat_count
    ) ORDER BY r.created_at DESC)
     FROM trapper.sot_requests r
     WHERE r.place_id = v_place_id),
    -- Google Maps entries
    (SELECT jsonb_agg(jsonb_build_object(
      'name', g.kml_name,
      'classification', g.ai_meaning,
      'notes_preview', LEFT(COALESCE(g.ai_summary, g.original_content), 200),
      'staff_alert', COALESCE((SELECT ct.staff_alert FROM trapper.google_map_classification_types ct WHERE ct.classification_type = g.ai_meaning), false)
    ) ORDER BY g.synced_at DESC)
     FROM trapper.google_map_entries g
     WHERE g.linked_place_id = v_place_id),
    -- Nearby counts
    (SELECT COUNT(*)::INT FROM trapper.sot_requests r
     JOIN trapper.places pl ON pl.place_id = r.place_id
     WHERE pl.location IS NOT NULL
       AND ST_DWithin(pl.location, p.location, 500)
       AND r.status NOT IN ('completed', 'cancelled')
       AND r.place_id != v_place_id),
    (SELECT COUNT(*)::INT FROM trapper.google_map_entries g
     WHERE g.ai_meaning IN ('active_colony', 'historical_colony')
       AND ABS(g.lat - ST_Y(p.location::geometry)) < 0.0045
       AND ABS(g.lng - ST_X(p.location::geometry)) < 0.006),
    -- AI-extracted attributes
    (SELECT jsonb_object_agg(ea.attribute_key, ea.attribute_value)
     FROM trapper.entity_attributes ea
     WHERE ea.entity_type = 'place' AND ea.entity_id = v_place_id
       AND ea.superseded_at IS NULL)
  FROM trapper.places p
  WHERE p.place_id = v_place_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.tippy_place_summary IS
'Comprehensive place summary with all cross-referenced data: people, cats, requests,
Google Maps context, nearby activity, and AI-extracted attributes.';


-- Register in Tippy catalog
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('tippy_cat_lookup', 'entity',
   'Comprehensive cat lookup by microchip, name, or address. Cross-references clinic data with Google Maps history. Shows contact info and pre-ClinicHQ history hints.',
   ARRAY['cat_id', 'microchip', 'cat_name', 'place_address'],
   ARRAY['p_microchip', 'p_name', 'p_address'],
   ARRAY[
     'What do we know about cat with microchip 981020007888241?',
     'Tell me about a cat named Merlin',
     'What cats are at 2360 Becker Blvd?',
     'Was this cat fixed before ClinicHQ?'
   ]),
  ('tippy_place_summary', 'entity',
   'Comprehensive place summary with people, cats, requests, Google Maps history, nearby activity, and AI attributes.',
   ARRAY['place_id', 'address', 'people_at_address', 'cats_at_address'],
   ARRAY['p_address'],
   ARRAY[
     'Give me a full summary of 2360 Becker Blvd',
     'Who lives at this address and what cats do they have?',
     'What is the history at this location?'
   ])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  example_questions = EXCLUDED.example_questions;


\echo 'Created tippy_cat_lookup and tippy_place_summary functions'
\echo 'Tippy can now answer complex cross-referenced questions like:'
\echo '  - "What do we know about Merlin (981020007888241)?"'
\echo '  - "Was this cat fixed before ClinicHQ?"'
\echo '  - "Give me the full history at this address"'
