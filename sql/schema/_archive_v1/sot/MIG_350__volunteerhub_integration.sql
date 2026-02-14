\echo '=== MIG_350: VolunteerHub Integration ==='
\echo 'Creates tables and functions for VolunteerHub volunteer data sync'
\echo ''

-- ============================================================================
-- PURPOSE
-- Import volunteer data from VolunteerHub to enable:
-- 1. Volunteer coordination for calls
-- 2. Proximity-based volunteer matching
-- 3. Role-based volunteer assignment
-- 4. Training status tracking
-- ============================================================================

\echo 'Step 1: Creating volunteerhub_volunteers table...'

CREATE TABLE IF NOT EXISTS trapper.volunteerhub_volunteers (
    -- VolunteerHub identity
    volunteerhub_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT GENERATED ALWAYS AS (
        COALESCE(
            NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
            email
        )
    ) STORED,

    -- Contact info
    phone TEXT,
    phone_norm TEXT GENERATED ALWAYS AS (trapper.norm_phone_us(phone)) STORED,
    email_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,

    -- Address
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    full_address TEXT GENERATED ALWAYS AS (
        NULLIF(TRIM(
            COALESCE(address, '') ||
            CASE WHEN city IS NOT NULL THEN ', ' || city ELSE '' END ||
            CASE WHEN state IS NOT NULL THEN ', ' || state ELSE '' END ||
            CASE WHEN zip IS NOT NULL THEN ' ' || zip ELSE '' END
        ), '')
    ) STORED,

    -- VolunteerHub status
    status TEXT,  -- 'active', 'inactive', 'pending', 'removed'
    roles JSONB DEFAULT '[]',  -- Array of volunteer role names
    tags JSONB DEFAULT '[]',   -- Array of tags from VolunteerHub

    -- Activity tracking
    hours_logged NUMERIC DEFAULT 0,
    last_activity_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,

    -- Sync tracking
    raw_data JSONB,  -- Full VolunteerHub record for audit
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'pending',  -- 'pending', 'matched', 'created', 'error'
    sync_error TEXT,

    -- Atlas SOT link (populated by Data Engine)
    matched_person_id UUID REFERENCES trapper.sot_people(person_id),
    matched_at TIMESTAMPTZ,
    match_confidence NUMERIC,
    match_method TEXT,  -- 'email', 'phone', 'name+address', 'manual'

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for matching and queries
CREATE INDEX IF NOT EXISTS idx_volunteerhub_email_norm ON trapper.volunteerhub_volunteers(email_norm);
CREATE INDEX IF NOT EXISTS idx_volunteerhub_phone_norm ON trapper.volunteerhub_volunteers(phone_norm);
CREATE INDEX IF NOT EXISTS idx_volunteerhub_matched ON trapper.volunteerhub_volunteers(matched_person_id) WHERE matched_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_volunteerhub_status ON trapper.volunteerhub_volunteers(status);
CREATE INDEX IF NOT EXISTS idx_volunteerhub_sync_status ON trapper.volunteerhub_volunteers(sync_status);

COMMENT ON TABLE trapper.volunteerhub_volunteers IS
'Staged volunteer records from VolunteerHub.
Matched to sot_people via Data Engine identity resolution.
Pattern: Stage raw data -> Match via email/phone -> Link to person_roles';

\echo 'Created volunteerhub_volunteers table'

-- ============================================================================
-- Step 2: Function to match VolunteerHub volunteer to SOT person
-- ============================================================================

\echo ''
\echo 'Step 2: Creating volunteer matching function...'

CREATE OR REPLACE FUNCTION trapper.match_volunteerhub_volunteer(
    p_volunteerhub_id TEXT
)
RETURNS UUID AS $$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- First try exact email match (highest confidence)
    SELECT sp.person_id INTO v_person_id
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = v_vol.email_norm
      AND sp.merged_into_person_id IS NULL
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
        v_confidence := 1.0;
        v_method := 'email';
    ELSE
        -- Try phone match
        IF v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
            SELECT sp.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_vol.phone_norm
              AND sp.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 0.9;
                v_method := 'phone';
            END IF;
        END IF;
    END IF;

    -- If still no match, use Data Engine for fuzzy matching
    IF v_person_id IS NULL THEN
        SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
            p_email := v_vol.email,
            p_phone := v_vol.phone,
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_vol.full_address,
            p_source_system := 'volunteerhub',
            p_staged_record_id := NULL  -- Not using staged_records
        );

        v_person_id := v_result.person_id;
        v_confidence := v_result.confidence_score;
        v_method := 'data_engine';
    END IF;

    -- Update the volunteer record with match result
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role if not exists
        INSERT INTO trapper.person_roles (person_id, role_type, source_system, source_record_id)
        VALUES (v_person_id, 'volunteer', 'volunteerhub', p_volunteerhub_id)
        ON CONFLICT (person_id, role_type) DO UPDATE SET
            source_system = 'volunteerhub',
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE trapper.volunteerhub_volunteers
        SET sync_status = 'pending',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_volunteerhub_volunteer IS
