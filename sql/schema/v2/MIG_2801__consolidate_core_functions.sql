-- MIG_2801: Consolidate Core Function Documentation
-- Date: 2026-03-01
-- Purpose: Document canonical versions of heavily-redefined functions
--
-- BACKGROUND:
-- Several core functions were redefined 9-11 times across V1 and V2 migrations
-- as bugs were fixed and features added. This migration establishes the
-- canonical reference point for each function and adds comprehensive documentation.
--
-- FUNCTIONS CONSOLIDATED:
-- 1. sot.classify_owner_name() - 11 versions, latest MIG_2547
-- 2. sot.link_cats_to_places() - 11 versions, latest MIG_2601
-- 3. sot.find_or_create_cat_by_microchip() - 10 versions, latest MIG_2340
-- 4. trapper.data_engine_resolve_identity() - 9 versions, V2 uses wrappers (MIG_2090)
--
-- This migration does NOT redefine the functions - they remain in their
-- respective migrations. Instead, it adds COMMENT ON FUNCTION to document
-- the canonical version and key implementation details.

-- =============================================================================
-- 1. classify_owner_name()
-- =============================================================================
-- Canonical Version: MIG_2547
-- Previous Versions: MIG_571, 581, 867 (V1), MIG_1011_v2, 2003, 2360, 2373, 2414, 2418, 2498, 2547 (V2)
-- Key Changes:
--   - MIG_2360: Added lookup tables (common_first_names, occupation_surnames, business_service_words)
--   - MIG_2547: Added 2-parameter overload for first/last name separation
-- Implements: INV-43 (business name detection), INV-44 (occupation surnames), INV-45 (lookup tables)

COMMENT ON FUNCTION sot.classify_owner_name(TEXT) IS
'Classifies owner name strings into categories for identity resolution.

CANONICAL VERSION: MIG_2801 (consolidated from 11 previous versions)
LATEST IMPLEMENTATION: MIG_2547

PARAMETERS:
  p_display_name TEXT - Full name string to classify

RETURNS: TEXT - One of:
  - ''likely_person'' - Appears to be a real person name
  - ''address'' - Contains street address patterns
  - ''apartment_complex'' - Multi-unit housing name
  - ''organization'' - Business or organization name
  - ''known_org'' - Matches known organization patterns
  - ''garbage'' - Unusable/placeholder text
  - ''unknown'' - Cannot classify

KEY IMPLEMENTATION DETAILS:
  1. Uses lookup tables for maintainability (not pure regex):
     - sot.common_first_names (SSA baby names top 1000 per decade)
     - sot.occupation_surnames (Carpenter, Baker, Mason, etc.)
     - sot.business_service_words (Surgery, Carpets, Market, etc.)
  2. Detects "World Of X" business pattern
  3. Distinguishes "John Carpenter" (person) from "Carpenter" (ambiguous)
  4. Strips FFSC/SCAS suffix before classification

INVARIANTS IMPLEMENTED:
  - INV-43: Business names with service keywords → ''organization''
  - INV-44: Occupation surnames need first name check
  - INV-45: Lookup tables over pure regex

EXAMPLE USAGE:
  SELECT sot.classify_owner_name(''World Of Carpets Santa Rosa'');  -- ''organization''
  SELECT sot.classify_owner_name(''John Carpenter'');                -- ''likely_person''
  SELECT sot.classify_owner_name(''Carpenter'');                     -- ''organization'' (no first name)
  SELECT sot.classify_owner_name(''1234 Main St'');                  -- ''address''
';

-- Also document the 2-parameter overload
COMMENT ON FUNCTION sot.classify_owner_name(TEXT, TEXT) IS
'Two-parameter overload for classify_owner_name when first/last name are separate.

CANONICAL VERSION: MIG_2801
IMPLEMENTATION: MIG_2547

Concatenates first_name and last_name with space, then delegates to single-parameter version.
Created to fix signature mismatch in ops.upsert_clinic_account_for_owner().

PARAMETERS:
  p_first_name TEXT - First name
  p_last_name TEXT - Last name

RETURNS: Same as single-parameter version
';

-- =============================================================================
-- 2. link_cats_to_places()
-- =============================================================================
-- Canonical Version: MIG_2601
-- Previous Versions: MIG_797, 870, 884, 889, 912, 975 (V1), MIG_2010, 2021, 2433, 2505, 2601 (V2)
-- Key Changes:
--   - MIG_889: Fundamental rewrite - appointment-based linking, LIMIT 1 per person
--   - MIG_975: Added place_kind filtering (V1)
--   - MIG_2601: Re-added place_kind filtering (lost in V2 migration)
-- Implements: INV-26 (LIMIT 1 per person), INV-28 (appointment-based linking)

