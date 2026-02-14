\echo '=== MIG_793: Create v_orphan_places view ==='
\echo 'Identifies places with zero FK references across all tables.'
\echo 'Used by /admin/orphan-places for data hygiene.'

-- View: places with no references from any other table
CREATE OR REPLACE VIEW trapper.v_orphan_places AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.place_kind,
  p.location,
  p.data_source,
  p.created_at,
  CASE WHEN p.formatted_address IS NOT NULL AND p.formatted_address <> '' THEN TRUE ELSE FALSE END AS is_address_backed
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  -- Core entity references
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_requests r WHERE r.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments a WHERE a.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments a2 WHERE a2.inferred_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr2 WHERE cpr2.original_place_id = p.place_id)
  -- Colony & context
  AND NOT EXISTS (SELECT 1 FROM trapper.place_contexts pc WHERE pc.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_colony_estimates pce WHERE pce.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.colonies c WHERE c.primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.colony_places cp WHERE cp.place_id = p.place_id)
  -- Intake
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w WHERE w.selected_address_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w2 WHERE w2.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w3 WHERE w3.matched_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w4 WHERE w4.requester_place_id = p.place_id)
  -- Google/Map entries
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g WHERE g.linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g2 WHERE g2.nearest_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g3 WHERE g3.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g4 WHERE g4.suggested_parent_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records k WHERE k.linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records k2 WHERE k2.nearest_place_id = p.place_id)
  -- Other entities
  AND NOT EXISTS (SELECT 1 FROM trapper.households h WHERE h.primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.known_organizations ko WHERE ko.linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.site_observations so WHERE so.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.trapper_site_visits tsv WHERE tsv.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.clinic_owner_accounts coa WHERE coa.linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.tippy_draft_requests tdr WHERE tdr.place_id = p.place_id)
  -- Life events
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_birth_events cbe WHERE cbe.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_mortality_events cme WHERE cme.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_movement_events cmv WHERE cmv.to_place_id = p.place_id OR cmv.from_place_id = p.place_id)
  -- Other references
  AND NOT EXISTS (SELECT 1 FROM trapper.journal_entries je WHERE je.primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.partner_organizations po WHERE po.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_changes pch WHERE pch.place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.request_media rm WHERE rm.place_id = p.place_id)
  -- Self-references (children / merge targets)
  AND NOT EXISTS (SELECT 1 FROM trapper.places child WHERE child.parent_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.places merged WHERE merged.merged_into_place_id = p.place_id)
  -- Place-to-place edges
  AND NOT EXISTS (SELECT 1 FROM trapper.place_place_edges ppe WHERE ppe.place_id_a = p.place_id OR ppe.place_id_b = p.place_id)
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_orphan_places IS
  'Places with zero FK references across all tables. Safe to delete for data hygiene.';

\echo 'Done: v_orphan_places view created.'
