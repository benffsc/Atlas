-- MIG_924: Update Survivorship Priority Rules
--
-- Updates the survivorship_priority table with the user-confirmed source authority:
--
-- Source Authority Map:
--   - Cat medical data: ClinicHQ (spay/neuter, procedures, vaccines)
--   - Cat identity: ClinicHQ (microchip is gold standard)
--   - Cat origin location: ClinicHQ (appointment address = where cat came from)
--   - Cat current location: ShelterLuv (outcome address = where cat is now)
--   - Cat outcomes: ShelterLuv (adoption, foster, death, transfer)
--   - People (volunteers): VolunteerHub (roles, groups, hours, status)
--   - People (fosters): VolunteerHub ("Approved Foster Parent" group)
--   - People (adopters): ShelterLuv (from adoption outcome events)
--   - People (clinic clients): ClinicHQ (from appointment owner info)
--   - Trapper roles: VolunteerHub (except community trappers from Airtable)
--   - Foster relationships: ShelterLuv reinforces VolunteerHub (cat→foster links)
--
-- Related: MIG_620 (cat_field_sources), MIG_922 (person_field_sources)

\echo ''
\echo '========================================================'
\echo 'MIG_924: Update Survivorship Priority Rules'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Ensure survivorship_priority table exists
-- ============================================================

\echo 'Ensuring survivorship_priority table exists...'

CREATE TABLE IF NOT EXISTS trapper.survivorship_priority (
  priority_id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('cat', 'person', 'place')),
  field_name TEXT NOT NULL,
  priority_order TEXT[] NOT NULL,  -- Array of source_systems in priority order
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_type, field_name)
);

COMMENT ON TABLE trapper.survivorship_priority IS
'Defines which source system wins for each field type.
Lower array index = higher priority.
Used by record_*_field_source() functions.';

-- ============================================================
-- PART 2: Update cat field priorities
-- ============================================================

\echo 'Updating cat field priorities...'

-- Cat name: ClinicHQ wins (verified at clinic)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'name', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is authority for cat names (verified at clinic visit)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat breed: ClinicHQ wins
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'breed', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is authority for breed (verified at clinic)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat sex: ClinicHQ wins
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'sex', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is authority for sex (verified during procedure)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat colors: ClinicHQ wins
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'primary_color', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is authority for coloring (verified at clinic)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'secondary_color', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is authority for coloring')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat altered_status: ClinicHQ wins (ground truth for TNR)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'altered_status', ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ClinicHQ is GROUND TRUTH for altered status (only spay/neuter clinic in county)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat ownership_type: ShelterLuv wins (knows adoption/foster outcomes)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'ownership_type', ARRAY['shelterluv', 'clinichq', 'petlink', 'airtable', 'web_intake', 'atlas_ui'],
        'ShelterLuv is authority for ownership (adoption/foster outcomes)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat current_location: ShelterLuv wins (knows where cat moved to)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'current_location', ARRAY['shelterluv', 'clinichq', 'web_intake', 'airtable', 'atlas_ui'],
        'ShelterLuv is authority for current location (adoption/foster/relocation outcomes)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Cat origin_location: ClinicHQ wins (appointment address)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('cat', 'origin_location', ARRAY['clinichq', 'web_intake', 'airtable', 'shelterluv', 'atlas_ui'],
        'ClinicHQ is authority for origin location (appointment address = where cat came from)')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================
-- PART 3: Update person field priorities
-- ============================================================

\echo 'Updating person field priorities...'

-- Person display_name: VolunteerHub wins for volunteers
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'display_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
        'VolunteerHub is authority for volunteer names; ClinicHQ for clinic clients')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'first_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
        'VolunteerHub is authority for volunteer names')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'last_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
        'VolunteerHub is authority for volunteer names')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Person address: VolunteerHub wins (verified volunteer address)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'address', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'web_intake', 'airtable', 'atlas_ui'],
        'VolunteerHub has verified volunteer addresses; ClinicHQ has clinic client addresses')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Person email: VolunteerHub wins (verified during signup)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'email', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
        'VolunteerHub emails are verified during volunteer signup')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Person phone: VolunteerHub wins (verified)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person', 'phone', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
        'VolunteerHub phones are verified during signup')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================
-- PART 4: Update place field priorities
-- ============================================================

\echo 'Updating place field priorities...'

