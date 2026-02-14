-- MIG_146__sot_appointments.sql
-- Create sot_appointments table from ClinicHQ appointment_info records
--
-- Problem:
--   Appointment data exists in staged_records but there's no structured
--   appointments table. When viewing a cat profile, "No appointments found"
--   even though we have the data.
--
-- Solution:
--   Create sot_appointments table and populate from appointment_info.
--   Link to cats via microchip.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_146__sot_appointments.sql

-- ============================================================
-- 1. Create sot_appointments table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.sot_appointments (
    appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Linked entities
    cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    person_id UUID REFERENCES trapper.sot_people(person_id),
    place_id UUID REFERENCES trapper.places(place_id),

    -- Appointment details
    appointment_date DATE NOT NULL,
    appointment_number TEXT,  -- e.g., "23-2431"

    -- Service/procedure info
    service_type TEXT,  -- e.g., "Cat Spay", "Neuter", "Rabies vaccine"
    is_spay BOOLEAN DEFAULT FALSE,
    is_neuter BOOLEAN DEFAULT FALSE,

    -- Staff
    vet_name TEXT,
    technician TEXT,

    -- Medical observations
    temperature NUMERIC(4,1),
    medical_notes TEXT,

    -- Status flags from appointment
    is_lactating BOOLEAN,
    is_pregnant BOOLEAN,
    is_in_heat BOOLEAN,

    -- Source tracking
    data_source TEXT NOT NULL DEFAULT 'clinichq',
    source_system TEXT,
    source_record_id TEXT,
    source_row_hash TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_cat_id ON trapper.sot_appointments(cat_id);
CREATE INDEX IF NOT EXISTS idx_appointments_person_id ON trapper.sot_appointments(person_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON trapper.sot_appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_source ON trapper.sot_appointments(source_system, source_record_id);

COMMENT ON TABLE trapper.sot_appointments IS
'Source of truth for appointments/procedures. Initially populated from ClinicHQ appointment_info.';

-- ============================================================
-- 2. Populate from appointment_info
-- ============================================================

\echo ''
\echo 'Populating sot_appointments from ClinicHQ appointment_info...'

INSERT INTO trapper.sot_appointments (
    cat_id,
    appointment_date,
    appointment_number,
    service_type,
    is_spay,
    is_neuter,
    vet_name,
    technician,
    temperature,
    medical_notes,
    is_lactating,
    is_pregnant,
    is_in_heat,
    data_source,
    source_system,
    source_record_id,
    source_row_hash
)
SELECT
    c.cat_id,
    TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') AS appointment_date,
    sr.payload->>'Number' AS appointment_number,
    sr.payload->>'Service / Subsidy' AS service_type,
    sr.payload->>'Spay' = 'Yes' AS is_spay,
    sr.payload->>'Neuter' = 'Yes' AS is_neuter,
    sr.payload->>'Vet Name' AS vet_name,
    sr.payload->>'Technician' AS technician,
    NULLIF(sr.payload->>'Temperature', '')::NUMERIC(4,1) AS temperature,
    sr.payload->>'Internal Medical Notes' AS medical_notes,
    sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes' AS is_lactating,
    sr.payload->>'Pregnant' = 'Yes' AS is_pregnant,
    sr.payload->>'In Heat' = 'Yes' AS is_in_heat,
    'clinichq' AS data_source,
    'clinichq' AS source_system,
    sr.source_row_id,
    sr.row_hash
FROM trapper.staged_records sr
LEFT JOIN trapper.cat_identifiers ci ON
    ci.id_type = 'microchip'
    AND ci.id_value = sr.payload->>'Microchip Number'
LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND sr.payload->>'Date' IS NOT NULL
  AND sr.payload->>'Date' <> ''
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Create view for API
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_cat_appointments AS
SELECT
    a.appointment_id,
    a.cat_id,
    c.display_name AS cat_name,
    a.appointment_date,
    a.appointment_number,
    a.service_type,
    CASE
        WHEN a.is_spay THEN 'Spay'
        WHEN a.is_neuter THEN 'Neuter'
        WHEN a.service_type IS NOT NULL THEN a.service_type
        ELSE 'Appointment'
    END AS appointment_type,
    a.vet_name,
    a.technician,
    a.temperature,
    a.medical_notes,
    a.is_lactating,
    a.is_pregnant,
    a.is_in_heat,
    a.data_source,
    a.created_at
FROM trapper.sot_appointments a
LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW trapper.v_cat_appointments IS
'Appointments with cat info for display in cat profiles.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo 'Appointments created:'
SELECT
    COUNT(*) as total,
    COUNT(cat_id) as linked_to_cat,
    COUNT(*) FILTER (WHERE is_spay) as spays,
    COUNT(*) FILTER (WHERE is_neuter) as neuters,
    MIN(appointment_date) as earliest,
    MAX(appointment_date) as latest
FROM trapper.sot_appointments;

\echo ''
\echo 'Verify example cat (981020053084012) appointments:'
SELECT
    a.appointment_date,
    a.appointment_number,
    a.service_type,
    a.vet_name,
    a.medical_notes
FROM trapper.sot_appointments a
JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id
WHERE ci.id_value = '981020053084012'
ORDER BY a.appointment_date;

\echo ''
\echo 'Top cats by appointment count:'
SELECT
    c.display_name,
    COUNT(*) as appointment_count
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
GROUP BY c.cat_id, c.display_name
ORDER BY appointment_count DESC
LIMIT 5;

SELECT 'MIG_146 Complete' AS status;
