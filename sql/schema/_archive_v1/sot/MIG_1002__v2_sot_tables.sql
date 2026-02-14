-- MIG_1002: V2 Architecture - SOT (Source of Truth) Tables
-- Phase 1, Part 3: Canonical entity tables with date preservation
--
-- Creates the Layer 3 SOT tables for:
-- 1. People (canonical persons)
-- 2. Cats (canonical animals)
-- 3. Places (canonical locations)
-- 4. Addresses (normalized addresses)
-- 5. Relationship tables (person_cat, cat_place, person_place)
-- 6. Identifier tables (person_identifiers, cat_identifiers)
--
-- DATE PRESERVATION STRATEGY:
-- - created_at: When record was created in V2 system (migration timestamp for migrated data)
-- - source_created_at: Original creation timestamp from source system
-- - migrated_at: When record was migrated from V1 (NULL for native V2 records)
-- - original_created_at: Original created_at from V1 system (preserved for audit)

-- ============================================================================
-- PEOPLE - Canonical person records
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.people (
    person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Display info
    display_name TEXT,
    first_name TEXT,
    last_name TEXT,

    -- Primary identifiers (denormalized for performance)
    primary_email TEXT,
    primary_phone TEXT,

    -- Addresses
    primary_address_id UUID,  -- FK to sot.addresses
    primary_place_id UUID,    -- FK to sot.places

    -- Classification
    entity_type TEXT DEFAULT 'person' CHECK (entity_type IN ('person', 'organization', 'unknown')),
    is_organization BOOLEAN DEFAULT FALSE,
    is_system_account BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,

    -- Data quality
    data_quality TEXT DEFAULT 'normal' CHECK (data_quality IN ('verified', 'normal', 'incomplete', 'needs_review', 'garbage')),
    data_source TEXT,  -- 'clinichq', 'airtable', 'shelterluv', etc.

    -- Merge tracking
    merged_into_person_id UUID REFERENCES sot.people(person_id),

    -- Provenance
    source_system TEXT,
    source_record_id TEXT,

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),           -- V2 creation time
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_created_at TIMESTAMPTZ,                           -- Original source timestamp
    migrated_at TIMESTAMPTZ,                                 -- When migrated from V1
    original_created_at TIMESTAMPTZ                          -- V1 created_at (preserved)
);

CREATE INDEX IF NOT EXISTS idx_sot_people_email ON sot.people(primary_email) WHERE primary_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_people_phone ON sot.people(primary_phone) WHERE primary_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_people_display_name ON sot.people(display_name);
CREATE INDEX IF NOT EXISTS idx_sot_people_merged ON sot.people(merged_into_person_id) WHERE merged_into_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_people_source ON sot.people(source_system, source_record_id);

COMMENT ON TABLE sot.people IS 'Layer 3 SOT: Canonical person records with identity resolution';
COMMENT ON COLUMN sot.people.source_created_at IS 'Original creation timestamp from source system (Airtable, ClinicHQ, etc.)';
COMMENT ON COLUMN sot.people.original_created_at IS 'Preserved created_at from V1 trapper.sot_people for audit trail';
COMMENT ON COLUMN sot.people.migrated_at IS 'Timestamp when record was migrated from V1 (NULL for native V2 records)';

-- ============================================================================
-- PERSON IDENTIFIERS - Email/phone/etc for identity matching
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.person_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id) ON DELETE CASCADE,

    -- Identifier
    id_type TEXT NOT NULL CHECK (id_type IN ('email', 'phone', 'external_id')),
    id_value_raw TEXT NOT NULL,         -- Original value
    id_value_norm TEXT NOT NULL,        -- Normalized value for matching

    -- Confidence (for PetLink fabricated emails, etc.)
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),

    -- Provenance
    source_system TEXT,
    source_table TEXT,
    source_row_id UUID,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint on normalized value to prevent duplicates
    UNIQUE (id_type, id_value_norm)
);