COMMENT ON FUNCTION sot.link_cats_to_places() IS
'Links cats to places via person relationships and appointment data.

CANONICAL VERSION: MIG_2801 (consolidated from 11 previous versions)
LATEST IMPLEMENTATION: MIG_2601

PARAMETERS: None (operates on all unlinked cats)

RETURNS: TABLE (
  cats_linked_home INTEGER,      -- Cats linked via owner/adopter/foster relationships
  cats_linked_appointment INTEGER, -- Cats linked via appointment inferred_place_id
  cats_skipped INTEGER,          -- Cats skipped (already linked or no valid place)
  total_edges INTEGER            -- Total cat_place_relationships created
)

KEY IMPLEMENTATION DETAILS:
  1. Two linking strategies:
     a) Appointment-based: Uses appointment.inferred_place_id (highest priority)
     b) Person-based: person_cat → person_place chain (secondary)

  2. LIMIT 1 per person: Only links to the BEST place per person
     - Ordered by: confidence DESC, created_at DESC
     - Prevents address pollution (cats at ALL historical addresses)

  3. Place kind filtering - excludes non-residential:
     - business, clinic, outdoor_site, neighborhood, shelter
     - Prevents work address pollution

  4. Staff exclusion: Does not link cats to staff/trapper addresses

INVARIANTS IMPLEMENTED:
  - INV-26: LIMIT 1 per person, highest confidence
  - INV-28: Must use link_cats_to_appointment_places() for appointment linking

POLLUTION PREVENTION:
  - A cat should have at most 2-3 links of same relationship_type
  - More than 5 triggers data_quality_alerts via trg_cat_place_pollution_check
  - Monitor with: SELECT * FROM ops.v_cat_place_pollution_check

RELATED FUNCTIONS:
  - sot.link_cats_to_appointment_places() - Appointment-based linking (called internally)
  - sot.should_compute_disease_for_place() - Disease computation gating

EXAMPLE USAGE:
  SELECT * FROM sot.link_cats_to_places();
  -- Returns: cats_linked_home | cats_linked_appointment | cats_skipped | total_edges
';

-- =============================================================================
-- 3. find_or_create_cat_by_microchip()
-- =============================================================================
-- Canonical Version: MIG_2340
-- Previous Versions: MIG_180, 488, 576, 865, 873 (V1), MIG_2008, 2051, 2054, 2090, 2340 (V2)
-- Key Changes:
--   - MIG_865: Fixed COALESCE empty string bug (critical)
--   - MIG_2051: Added animal ID parameters (clinichq_animal_id, shelterluv_animal_id)
-- Implements: INV-39 (animal IDs passed during ingest)

