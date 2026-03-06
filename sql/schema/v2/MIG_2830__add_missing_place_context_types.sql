-- MIG_2830: Add missing place_context_types referenced by classify_request_place trigger
--
-- The ops.classify_request_place() trigger (MIG_2524) inserts context types
-- breeding_site, established_colony, and urgent_site into sot.place_contexts,
-- but these types were never added to atlas.place_context_types.
-- This causes FK violations on ALL request creation with a place_id.
--
-- Fixes FFS-185

INSERT INTO atlas.place_context_types (context_type, category, display_name, description, sort_order)
VALUES
  ('breeding_site', 'ecological', 'Breeding Site', 'Location where kittens have been reported', 12),
  ('established_colony', 'ecological', 'Established Colony', 'Location with multiple TNR requests over time', 13),
  ('urgent_site', 'operational', 'Urgent Site', 'Location with urgent/emergency priority request', 45)
ON CONFLICT (context_type) DO NOTHING;
