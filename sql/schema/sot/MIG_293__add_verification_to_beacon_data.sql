-- MIG_293__add_verification_to_beacon_data.sql
-- Add verification tracking to beacon data tables
--
-- Purpose:
--   AI-parsed data from journal entries needs human verification.
--   This adds verified_at and verified_by_staff_id to beacon tables.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_293__add_verification_to_beacon_data.sql

\echo '============================================'
\echo 'MIG_293: Add Verification to Beacon Data'
\echo '============================================'

-- ============================================
-- PART 1: Add to place_colony_estimates
-- ============================================
\echo ''
\echo 'Adding verification columns to place_colony_estimates...'

ALTER TABLE trapper.place_colony_estimates
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.place_colony_estimates.verified_at IS 'When this estimate was manually verified';
COMMENT ON COLUMN trapper.place_colony_estimates.verified_by_staff_id IS 'Staff who verified this estimate';

CREATE INDEX IF NOT EXISTS idx_colony_estimates_verified
    ON trapper.place_colony_estimates(verified_at)
    WHERE verified_at IS NULL;

-- ============================================
-- PART 2: Add to cat_birth_events
-- ============================================
\echo ''
\echo 'Adding verification and source_type columns to cat_birth_events...'

ALTER TABLE trapper.cat_birth_events
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.cat_birth_events.verified_at IS 'When this birth record was verified';
COMMENT ON COLUMN trapper.cat_birth_events.verified_by_staff_id IS 'Staff who verified this record';

CREATE INDEX IF NOT EXISTS idx_birth_events_verified
    ON trapper.cat_birth_events(verified_at)
    WHERE verified_at IS NULL;

-- ============================================
-- PART 3: Add to cat_mortality_events
-- ============================================
\echo ''
\echo 'Adding verification and source_type columns to cat_mortality_events...'

ALTER TABLE trapper.cat_mortality_events
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.cat_mortality_events.verified_at IS 'When this mortality record was verified';
COMMENT ON COLUMN trapper.cat_mortality_events.verified_by_staff_id IS 'Staff who verified this record';

CREATE INDEX IF NOT EXISTS idx_mortality_events_verified
    ON trapper.cat_mortality_events(verified_at)
    WHERE verified_at IS NULL;

-- ============================================
-- PART 4: Add to cat_vitals
-- ============================================
\echo ''
\echo 'Adding verification and source_type columns to cat_vitals...'

ALTER TABLE trapper.cat_vitals
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'clinic',
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.cat_vitals.verified_at IS 'When this vitals record was verified';
COMMENT ON COLUMN trapper.cat_vitals.verified_by_staff_id IS 'Staff who verified this record';

CREATE INDEX IF NOT EXISTS idx_cat_vitals_verified
    ON trapper.cat_vitals(verified_at)
    WHERE verified_at IS NULL;

-- ============================================
-- PART 5: Add to sot_requests if not exists
-- ============================================
\echo ''
\echo 'Adding verification columns to sot_requests...'

ALTER TABLE trapper.sot_requests
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.sot_requests.verified_at IS 'When this request was verified';
COMMENT ON COLUMN trapper.sot_requests.verified_by_staff_id IS 'Staff who verified this request';

-- ============================================
-- PART 6: View for unverified data counts
-- ============================================
\echo ''
\echo 'Creating v_unverified_data_counts view...'

CREATE OR REPLACE VIEW trapper.v_unverified_data_counts AS
SELECT
    'colony_estimates' AS data_type,
    COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
    COUNT(*) AS total_count,
    MAX(created_at) AS latest_created
FROM trapper.place_colony_estimates
WHERE source_type = 'ai_parsed'

UNION ALL

SELECT
    'birth_events' AS data_type,
    COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
    COUNT(*) AS total_count,
    MAX(created_at) AS latest_created
FROM trapper.cat_birth_events
WHERE source_type = 'ai_parsed'

UNION ALL

SELECT
    'mortality_events' AS data_type,
    COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
    COUNT(*) AS total_count,
    MAX(created_at) AS latest_created
FROM trapper.cat_mortality_events
WHERE source_type = 'ai_parsed'

UNION ALL

SELECT
    'cat_vitals' AS data_type,
    COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
    COUNT(*) AS total_count,
    MAX(created_at) AS latest_created
FROM trapper.cat_vitals
WHERE source_type = 'ai_parsed';

COMMENT ON VIEW trapper.v_unverified_data_counts IS
'Summary of AI-parsed data needing human verification';

-- ============================================
-- PART 7: Function to verify a record
-- ============================================
\echo ''
\echo 'Creating verify_record function...'

CREATE OR REPLACE FUNCTION trapper.verify_record(
    p_table_name TEXT,
    p_record_id UUID,
    p_staff_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_sql TEXT;
    v_rows INT;
BEGIN
    -- Build dynamic SQL for the appropriate table
    v_sql := format(
        'UPDATE trapper.%I SET verified_at = NOW(), verified_by_staff_id = $1 WHERE %I = $2',
        p_table_name,
        CASE p_table_name
            WHEN 'place_colony_estimates' THEN 'estimate_id'
            WHEN 'cat_birth_events' THEN 'event_id'
            WHEN 'cat_mortality_events' THEN 'event_id'
            WHEN 'cat_vitals' THEN 'vital_id'
            WHEN 'sot_requests' THEN 'request_id'
            WHEN 'places' THEN 'place_id'
            WHEN 'sot_people' THEN 'person_id'
            WHEN 'sot_cats' THEN 'cat_id'
            ELSE 'id'
        END
    );

    EXECUTE v_sql USING p_staff_id, p_record_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.verify_record IS
'Mark a record as verified by a staff member. Returns true if record was found and updated.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_293 Complete'
\echo '============================================'

\echo ''
\echo 'Tables with verification columns:'
SELECT
    table_name,
    column_name
FROM information_schema.columns
WHERE table_schema = 'trapper'
AND column_name IN ('verified_at', 'verified_by_staff_id')
ORDER BY table_name;

\echo ''
\echo 'Unverified data summary:'
SELECT * FROM trapper.v_unverified_data_counts;
