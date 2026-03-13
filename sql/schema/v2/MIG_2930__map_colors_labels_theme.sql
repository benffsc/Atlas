-- MIG_2930: Phase 4 — Map colors, display labels, and theme overrides
-- Part of FFS-516 (Map Colors), FFS-517 (Display Labels), FFS-518 (Design Tokens)

-- ============================================================================
-- 1. Display labels table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.display_labels (
  registry TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (registry, key)
);

CREATE INDEX IF NOT EXISTS idx_display_labels_registry ON ops.display_labels(registry);

-- ============================================================================
-- 2. Seed display labels from all registries
-- ============================================================================

-- Place kinds
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('place_kind', 'single_family', 'House', 1),
  ('place_kind', 'apartment_unit', 'Apartment', 2),
  ('place_kind', 'apartment_building', 'Apt Building', 3),
  ('place_kind', 'mobile_home', 'Mobile Home', 4),
  ('place_kind', 'business', 'Business', 5),
  ('place_kind', 'farm', 'Farm', 6),
  ('place_kind', 'outdoor_site', 'Outdoor Site', 7),
  ('place_kind', 'clinic', 'Clinic', 8),
  ('place_kind', 'shelter', 'Shelter', 9),
  ('place_kind', 'unknown', 'Other', 10),
  ('place_kind', 'residential_house', 'House', 11),
  ('place_kind', 'mobile_home_space', 'Mobile Home', 12),
  ('place_kind', 'multi_family', 'Multi-Family', 13),
  ('place_kind', 'neighborhood', 'Neighborhood', 14),
  ('place_kind', 'farm_ranch', 'Farm/Ranch', 15),
  ('place_kind', 'park', 'Park', 16),
  ('place_kind', 'school', 'School', 17)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Roles (person-place)
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('role', 'resident', 'Resident', 1),
  ('role', 'property_owner', 'Property Owner', 2),
  ('role', 'colony_caretaker', 'Caretaker', 3),
  ('role', 'colony_supervisor', 'Colony Supervisor', 4),
  ('role', 'feeder', 'Feeder', 5),
  ('role', 'transporter', 'Transporter', 6),
  ('role', 'referrer', 'Referrer', 7),
  ('role', 'neighbor', 'Neighbor', 8),
  ('role', 'works_at', 'Works At', 9),
  ('role', 'volunteers_at', 'Volunteers At', 10),
  ('role', 'contact_address', 'Contact Address', 11),
  ('role', 'owner', 'Owner', 12),
  ('role', 'volunteer', 'Volunteer', 13),
  ('role', 'concerned_citizen', 'Concerned Citizen', 14),
  ('role', 'trapper', 'Trapper', 15),
  ('role', 'property_manager', 'Property Manager', 16),
  ('role', 'tenant', 'Tenant', 17)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Relationship types (person-cat)
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('relationship', 'owner', 'Owner', 1),
  ('relationship', 'caretaker', 'Caretaker', 2),
  ('relationship', 'colony_caretaker', 'Colony Caretaker', 3),
  ('relationship', 'foster', 'Foster', 4),
  ('relationship', 'finder', 'Finder', 5),
  ('relationship', 'surrenderer', 'Surrenderer', 6),
  ('relationship', 'adopter', 'Adopter', 7),
  ('relationship', 'resident', 'Resident', 8)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Triage categories
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('triage', 'high_priority', 'High Priority', 1),
  ('triage', 'high_priority_tnr', 'High Priority', 2),
  ('triage', 'standard', 'Standard', 3),
  ('triage', 'standard_tnr', 'Standard', 4),
  ('triage', 'low_priority', 'Low Priority', 5),
  ('triage', 'duplicate', 'Duplicate', 6),
  ('triage', 'spam', 'Spam', 7),
  ('triage', 'needs_info', 'Needs Info', 8),
  ('triage', 'follow_up', 'Follow-up', 9),
  ('triage', 'emergency', 'Emergency', 10)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Request statuses (search display)
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('request_status', 'new', 'New', 1),
  ('request_status', 'triaged', 'Triaged', 2),
  ('request_status', 'scheduled', 'Scheduled', 3),
  ('request_status', 'in_progress', 'In Progress', 4),
  ('request_status', 'completed', 'Completed', 5),
  ('request_status', 'cancelled', 'Cancelled', 6),
  ('request_status', 'on_hold', 'On Hold', 7)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Source systems
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('source_system', 'clinichq', 'ClinicHQ', 1),
  ('source_system', 'shelterluv', 'ShelterLuv', 2),
  ('source_system', 'volunteerhub', 'VolunteerHub', 3),
  ('source_system', 'airtable', 'Airtable', 4),
  ('source_system', 'web_intake', 'Web Intake', 5),
  ('source_system', 'petlink', 'PetLink', 6),
  ('source_system', 'google_maps', 'Google Maps', 7),
  ('source_system', 'atlas_ui', 'Atlas', 8)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Source tables
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('source_table', 'ops.clinic_raw', 'Clinic Record', 1),
  ('source_table', 'ops.appointments', 'Appointment', 2),
  ('source_table', 'ops.intake_submissions', 'Intake Submission', 3),
  ('source_table', 'ops.requests', 'Request', 4),
  ('source_table', 'ops.cat_test_results', 'Test Result', 5),
  ('source_table', 'source.clinichq_raw', 'Clinic Import', 6),
  ('source_table', 'source.airtable_raw', 'Airtable Import', 7),
  ('source_table', 'source.shelterluv_raw', 'ShelterLuv Import', 8),
  ('source_table', 'source.volunteerhub_raw', 'VolunteerHub Import', 9),
  ('source_table', 'sot.people', 'Person', 10),
  ('source_table', 'sot.cats', 'Cat', 11),
  ('source_table', 'sot.places', 'Place', 12)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Match reasons (full)
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('match_reason', 'exact_name', 'Exact name', 1),
  ('match_reason', 'exact_microchip', 'Exact microchip', 2),
  ('match_reason', 'exact_address', 'Exact address', 3),
  ('match_reason', 'exact_email', 'Exact email', 4),
  ('match_reason', 'exact_phone', 'Exact phone', 5),
  ('match_reason', 'prefix_name', 'Name starts with', 6),
  ('match_reason', 'prefix_microchip', 'Microchip starts with', 7),
  ('match_reason', 'prefix_address', 'Address starts with', 8),
  ('match_reason', 'similar_name', 'Similar name', 9),
  ('match_reason', 'contains_name', 'Name contains', 10),
  ('match_reason', 'trigram', 'Fuzzy match', 11),
  ('match_reason', 'alias_match', 'Alias', 12),
  ('match_reason', 'expanded_name', 'Expanded name', 13),
  ('match_reason', 'name', 'Name', 14),
  ('match_reason', 'address', 'Address', 15),
  ('match_reason', 'phone', 'Phone', 16),
  ('match_reason', 'email', 'Email', 17)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Match reasons (short)
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('match_reason_short', 'exact_name', 'Exact', 1),
  ('match_reason_short', 'exact_microchip', 'Exact Chip', 2),
  ('match_reason_short', 'exact_address', 'Exact Address', 3),
  ('match_reason_short', 'exact_email', 'Exact Email', 4),
  ('match_reason_short', 'exact_phone', 'Exact Phone', 5),
  ('match_reason_short', 'prefix_name', 'Prefix', 6),
  ('match_reason_short', 'prefix_microchip', 'Prefix Chip', 7),
  ('match_reason_short', 'prefix_address', 'Prefix Address', 8),
  ('match_reason_short', 'similar_name', 'Similar', 9),
  ('match_reason_short', 'contains_name', 'Contains', 10),
  ('match_reason_short', 'trigram', 'Fuzzy', 11),
  ('match_reason_short', 'alias_match', 'Alias', 12),
  ('match_reason_short', 'expanded_name', 'Expanded', 13),
  ('match_reason_short', 'name', 'Name', 14),
  ('match_reason_short', 'address', 'Address', 15),
  ('match_reason_short', 'phone', 'Phone', 16),
  ('match_reason_short', 'email', 'Email', 17)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Match fields