CREATE INDEX IF NOT EXISTS idx_sot_person_identifiers_person ON sot.person_identifiers(person_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_identifiers_lookup ON sot.person_identifiers(id_type, id_value_norm);
CREATE INDEX IF NOT EXISTS idx_sot_person_identifiers_confidence ON sot.person_identifiers(confidence) WHERE confidence < 0.5;

COMMENT ON TABLE sot.person_identifiers IS 'Layer 3 SOT: Person identity markers for Data Engine matching';

-- ============================================================================
-- CATS - Canonical animal records
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.cats (
    cat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identification
    name TEXT,
    microchip TEXT,             -- Primary identifier (denormalized)
    clinichq_animal_id TEXT,    -- ClinicHQ reference
    shelterluv_animal_id TEXT,  -- ShelterLuv reference

    -- Physical attributes
    sex TEXT CHECK (sex IN ('male', 'female', 'unknown')),
    breed TEXT,
    primary_color TEXT,
    secondary_color TEXT,
    pattern TEXT,
    coat_length TEXT,
    ear_tip TEXT CHECK (ear_tip IN ('left', 'right', 'bilateral', 'none', 'unknown')),

    -- Status
    altered_status TEXT CHECK (altered_status IN ('spayed', 'neutered', 'intact', 'unknown')),
    ownership_type TEXT CHECK (ownership_type IN ('stray', 'owned', 'community', 'feral', 'unknown')),
    is_deceased BOOLEAN DEFAULT FALSE,
    deceased_at TIMESTAMPTZ,

    -- Data quality
    data_quality TEXT DEFAULT 'normal' CHECK (data_quality IN ('verified', 'normal', 'incomplete', 'needs_review', 'garbage')),
    data_source TEXT,

    -- Merge tracking
    merged_into_cat_id UUID REFERENCES sot.cats(cat_id),

    -- Provenance
    source_system TEXT,
    source_record_id TEXT,

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_created_at TIMESTAMPTZ,
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sot_cats_microchip ON sot.cats(microchip) WHERE microchip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_clinichq ON sot.cats(clinichq_animal_id) WHERE clinichq_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_shelterluv ON sot.cats(shelterluv_animal_id) WHERE shelterluv_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_merged ON sot.cats(merged_into_cat_id) WHERE merged_into_cat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_name ON sot.cats(name);

COMMENT ON TABLE sot.cats IS 'Layer 3 SOT: Canonical cat records with microchip as primary identifier';

-- ============================================================================
-- CAT IDENTIFIERS - Microchip, IDs for matching
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.cat_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id) ON DELETE CASCADE,

    -- Identifier
    id_type TEXT NOT NULL CHECK (id_type IN ('microchip', 'clinichq_animal_id', 'shelterluv_animal_id', 'airtable_id', 'petlink_id')),
    id_value TEXT NOT NULL,

    -- Provenance
    source_system TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (id_type, id_value)
);

CREATE INDEX IF NOT EXISTS idx_sot_cat_identifiers_cat ON sot.cat_identifiers(cat_id);
CREATE INDEX IF NOT EXISTS idx_sot_cat_identifiers_lookup ON sot.cat_identifiers(id_type, id_value);

COMMENT ON TABLE sot.cat_identifiers IS 'Layer 3 SOT: Cat identity markers for matching';