'Matches a VolunteerHub volunteer record to an existing SOT person.
Tries exact email match first, then phone, then Data Engine fuzzy matching.
Adds volunteer role to person_roles on successful match.';

\echo 'Created match_volunteerhub_volunteer function'

-- ============================================================================
-- Step 3: Batch matching function
-- ============================================================================

\echo ''
\echo 'Step 3: Creating batch matching function...'

CREATE OR REPLACE FUNCTION trapper.match_all_volunteerhub_volunteers(
    p_batch_size INT DEFAULT 100
)
RETURNS TABLE (
    total_processed INT,
    total_matched INT,
    total_pending INT,
    total_errors INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_matched INT := 0;
    v_pending INT := 0;
    v_errors INT := 0;
    v_volunteer RECORD;
    v_person_id UUID;
BEGIN
    FOR v_volunteer IN
        SELECT volunteerhub_id
        FROM trapper.volunteerhub_volunteers
        WHERE sync_status = 'pending'
          AND matched_person_id IS NULL
        ORDER BY imported_at
        LIMIT p_batch_size
    LOOP
        BEGIN
            v_person_id := trapper.match_volunteerhub_volunteer(v_volunteer.volunteerhub_id);
            v_processed := v_processed + 1;

            IF v_person_id IS NOT NULL THEN
                v_matched := v_matched + 1;
            ELSE
                v_pending := v_pending + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            UPDATE trapper.volunteerhub_volunteers
            SET sync_status = 'error',
                sync_error = SQLERRM
            WHERE volunteerhub_id = v_volunteer.volunteerhub_id;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_matched, v_pending, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_all_volunteerhub_volunteers IS
'Batch process VolunteerHub volunteers to match them to SOT people.
Run periodically after VolunteerHub imports.';

\echo 'Created match_all_volunteerhub_volunteers function'

-- ============================================================================
-- Step 4: Volunteer proximity function for call coordination
-- ============================================================================

\echo ''
\echo 'Step 4: Creating volunteer proximity function...'

CREATE OR REPLACE FUNCTION trapper.find_nearby_volunteers(
    p_place_id UUID,
    p_radius_miles FLOAT DEFAULT 5,
    p_role_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    primary_email TEXT,
    primary_phone TEXT,
    distance_miles FLOAT,
    volunteer_roles TEXT[],
    is_ffsc_trapper BOOLEAN,
    volunteerhub_status TEXT,
    hours_logged NUMERIC,
    last_activity_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH place_location AS (
        SELECT location FROM trapper.places WHERE place_id = p_place_id
    ),
    volunteer_locations AS (
        -- Get volunteers with their home addresses
        SELECT
            vh.matched_person_id,
            vh.status as vh_status,
            vh.hours_logged,
            vh.last_activity_at as vh_last_activity,
            pl.location as vol_location
        FROM trapper.volunteerhub_volunteers vh
        JOIN trapper.sot_people sp ON sp.person_id = vh.matched_person_id
        LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = vh.matched_person_id
            AND ppr.relationship_type IN ('residence', 'primary')
        LEFT JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE vh.matched_person_id IS NOT NULL
          AND vh.status = 'active'
          AND sp.merged_into_person_id IS NULL
    )
    SELECT DISTINCT
        sp.person_id,
        sp.display_name,
        sp.primary_email,
        sp.primary_phone,
        CASE
            WHEN vl.vol_location IS NOT NULL AND (SELECT location FROM place_location) IS NOT NULL THEN
                ST_Distance(
                    (SELECT location FROM place_location)::geography,
                    vl.vol_location::geography
                ) / 1609.34  -- meters to miles
            ELSE NULL
        END as distance_miles,
        COALESCE(
            array_agg(DISTINCT pr.role_type) FILTER (WHERE pr.role_type IS NOT NULL),
            ARRAY[]::TEXT[]
        ) as volunteer_roles,
        EXISTS(
            SELECT 1 FROM trapper.person_roles pr2
            WHERE pr2.person_id = sp.person_id
            AND pr2.role_type IN ('ffsc_trapper', 'head_trapper', 'coordinator')
        ) as is_ffsc_trapper,
        vl.vh_status as volunteerhub_status,
        vl.hours_logged,
        vl.vh_last_activity as last_activity_at
    FROM volunteer_locations vl
    JOIN trapper.sot_people sp ON sp.person_id = vl.matched_person_id
    LEFT JOIN trapper.person_roles pr ON pr.person_id = sp.person_id
    CROSS JOIN place_location pl
    WHERE (
        vl.vol_location IS NULL  -- Include volunteers without known location
        OR pl.location IS NULL   -- Include if target place has no location
        OR ST_DWithin(
            pl.location::geography,
            vl.vol_location::geography,
            p_radius_miles * 1609.34  -- miles to meters
        )
    )
    AND (
        p_role_filter IS NULL
        OR EXISTS (
            SELECT 1 FROM trapper.person_roles pr2
            WHERE pr2.person_id = sp.person_id
            AND pr2.role_type = ANY(p_role_filter)
        )
    )
    GROUP BY sp.person_id, sp.display_name, sp.primary_email, sp.primary_phone,
             vl.vol_location, vl.vh_status, vl.hours_logged, vl.vh_last_activity, pl.location
    ORDER BY
        -- Prioritize FFSC trappers
        EXISTS(
            SELECT 1 FROM trapper.person_roles pr2
            WHERE pr2.person_id = sp.person_id
            AND pr2.role_type IN ('ffsc_trapper', 'head_trapper', 'coordinator')
        ) DESC,
        -- Then by distance (NULL distances last)
        CASE
            WHEN vl.vol_location IS NOT NULL AND pl.location IS NOT NULL THEN
                ST_Distance(pl.location::geography, vl.vol_location::geography)
            ELSE 99999999
        END ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_nearby_volunteers IS
'Find volunteers near a place for call coordination.

Parameters:
- p_place_id: Target place to find volunteers near
- p_radius_miles: Search radius in miles (default 5)
- p_role_filter: Optional array of role types to filter by

Returns volunteers sorted by:
1. FFSC trappers first
2. Distance (closest first)
3. Volunteers without known location last

Use case: When a call comes in, find nearby volunteers to help.';

\echo 'Created find_nearby_volunteers function'

-- ============================================================================
-- Step 5: View for volunteer statistics
-- ============================================================================

\echo ''
\echo 'Step 5: Creating volunteer statistics view...'

CREATE OR REPLACE VIEW trapper.v_volunteerhub_sync_stats AS
SELECT
    -- Sync status
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers) as total_records,
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE matched_person_id IS NOT NULL) as matched,
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE sync_status = 'pending') as pending,
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE sync_status = 'error') as errors,

    -- VolunteerHub status breakdown
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE status = 'active') as active_volunteers,
    (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE status = 'inactive') as inactive_volunteers,

    -- Activity
    (SELECT SUM(hours_logged) FROM trapper.volunteerhub_volunteers WHERE status = 'active') as total_hours_logged,
    (SELECT MAX(synced_at) FROM trapper.volunteerhub_volunteers) as last_sync,

    NOW() as calculated_at;

COMMENT ON VIEW trapper.v_volunteerhub_sync_stats IS
'Summary statistics for VolunteerHub sync status and volunteer activity.';

\echo 'Created v_volunteerhub_sync_stats view'

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_350 Complete ==='
\echo ''
\echo 'VolunteerHub integration tables and functions created:'
\echo '  - volunteerhub_volunteers: Staged volunteer records'
\echo '  - match_volunteerhub_volunteer(): Match single volunteer to SOT'
\echo '  - match_all_volunteerhub_volunteers(): Batch matching'
\echo '  - find_nearby_volunteers(): Proximity-based volunteer lookup'
\echo '  - v_volunteerhub_sync_stats: Sync statistics view'
\echo ''
\echo 'Usage pattern:'
\echo '  1. Import VolunteerHub data into volunteerhub_volunteers'
\echo '  2. Run SELECT trapper.match_all_volunteerhub_volunteers();'
\echo '  3. Query trapper.find_nearby_volunteers(place_id) for calls'
\echo ''

