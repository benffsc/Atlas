-- MIG_2957: Expand "unable to complete" resolution reasons
-- Adds granular reasons for statistical analysis of why TNR cases can't be completed.
-- Existing: no_cats_found, cats_gone, access_revoked, safety_concern
-- New: location_not_viable, feeding_not_established, client_uncooperative, no_trapper_available

INSERT INTO ops.request_resolution_reasons
  (reason_key, reason_label, applies_to_status, requires_notes, display_order, is_active, outcome_category)
VALUES
  ('location_not_viable', 'Location not suitable for trapping',
   '{completed}', false, 23, true, 'unable_to_complete'),
  ('feeding_not_established', 'Unable to establish feeding routine',
   '{completed}', false, 24, true, 'unable_to_complete'),
  ('client_uncooperative', 'Client unable or unwilling to assist',
   '{completed}', false, 25, true, 'unable_to_complete'),
  ('no_trapper_available', 'No trapper available for area',
   '{completed}', false, 26, true, 'unable_to_complete')
ON CONFLICT (reason_key) DO UPDATE SET
  reason_label = EXCLUDED.reason_label,
  outcome_category = EXCLUDED.outcome_category,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;