-- ============================================================================
-- ADDRESSES - Normalized address records
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.addresses (
    address_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Address components
    raw_address TEXT,
    formatted_address TEXT,
    display_line TEXT,

    street_number TEXT,
    street_name TEXT,
    unit_number TEXT,
    city TEXT,
    state TEXT DEFAULT 'CA',
    postal_code TEXT,
    country TEXT DEFAULT 'US',

    -- Geocoding
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(POINT, 4326),
    geocoding_status TEXT DEFAULT 'pending' CHECK (geocoding_status IN ('pending', 'success', 'failed', 'manual')),
    geocoded_at TIMESTAMPTZ,

    -- Normalization
    address_key TEXT,  -- Normalized key for dedup
    quality_score NUMERIC(3,2),

    -- Merge tracking
    merged_into_address_id UUID REFERENCES sot.addresses(address_id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sot_addresses_key ON sot.addresses(address_key) WHERE address_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_addresses_city ON sot.addresses(city);
CREATE INDEX IF NOT EXISTS idx_sot_addresses_postal ON sot.addresses(postal_code);
CREATE INDEX IF NOT EXISTS idx_sot_addresses_location ON sot.addresses USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_sot_addresses_geocoding ON sot.addresses(geocoding_status) WHERE geocoding_status = 'pending';

COMMENT ON TABLE sot.addresses IS 'Layer 3 SOT: Normalized address records with geocoding';

-- ============================================================================
-- PLACES - Canonical location records
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.places (
    place_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Display
    display_name TEXT,
    formatted_address TEXT,

    -- Address link
    sot_address_id UUID REFERENCES sot.addresses(address_id),
    is_address_backed BOOLEAN DEFAULT FALSE,

    -- Location
    location GEOGRAPHY(POINT, 4326),
    service_zone TEXT,

    -- Classification
    place_kind TEXT DEFAULT 'unknown' CHECK (place_kind IN (
        'single_family', 'apartment_unit', 'apartment_building', 'mobile_home',
        'business', 'farm', 'outdoor_site', 'clinic', 'shelter', 'unknown'
    )),
    place_origin TEXT,  -- 'geocoding', 'google_maps', 'manual', etc.

    -- Hierarchy
    parent_place_id UUID REFERENCES sot.places(place_id),
    unit_identifier TEXT,

    -- Flags
    disease_risk BOOLEAN DEFAULT FALSE,
    disease_risk_notes TEXT,
    watch_list BOOLEAN DEFAULT FALSE,
    watch_list_reason TEXT,
    has_cat_activity BOOLEAN DEFAULT FALSE,

    -- Data quality
    data_source TEXT,
    location_type TEXT CHECK (location_type IN ('rooftop', 'range_interpolated', 'geometric_center', 'approximate')),
    quality_tier TEXT CHECK (quality_tier IN ('A', 'B', 'C', 'D')),

    -- Merge tracking
    merged_into_place_id UUID REFERENCES sot.places(place_id),

    -- Activity tracking
    last_activity_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sot_places_address ON sot.places(sot_address_id);
CREATE INDEX IF NOT EXISTS idx_sot_places_parent ON sot.places(parent_place_id);
CREATE INDEX IF NOT EXISTS idx_sot_places_location ON sot.places USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_sot_places_merged ON sot.places(merged_into_place_id) WHERE merged_into_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_places_kind ON sot.places(place_kind);
CREATE INDEX IF NOT EXISTS idx_sot_places_service_zone ON sot.places(service_zone);

COMMENT ON TABLE sot.places IS 'Layer 3 SOT: Canonical location records for map display and cat-place linking';

-- ============================================================================
-- RELATIONSHIP TABLES
-- ============================================================================

-- Person-Cat relationships
CREATE TABLE IF NOT EXISTS sot.person_cat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id) ON DELETE CASCADE,
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id) ON DELETE CASCADE,

    relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        'owner', 'adopter', 'foster', 'caretaker', 'colony_caretaker', 'rescuer', 'finder', 'trapper'
    )),

    -- Evidence
    evidence_type TEXT DEFAULT 'inferred' CHECK (evidence_type IN ('manual', 'inferred', 'imported')),
    confidence NUMERIC(3,2) DEFAULT 0.8,

    -- Provenance
    source_system TEXT,
    source_table TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (person_id, cat_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_sot_person_cat_person ON sot.person_cat(person_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_cat_cat ON sot.person_cat(cat_id);

COMMENT ON TABLE sot.person_cat IS 'Layer 3 SOT: Person-to-cat relationships';

-- Cat-Place relationships
CREATE TABLE IF NOT EXISTS sot.cat_place (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id) ON DELETE CASCADE,
    place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,

    relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        'home', 'residence', 'colony_member', 'sighting', 'trapped_at', 'treated_at', 'found_at'
    )),

    -- Evidence
    evidence_type TEXT DEFAULT 'inferred' CHECK (evidence_type IN ('manual', 'inferred', 'imported', 'appointment')),
    confidence NUMERIC(3,2) DEFAULT 0.8,

    -- Provenance
    source_system TEXT,
    source_table TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (cat_id, place_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_sot_cat_place_cat ON sot.cat_place(cat_id);
CREATE INDEX IF NOT EXISTS idx_sot_cat_place_place ON sot.cat_place(place_id);

COMMENT ON TABLE sot.cat_place IS 'Layer 3 SOT: Cat-to-place relationships';

-- Person-Place relationships
CREATE TABLE IF NOT EXISTS sot.person_place (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id) ON DELETE CASCADE,
    place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,

    relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        'resident', 'owner', 'manager', 'caretaker', 'works_at', 'volunteers_at'
    )),

    -- Evidence
    evidence_type TEXT DEFAULT 'inferred' CHECK (evidence_type IN ('manual', 'inferred', 'imported')),
    confidence NUMERIC(3,2) DEFAULT 0.8,
    is_primary BOOLEAN DEFAULT FALSE,

    -- Provenance
    source_system TEXT,
    source_table TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (person_id, place_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_sot_person_place_person ON sot.person_place(person_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_place_place ON sot.person_place(place_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_place_primary ON sot.person_place(person_id) WHERE is_primary = TRUE;

COMMENT ON TABLE sot.person_place IS 'Layer 3 SOT: Person-to-place relationships';

-- ============================================================================
-- ADD FOREIGN KEYS AFTER TABLE CREATION
-- ============================================================================
ALTER TABLE sot.people
    ADD CONSTRAINT fk_people_primary_address FOREIGN KEY (primary_address_id) REFERENCES sot.addresses(address_id),
    ADD CONSTRAINT fk_people_primary_place FOREIGN KEY (primary_place_id) REFERENCES sot.places(place_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_people_updated_at
    BEFORE UPDATE ON sot.people
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_cats_updated_at
    BEFORE UPDATE ON sot.cats
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_addresses_updated_at
    BEFORE UPDATE ON sot.addresses
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_places_updated_at
    BEFORE UPDATE ON sot.places
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- Active people (not merged)
CREATE OR REPLACE VIEW sot.v_active_people AS
SELECT * FROM sot.people WHERE merged_into_person_id IS NULL;

-- Active cats (not merged)
CREATE OR REPLACE VIEW sot.v_active_cats AS
SELECT * FROM sot.cats WHERE merged_into_cat_id IS NULL;

-- Active places (not merged)
CREATE OR REPLACE VIEW sot.v_active_places AS
SELECT * FROM sot.places WHERE merged_into_place_id IS NULL;

COMMENT ON VIEW sot.v_active_people IS 'People not merged into another record';
COMMENT ON VIEW sot.v_active_cats IS 'Cats not merged into another record';
COMMENT ON VIEW sot.v_active_places IS 'Places not merged into another record';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'sot.people', 'sot.person_identifiers',
        'sot.cats', 'sot.cat_identifiers',
        'sot.addresses', 'sot.places',
        'sot.person_cat', 'sot.cat_place', 'sot.person_place'
    ];
    v_table TEXT;
    v_missing TEXT[];
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema || '.' || table_name = v_table
        ) THEN
            v_missing := array_append(v_missing, v_table);
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Failed to create SOT tables: %', array_to_string(v_missing, ', ');
    END IF;

    RAISE NOTICE 'V2 SOT tables created successfully';
    RAISE NOTICE 'Tables: %', array_to_string(v_tables, ', ');
END $$;
