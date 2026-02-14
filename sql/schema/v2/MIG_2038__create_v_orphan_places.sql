-- MIG_2038: Create ops.v_orphan_places view for Admin cleanup
-- Date: 2026-02-13
-- Issue: Admin needs to identify and clean up orphaned places

CREATE OR REPLACE VIEW ops.v_orphan_places AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.place_kind::text,
  p.is_address_backed,
  p.source_system,
  p.created_at
FROM sot.places p
WHERE p.merged_into_place_id IS NULL
  -- Not referenced by requests
  AND NOT EXISTS (SELECT 1 FROM ops.requests r WHERE r.place_id = p.place_id)
  -- Not referenced by appointments
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.place_id = p.place_id OR a.inferred_place_id = p.place_id)
  -- Not referenced by person_place relationships
  AND NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.place_id = p.place_id)
  -- Not referenced by cat_place relationships
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
  -- Not referenced by place_contexts
  AND NOT EXISTS (SELECT 1 FROM sot.place_contexts pc WHERE pc.place_id = p.place_id)
  -- Not referenced by place_colony_estimates
  AND NOT EXISTS (SELECT 1 FROM sot.place_colony_estimates pce WHERE pce.place_id = p.place_id)
  -- Not referenced by intake_submissions
  AND NOT EXISTS (SELECT 1 FROM ops.intake_submissions i WHERE i.place_id = p.place_id)
  -- Not referenced by google_map_entries
  AND NOT EXISTS (SELECT 1 FROM ops.google_map_entries gme WHERE gme.place_id = p.place_id)
  -- Not referenced by clinic_accounts
  AND NOT EXISTS (SELECT 1 FROM ops.clinic_accounts ca WHERE ca.resolved_place_id = p.place_id)
  -- Not referenced by people (primary_place_id)
  AND NOT EXISTS (SELECT 1 FROM sot.people per WHERE per.primary_place_id = p.place_id AND per.merged_into_person_id IS NULL);