COMMENT ON FUNCTION sot.find_or_create_cat_by_microchip(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
'Finds existing cat by microchip or creates new cat record with full provenance.

CANONICAL VERSION: MIG_2801 (consolidated from 10 previous versions)
LATEST IMPLEMENTATION: MIG_2340

PARAMETERS:
  p_microchip TEXT           - Microchip number (primary identifier)
  p_name TEXT                - Cat display name
  p_sex TEXT                 - Sex (M, F, U)
  p_breed TEXT               - Breed description
  p_altered_status TEXT      - Altered status (altered, intact, unknown)
  p_primary_color TEXT       - Primary coat color
  p_secondary_color TEXT     - Secondary coat color
  p_ownership_type TEXT      - Ownership classification
  p_clinichq_animal_id TEXT  - ClinicHQ animal number (e.g., "21-118")
  p_shelterluv_animal_id TEXT - ShelterLuv animal ID
  p_source_system TEXT       - Source system identifier

RETURNS: UUID - cat_id of found or created cat

KEY IMPLEMENTATION DETAILS:
  1. Microchip matching: Exact match on normalized microchip value

  2. Empty string handling (MIG_865 fix):
     - Uses NULLIF(field, '''') to treat empty strings as NULL
     - Prevents "Unknown" and empty placeholders from blocking updates
     - Critical for: display_name, primary_color, secondary_color, breed

  3. Animal ID storage (MIG_2051):
     - Stores IDs both denormalized on sot.cats AND in sot.cat_identifiers
     - Enables cross-system matching (ClinicHQ ↔ ShelterLuv)
     - Required by INV-39

  4. Provenance tracking:
     - Sets source_system on cat record
     - Creates cat_identifiers entries for all provided IDs

INVARIANTS IMPLEMENTED:
  - INV-39: Animal IDs must be passed during ingest

EXAMPLE USAGE:
  SELECT sot.find_or_create_cat_by_microchip(
    ''985112345678901'',  -- microchip
    ''Whiskers'',         -- name
    ''M'',                -- sex
    ''Domestic Shorthair'', -- breed
    ''altered'',          -- altered_status
    ''orange'',           -- primary_color
    ''white'',            -- secondary_color
    ''community'',        -- ownership_type
    ''21-118'',           -- clinichq_animal_id
    NULL,                 -- shelterluv_animal_id
    ''clinichq''          -- source_system
  );
';

-- =============================================================================
-- 4. data_engine_resolve_identity()
-- =============================================================================
-- Note: V2 uses wrapper functions (MIG_2090) that delegate to V1 implementation
-- Canonical Reference: trapper.data_engine_resolve_identity() via MIG_2090 wrapper
-- V1 Versions: MIG_315, 361, 488, 509, 522, 527, 532, 559, 564

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
'Core identity resolution function - finds or creates person from contact info.

CANONICAL VERSION: MIG_2801 (documentation only - implementation in V1)
IMPLEMENTATION: V1 archive (latest MIG_564), accessed via MIG_2090 wrappers

NOTE: This function lives in the trapper schema as a V1 compatibility wrapper.
The actual implementation is in the V1 archive. V2 code should use this wrapper
rather than accessing V1 functions directly.

PARAMETERS:
  p_email TEXT           - Email address (primary identifier)
  p_phone TEXT           - Phone number (secondary identifier)
  p_first_name TEXT      - First name
  p_last_name TEXT       - Last name
  p_address TEXT         - Address string
  p_source_system TEXT   - Source system identifier

RETURNS: TABLE (
  person_id UUID,
  decision_type TEXT,    -- ''matched'', ''created'', ''review_pending'', ''rejected''
  match_confidence FLOAT,
  decision_reason TEXT
)

KEY IMPLEMENTATION DETAILS:
  1. Multi-signal weighted scoring:
     - Email match: Highest weight (tier 1)
     - Phone + name: High weight (tier 2)
     - Phone only: Medium weight (tier 3)
     - Name + address: Lower weight (tier 4, often review_pending)

  2. Rejection cases (returns decision_type = ''rejected''):
     - No email AND no phone provided
     - Name classified as ''garbage'' or ''address''
     - Soft-blacklisted identifiers

  3. Review queue routing:
     - Uncertain matches → ops.v_tier4_pending_review
     - Staff reviews via /admin/reviews/identity

INVARIANTS IMPLEMENTED:
  - Identity by identifier only (never name alone)
  - Soft blacklist filtering
  - Review queue for uncertain matches

RELATED FUNCTIONS:
  - sot.find_or_create_person() - Higher-level wrapper (recommended)
  - sot.classify_owner_name() - Name classification
  - sot.data_engine_soft_blacklist - Blocked identifiers

USAGE NOTE:
  Prefer sot.find_or_create_person() for most use cases.
  Direct data_engine_resolve_identity() calls are for advanced scenarios.
';

-- =============================================================================
-- Additional utility function documentation
-- =============================================================================

COMMENT ON FUNCTION sot.should_be_person(TEXT, TEXT) IS
'Gate function: Determines if owner info should create a person record.

CANONICAL VERSION: MIG_2801
PURPOSE: Prevents pseudo-profiles (addresses, orgs, garbage) from creating person records

PARAMETERS:
  p_first_name TEXT - Owner first name field
  p_last_name TEXT  - Owner last name field

RETURNS: BOOLEAN
  - TRUE: Valid person, proceed with find_or_create_person()
  - FALSE: Pseudo-profile, route to ops.clinic_owner_accounts instead

IMPLEMENTATION:
  Calls classify_owner_name() and checks result:
  - ''likely_person'' → TRUE
  - ''address'', ''organization'', ''garbage'', etc. → FALSE

INVARIANTS IMPLEMENTED:
  - INV-25: ClinicHQ pseudo-profiles are NOT people
  - INV-29: Don''t create people without identifiers

EXAMPLE USAGE:
  IF sot.should_be_person(owner_first, owner_last) THEN
    -- Create person record
    person_id := sot.find_or_create_person(...);
  ELSE
    -- Route to clinic_owner_accounts
    INSERT INTO ops.clinic_owner_accounts ...
  END IF;
';

-- =============================================================================
-- Verification queries
-- =============================================================================
-- After applying, verify function comments exist:
--
-- \df+ sot.classify_owner_name
-- \df+ sot.link_cats_to_places
-- \df+ sot.find_or_create_cat_by_microchip
-- \df+ trapper.data_engine_resolve_identity
-- \df+ sot.should_be_person
--
-- Or query pg_proc:
-- SELECT proname, obj_description(oid, 'pg_proc')
-- FROM pg_proc
-- WHERE proname IN ('classify_owner_name', 'link_cats_to_places',
--                   'find_or_create_cat_by_microchip', 'data_engine_resolve_identity');
-- =============================================================================