-- Place normalized_address: ClinicHQ wins (verified clinic visits)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('place', 'normalized_address', ARRAY['clinichq', 'volunteerhub', 'shelterluv', 'web_intake', 'airtable', 'atlas_ui'],
        'ClinicHQ has verified addresses from clinic visits')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Place display_name: Atlas UI wins (staff-curated)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('place', 'display_name', ARRAY['atlas_ui', 'clinichq', 'volunteerhub', 'shelterluv', 'web_intake', 'airtable'],
        'Atlas UI edits are staff-curated; otherwise ClinicHQ')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification - Current survivorship priorities:'

SELECT entity_type, field_name, priority_order[1] AS highest_priority, array_length(priority_order, 1) AS source_count
FROM trapper.survivorship_priority
ORDER BY entity_type, field_name;

-- ============================================================
-- PART 5: Add role survivorship priority
-- ============================================================

\echo 'Adding role survivorship priorities...'

-- Foster role: VolunteerHub is authority (Approved Foster Parent group)
-- ShelterLuv reinforces when foster outcome events occur
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_role', 'foster', ARRAY['volunteerhub', 'shelterluv', 'airtable', 'atlas_ui'],
        'VolunteerHub "Approved Foster Parent" group is authority; ShelterLuv reinforces via outcomes')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Trapper role: VolunteerHub is authority (Approved Trappers group)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_role', 'trapper', ARRAY['volunteerhub', 'airtable', 'atlas_ui'],
        'VolunteerHub "Approved Trappers" group is authority; Airtable for community trappers only')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Volunteer role: VolunteerHub is authority
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_role', 'volunteer', ARRAY['volunteerhub', 'airtable', 'atlas_ui'],
        'VolunteerHub is sole authority for volunteer status')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Adopter role: ShelterLuv is authority (adoption outcomes)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_role', 'adopter', ARRAY['shelterluv', 'atlas_ui'],
        'ShelterLuv adoption outcomes are authority for adopter status')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================
-- PART 6: Add relationship survivorship priority
-- ============================================================

\echo 'Adding relationship survivorship priorities...'

-- Foster relationship (cat → foster person): ShelterLuv reinforces VolunteerHub
-- The PERSON is approved by VolunteerHub, but the specific CAT relationship
-- comes from ShelterLuv foster outcome events
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_cat_relationship', 'foster', ARRAY['shelterluv', 'volunteerhub', 'atlas_ui'],
        'ShelterLuv foster outcomes create cat→foster links; person must be VH approved foster')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Adopter relationship: ShelterLuv is authority
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_cat_relationship', 'adopter', ARRAY['shelterluv', 'atlas_ui'],
        'ShelterLuv adoption outcomes are authority for cat→adopter links')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Owner relationship: ClinicHQ is authority (clinic client is owner)
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES ('person_cat_relationship', 'owner', ARRAY['clinichq', 'shelterluv', 'web_intake', 'atlas_ui'],
        'ClinicHQ appointment owner info is authority for cat→owner links')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
  priority_order = EXCLUDED.priority_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification - Current survivorship priorities:'

SELECT entity_type, field_name, priority_order[1] AS highest_priority, array_length(priority_order, 1) AS source_count
FROM trapper.survivorship_priority
ORDER BY entity_type, field_name;

\echo ''
\echo '========================================================'
\echo 'MIG_924 Complete!'
\echo '========================================================'
\echo ''
\echo 'Survivorship Priority Summary:'
\echo ''
\echo 'CAT FIELDS:'
\echo '  - name, breed, sex, colors, altered_status: ClinicHQ wins'
\echo '  - ownership_type, current_location: ShelterLuv wins'
\echo '  - origin_location: ClinicHQ wins'
\echo ''
\echo 'PERSON FIELDS:'
\echo '  - All fields: VolunteerHub wins (for volunteers/fosters)'
\echo '  - Clinic clients: ClinicHQ is next priority'
\echo '  - Adopters: ShelterLuv is authority'
\echo ''
\echo 'PERSON ROLES:'
\echo '  - foster, trapper, volunteer: VolunteerHub is authority'
\echo '  - adopter: ShelterLuv is authority'
\echo ''
\echo 'PERSON-CAT RELATIONSHIPS:'
\echo '  - foster (cat→person): ShelterLuv creates, VolunteerHub approves person'
\echo '  - adopter: ShelterLuv is authority'
\echo '  - owner: ClinicHQ is authority'
\echo ''
\echo 'PLACE FIELDS:'
\echo '  - normalized_address: ClinicHQ wins'
\echo '  - display_name: Atlas UI wins (staff-curated)'
\echo ''