INSERT INTO ops.display_labels (registry, key, label, sort_order) VALUES
  ('match_field', 'client_name', 'Client name', 1),
  ('match_field', 'owner_first_name', 'First name', 2),
  ('match_field', 'owner_last_name', 'Last name', 3),
  ('match_field', 'owner_email', 'Email', 4),
  ('match_field', 'owner_phone', 'Phone', 5),
  ('match_field', 'owner_cell_phone', 'Cell phone', 6),
  ('match_field', 'owner_address', 'Address', 7),
  ('match_field', 'animal_name', 'Animal name', 8),
  ('match_field', 'microchip', 'Microchip', 9),
  ('match_field', 'formatted_address', 'Address', 10),
  ('match_field', 'display_name', 'Name', 11),
  ('match_field', 'created_at', 'Date', 12),
  ('match_field', 'first_name', 'First name', 13),
  ('match_field', 'last_name', 'Last name', 14),
  ('match_field', 'email', 'Email', 15),
  ('match_field', 'phone', 'Phone', 16),
  ('match_field', 'summary', 'Summary', 17),
  ('match_field', 'breed', 'Breed', 18),
  ('match_field', 'primary_color', 'Color', 19),
  ('match_field', 'payload', 'Record data', 20)
ON CONFLICT (registry, key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 3. Seed map color config into app_config
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('map.colors.priority', '{"critical":"#dc2626","high":"#ea580c","medium":"#ca8a04","low":"#3b82f6","managed":"#16a34a","unknown":"#6b7280"}', 'TNR urgency priority colors', 'map'),
  ('map.colors.layers', '{"places":"#3b82f6","google_pins":"#f59e0b","tnr_priority":"#dc2626","zones":"#10b981","volunteers":"#9333ea","clinic_clients":"#8b5cf6","historical_sources":"#6b7280","data_coverage":"#059669"}', 'Map layer colors', 'map'),
  ('map.colors.classification', '{"disease_risk":"#dc2626","watch_list":"#f59e0b","volunteer":"#9333ea","active_colony":"#16a34a","historical_colony":"#6b7280","relocation_client":"#8b5cf6","contact_info":"#3b82f6"}', 'AI classification colors', 'map'),
  ('map.colors.signals', '{"pregnant_nursing":"#ec4899","mortality":"#1f2937","relocated":"#8b5cf6","adopted":"#10b981","temperament":"#f59e0b","general":"#6366f1"}', 'Signal type colors', 'map'),
  ('map.colors.volunteerRoles', '{"coordinator":"#7c3aed","head_trapper":"#2563eb","ffsc_trapper":"#16a34a","community_trapper":"#f59e0b"}', 'Volunteer role colors', 'map'),
  ('map.colors.zoneStatus', '{"critical":"#dc2626","high":"#ea580c","medium":"#ca8a04","refresh":"#3b82f6","current":"#16a34a","unknown":"#6b7280"}', 'Zone observation status colors', 'map'),
  ('map.colors.coverage', '{"rich":"#16a34a","moderate":"#3b82f6","sparse":"#f59e0b","gap":"#dc2626"}', 'Data coverage level colors', 'map'),
  ('map.colors.disease', '{"felv":"#dc2626","fiv":"#ea580c","ringworm":"#ca8a04","heartworm":"#7c3aed","panleukopenia":"#be185d","fallback":"#6b7280"}', 'Disease type colors', 'map')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, category = EXCLUDED.category;

-- ============================================================================
-- 4. Seed theme config into app_config
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('theme.brand', '{"primary":"#3b82f6","primaryDark":"#1d4ed8","primaryLight":"#dbeafe","primaryHover":"#2563eb"}', 'Brand primary colors', 'theme'),
  ('theme.status', '{"success":"#10b981","successDark":"#059669","successLight":"#d1fae5","warning":"#f59e0b","warningDark":"#d97706","warningLight":"#fef3c7","error":"#ef4444","errorDark":"#dc2626","errorLight":"#fee2e2","info":"#3b82f6","infoDark":"#2563eb","infoLight":"#dbeafe"}', 'Status indicator colors', 'theme'),
  ('theme.entity_colors', '{"cat":"#3b82f6","person":"#9333ea","place":"#10b981","request":"#f59e0b"}', 'Entity type accent colors', 'theme'),
  ('theme.request_status', '{"new":{"bg":"#dbeafe","text":"#1d4ed8","border":"#3b82f6"},"working":{"bg":"#fef3c7","text":"#92400e","border":"#f59e0b"},"paused":{"bg":"#fce7f3","text":"#9d174d","border":"#ec4899"},"completed":{"bg":"#d1fae5","text":"#059669","border":"#10b981"}}', 'Request status badge colors', 'theme')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, category = EXCLUDED.category;
