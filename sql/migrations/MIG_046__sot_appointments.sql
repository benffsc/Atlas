-- MIG_046__sot_appointments.sql
-- Source-agnostic canonical appointments table
--
-- Purpose:
--   Create a unified appointments concept that can be populated from any source
--   (ClinicHQ today, different clinic software tomorrow). The UI shows "Appointments"
--   without caring about the source system.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_046__sot_appointments.sql

\echo '============================================'
\echo 'MIG_046: Source-of-Truth Appointments'
\echo '============================================'

-- ============================================
-- PART 1: Appointment Status Enum
-- ============================================
\echo ''
\echo 'Creating appointment_status enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE trapper.appointment_status AS ENUM (
            'scheduled',
            'confirmed',
            'checked_in',
            'in_progress',
            'completed',
            'cancelled',
            'no_show',
            'rescheduled'
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Appointment Type Enum
-- ============================================
\echo 'Creating appointment_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_type') THEN
        CREATE TYPE trapper.appointment_type AS ENUM (
            'spay',
            'neuter',
            'vaccines',
            'checkup',
            'surgery_other',
            'followup',
            'unknown'
        );
    END IF;
END$$;

-- ============================================
-- PART 3: Appointments Table
-- ============================================
\echo ''
\echo 'Creating sot_appointments table...'

