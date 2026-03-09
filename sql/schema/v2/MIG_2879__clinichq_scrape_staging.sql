-- MIG_2879: ClinicHQ scrape staging table (FFS-360)
--
-- Daniel's scraper captures the full ClinicHQ appointment UI, producing a
-- merged CSV with fields unavailable through the API: medical notes, quick
-- notes, appointment notes, trapper attribution, deceased labels, and hidden
-- microchips in free text.
--
-- 41,234 rows | 10,403 unique clients | Apr 2015 – Sep 2024
--
-- This migration:
--   Step 1: Create source.clinichq_scrape flat staging table
--   Step 2: Create indexes for common query patterns
--   Step 3: Add table/column comments
--
-- Design: Flat table (not JSONB) because the scrape is a stable CSV with
-- known columns. Direct SQL queries, indexing, and type safety without
-- JSON extraction overhead. Keyed on record_id for idempotent upsert.
--
-- Safety: Additive only — new table and indexes. No existing data modified.
-- Depends on: source schema (MIG_2001)

BEGIN;

-- =============================================================================
-- Step 1: Create staging table
-- =============================================================================

CREATE TABLE IF NOT EXISTS source.clinichq_scrape (
    record_id                TEXT PRIMARY KEY,
    client_id                TEXT NOT NULL,
    appointment_date         TEXT,
    appointment_type         TEXT,
    checkout_status          TEXT,
    owner_display_name       TEXT,
    animal_heading_raw       TEXT,
    animal_name              TEXT,
    animal_id                TEXT,
    heading_labels_json      JSONB,
    animal_info_raw          TEXT,
    animal_species_sex_breed TEXT,
    animal_colors            TEXT,
    animal_type              TEXT,
    animal_weight_info       TEXT,
    animal_age               TEXT,
    animal_microchip_info    TEXT,
    animal_trapper           TEXT,
    animal_caution           TEXT,
    animal_quick_notes       TEXT,
    animal_appointment_notes TEXT,
    owner_info_text          TEXT,
    services_text            TEXT,
    sterilization_status     TEXT,
    weight                   TEXT,
    microchip                TEXT,
    internal_medical_notes   TEXT,
    vet_notes                TEXT,
    scraped_at_utc           TIMESTAMPTZ,
    imported_at              TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Step 2: Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_client
    ON source.clinichq_scrape(client_id);

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_animal_id
    ON source.clinichq_scrape(animal_id)
    WHERE animal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_microchip
    ON source.clinichq_scrape(microchip)
    WHERE microchip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_appt_date
    ON source.clinichq_scrape(appointment_date);

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_trapper
    ON source.clinichq_scrape(animal_trapper)
    WHERE animal_trapper IS NOT NULL;

-- =============================================================================
-- Step 3: Comments
-- =============================================================================

COMMENT ON TABLE source.clinichq_scrape IS
    'ClinicHQ web UI scrape data — fields not available via API (MIG_2879)';

COMMENT ON COLUMN source.clinichq_scrape.record_id IS
    'Unique appointment record ID from ClinicHQ (PK, used for idempotent upsert)';
COMMENT ON COLUMN source.clinichq_scrape.client_id IS
    'ClinicHQ client (owner) ID';
COMMENT ON COLUMN source.clinichq_scrape.appointment_date IS
    'Appointment date as displayed in ClinicHQ UI (text, not parsed)';
COMMENT ON COLUMN source.clinichq_scrape.heading_labels_json IS
    'JSONB array of heading labels (e.g., Deceased:, Spayed, Neutered)';
COMMENT ON COLUMN source.clinichq_scrape.animal_id IS
    'ClinicHQ animal ID — bridges to sot.cat_identifiers(clinichq_animal_id)';
COMMENT ON COLUMN source.clinichq_scrape.microchip IS
    'Parsed microchip number — bridges to sot.cat_identifiers(microchip)';
COMMENT ON COLUMN source.clinichq_scrape.animal_trapper IS
    'Trapper name from ClinicHQ UI — not available via API';
COMMENT ON COLUMN source.clinichq_scrape.animal_quick_notes IS
    'Quick notes field — not available via API (51.4% coverage)';
COMMENT ON COLUMN source.clinichq_scrape.animal_appointment_notes IS
    'Appointment notes — not available via API (63.0% coverage)';
COMMENT ON COLUMN source.clinichq_scrape.internal_medical_notes IS
    'Internal medical notes — not available via API (16.4% coverage)';
COMMENT ON COLUMN source.clinichq_scrape.vet_notes IS
    'Vet notes from medical records merge';
COMMENT ON COLUMN source.clinichq_scrape.sterilization_status IS
    'Sterilization status from ClinicHQ UI';
COMMENT ON COLUMN source.clinichq_scrape.animal_caution IS
    'Caution/warning flags on the animal record';
COMMENT ON COLUMN source.clinichq_scrape.scraped_at_utc IS
    'When Daniel''s scraper captured this record';
COMMENT ON COLUMN source.clinichq_scrape.imported_at IS
    'When this row was imported/last refreshed into Atlas';

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE 'MIG_2879: source.clinichq_scrape table created';
    RAISE NOTICE '  Ready for import via: node scripts/ingest/clinichq_scrape_import.mjs';
END $$;

COMMIT;