CREATE TABLE IF NOT EXISTS trapper.sot_appointments (
    appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL,
    scheduled_date DATE GENERATED ALWAYS AS (scheduled_at::DATE) STORED,
    duration_minutes INT,

    -- Status
    status trapper.appointment_status NOT NULL DEFAULT 'scheduled',
    appointment_type trapper.appointment_type NOT NULL DEFAULT 'unknown',

    -- Entity links (all optional - may only have partial info)
    cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    person_id UUID REFERENCES trapper.sot_people(person_id),
    place_id UUID REFERENCES trapper.places(place_id),

    -- Denormalized info (for display when links aren't resolved)
    animal_name TEXT,
    client_name TEXT,
    client_phone TEXT,
    client_address TEXT,

    -- Service details
    provider_name TEXT,        -- Vet/clinic name
    service_notes TEXT,        -- What was done

    -- Source tracking (critical for abstraction)
    source_system TEXT NOT NULL,           -- 'clinichq', 'new_clinic_software', etc.
    source_record_id TEXT,                 -- ID in source system
    source_record_hash TEXT,               -- For dedup/sync
    data_source trapper.data_source NOT NULL DEFAULT 'legacy_import',

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint on source record
    CONSTRAINT sot_appointments_source_unique UNIQUE (source_system, source_record_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sot_appointments_scheduled_date
    ON trapper.sot_appointments (scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_sot_appointments_cat_id
    ON trapper.sot_appointments (cat_id) WHERE cat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_appointments_person_id
    ON trapper.sot_appointments (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_appointments_place_id
    ON trapper.sot_appointments (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_appointments_status
    ON trapper.sot_appointments (status);
CREATE INDEX IF NOT EXISTS idx_sot_appointments_source
    ON trapper.sot_appointments (source_system, source_record_id);

COMMENT ON TABLE trapper.sot_appointments IS
'Canonical appointments from any source system.
The UI displays "Appointments" without knowing about ClinicHQ.
source_system tracks where the data came from.
When switching clinic software, update the sync pipeline - not the UI.';

-- ============================================
-- PART 4: View for syncing from ClinicHQ
-- ============================================
\echo ''
\echo 'Creating v_clinichq_appointments_to_sync view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_appointments_to_sync AS
WITH latest_runs AS (
    SELECT run_id, source_system, source_table
    FROM trapper.v_latest_ingest_run
    WHERE source_system = 'clinichq'
),
appt_data AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_row_id,
        sr.source_row_hash,
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Microchip Number' AS microchip,
        sr.payload->>'Date' AS appt_date_str,
        sr.payload->>'Animal Name' AS animal_name,
        sr.payload->>'Vet Name' AS vet_name,
        sr.payload
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
),
owner_data AS (
    SELECT
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Microchip Number' AS microchip,
        TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')) AS client_name,
        COALESCE(sr.payload->>'Owner Cell Phone', sr.payload->>'Owner Phone') AS client_phone,
        sr.payload->>'Owner Address' AS client_address
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
)
SELECT
    a.staged_record_id,
    a.source_row_id,
    a.source_row_hash,
    -- Parse date (ClinicHQ format is typically MM/DD/YYYY or YYYY-MM-DD)
    CASE
        WHEN a.appt_date_str ~ '^\d{4}-\d{2}-\d{2}' THEN a.appt_date_str::DATE
        WHEN a.appt_date_str ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN TO_DATE(a.appt_date_str, 'MM/DD/YYYY')
        ELSE NULL
    END AS scheduled_date,
    a.animal_name,
    a.vet_name AS provider_name,
    o.client_name,
    o.client_phone,
    o.client_address,
    a.animal_number,
    a.microchip,
    -- Try to find linked cat
    (SELECT c.cat_id FROM trapper.sot_cats c
     JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
     WHERE ci.id_type = 'microchip' AND ci.id_value = a.microchip
     LIMIT 1) AS matched_cat_id
FROM appt_data a
LEFT JOIN owner_data o ON (
    (a.animal_number IS NOT NULL AND a.animal_number = o.animal_number)
    OR (a.microchip IS NOT NULL AND a.microchip <> '' AND a.microchip = o.microchip)
)
WHERE a.appt_date_str IS NOT NULL
  AND a.appt_date_str <> '';

COMMENT ON VIEW trapper.v_clinichq_appointments_to_sync IS
'View for syncing ClinicHQ appointment data to sot_appointments.
Joins appointment info with owner info and attempts to match cats.';

-- ============================================
-- PART 5: Sync Function
-- ============================================
\echo ''
\echo 'Creating sync_clinichq_appointments function...'

CREATE OR REPLACE FUNCTION trapper.sync_clinichq_appointments()
RETURNS TABLE (
    inserted INT,
    updated INT,
    skipped INT
) AS $$
DECLARE
    v_inserted INT := 0;
    v_updated INT := 0;
    v_skipped INT := 0;
BEGIN
    -- Insert new appointments
    INSERT INTO trapper.sot_appointments (
        scheduled_at,
        status,
        appointment_type,
        cat_id,
        animal_name,
        client_name,
        client_phone,
        client_address,
        provider_name,
        source_system,
        source_record_id,
        source_record_hash,
        data_source
    )
    SELECT
        (v.scheduled_date + TIME '09:00:00')::TIMESTAMPTZ,  -- Default to 9am
        'completed'::trapper.appointment_status,  -- Historical = completed
        'unknown'::trapper.appointment_type,
        v.matched_cat_id,
        v.animal_name,
        v.client_name,
        v.client_phone,
        v.client_address,
        v.provider_name,
        'clinichq',
        v.source_row_id,
        v.source_row_hash,
        'legacy_import'::trapper.data_source
    FROM trapper.v_clinichq_appointments_to_sync v
    WHERE v.scheduled_date IS NOT NULL
    ON CONFLICT (source_system, source_record_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Count total eligible for sync
    SELECT COUNT(*) INTO v_skipped
    FROM trapper.v_clinichq_appointments_to_sync
    WHERE scheduled_date IS NOT NULL;

    v_skipped := v_skipped - v_inserted;

    RETURN QUERY SELECT v_inserted, v_updated, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.sync_clinichq_appointments IS
'Syncs ClinicHQ appointment data to canonical sot_appointments.
Idempotent: skips records that already exist (by source_record_id).';

-- ============================================
-- PART 6: Appointments List View
-- ============================================
\echo ''
\echo 'Creating v_appointment_list view...'

CREATE OR REPLACE VIEW trapper.v_appointment_list AS
SELECT
    a.appointment_id,
    a.scheduled_at,
    a.scheduled_date,
    a.status::TEXT AS status,
    a.appointment_type::TEXT AS appointment_type,
    -- Cat info
    a.cat_id,
    COALESCE(c.display_name, a.animal_name) AS cat_name,
    -- Person info
    a.person_id,
    COALESCE(p.display_name, a.client_name) AS person_name,
    a.client_phone,
    -- Place info
    a.place_id,
    COALESCE(pl.display_name, a.client_address) AS place_name,
    -- Provider
    a.provider_name,
    -- Source
    a.source_system,
    a.created_at
FROM trapper.sot_appointments a
LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
LEFT JOIN trapper.places pl ON pl.place_id = a.place_id
ORDER BY a.scheduled_date DESC, a.scheduled_at DESC;

COMMENT ON VIEW trapper.v_appointment_list IS
'Appointments with resolved entity links for display.';

-- ============================================
-- PART 7: Cat Appointments View
-- ============================================
\echo ''
\echo 'Creating v_cat_appointments view...'

CREATE OR REPLACE VIEW trapper.v_cat_appointments AS
SELECT
    a.appointment_id,
    a.cat_id,
    a.scheduled_at,
    a.scheduled_date,
    a.status::TEXT AS status,
    a.appointment_type::TEXT AS appointment_type,
    a.provider_name,
    a.client_name,
    a.client_phone,
    a.service_notes,
    a.source_system
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
ORDER BY a.scheduled_date DESC;

COMMENT ON VIEW trapper.v_cat_appointments IS
'Appointments for a specific cat, ordered by date.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_046 Complete'
\echo '============================================'

\echo ''
\echo 'New tables:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name = 'sot_appointments';

\echo ''
\echo 'To sync ClinicHQ appointments:'
\echo '  SELECT * FROM trapper.sync_clinichq_appointments();'
\echo ''
\echo 'To view appointments:'
\echo '  SELECT * FROM trapper.v_appointment_list LIMIT 20;'
\echo ''
