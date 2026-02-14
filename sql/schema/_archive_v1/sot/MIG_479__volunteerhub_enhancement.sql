\echo '=== MIG_479: VolunteerHub Enhancement ==='
\echo 'Adds additional fields for unified data architecture'
\echo ''

-- ============================================================================
-- PURPOSE
-- Enhance volunteerhub_volunteers table with additional fields needed for
-- unified data architecture:
-- 1. certifications - Training/certification tracking
-- 2. availability - Volunteer availability windows
-- 3. emergency_contact - Emergency contact info
-- 4. needs_identity_enrichment - Flag for volunteers needing better contact info
-- ============================================================================

\echo 'Step 1: Adding new columns to volunteerhub_volunteers...'

-- Add certifications tracking
ALTER TABLE trapper.volunteerhub_volunteers ADD COLUMN IF NOT EXISTS
    certifications JSONB DEFAULT '[]';

COMMENT ON COLUMN trapper.volunteerhub_volunteers.certifications IS
'Array of certifications, e.g., [{"type": "trapper_training", "date": "2024-01-15", "expires": "2025-01-15"}]';

-- Add availability tracking
ALTER TABLE trapper.volunteerhub_volunteers ADD COLUMN IF NOT EXISTS
    availability JSONB DEFAULT '{}';

COMMENT ON COLUMN trapper.volunteerhub_volunteers.availability IS
'Volunteer availability, e.g., {"weekdays": true, "weekends": true, "evenings": false, "notes": "Tues/Thurs only"}';

-- Add emergency contact
ALTER TABLE trapper.volunteerhub_volunteers ADD COLUMN IF NOT EXISTS
    emergency_contact JSONB DEFAULT NULL;

COMMENT ON COLUMN trapper.volunteerhub_volunteers.emergency_contact IS
'Emergency contact info, e.g., {"name": "John Doe", "phone": "707-555-1234", "relationship": "spouse"}';

-- Add identity enrichment flag
ALTER TABLE trapper.volunteerhub_volunteers ADD COLUMN IF NOT EXISTS
    needs_identity_enrichment BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.volunteerhub_volunteers.needs_identity_enrichment IS
'TRUE if volunteer was created without reliable email/phone for identity matching';

\echo 'Added new columns to volunteerhub_volunteers'

-- ============================================================================
-- Step 2: Create index for unmatched volunteers needing enrichment
-- ============================================================================

\echo ''
\echo 'Step 2: Creating index for unmatched volunteers...'

CREATE INDEX IF NOT EXISTS idx_vh_needs_enrichment
ON trapper.volunteerhub_volunteers(needs_identity_enrichment)
WHERE needs_identity_enrichment = TRUE;

CREATE INDEX IF NOT EXISTS idx_vh_unmatched
ON trapper.volunteerhub_volunteers(matched_person_id)
WHERE matched_person_id IS NULL;

\echo 'Created indexes for volunteer enrichment tracking'

-- ============================================================================
-- Step 3: Function to check if volunteer needs identity enrichment
-- ============================================================================

\echo ''
\echo 'Step 3: Creating identity enrichment check function...'

CREATE OR REPLACE FUNCTION trapper.check_volunteer_identity_quality(
    p_volunteerhub_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_vol RECORD;
    v_has_email BOOLEAN;
    v_has_phone BOOLEAN;
    v_email_valid BOOLEAN;
    v_phone_valid BOOLEAN;
    v_issues TEXT[];
    v_quality_score NUMERIC;
BEGIN
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN jsonb_build_object('error', 'Volunteer not found');
    END IF;

    v_issues := ARRAY[]::TEXT[];

    -- Check email
    v_has_email := v_vol.email IS NOT NULL AND LENGTH(TRIM(v_vol.email)) > 0;
    v_email_valid := v_has_email AND v_vol.email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';

    IF NOT v_has_email THEN
        v_issues := array_append(v_issues, 'missing_email');
    ELSIF NOT v_email_valid THEN
        v_issues := array_append(v_issues, 'invalid_email_format');
    END IF;

    -- Check phone
    v_has_phone := v_vol.phone IS NOT NULL AND LENGTH(TRIM(v_vol.phone)) > 0;
    v_phone_valid := v_has_phone AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10;

    IF NOT v_has_phone THEN
        v_issues := array_append(v_issues, 'missing_phone');
    ELSIF NOT v_phone_valid THEN
        v_issues := array_append(v_issues, 'invalid_phone_format');
    END IF;

    -- Check name
    IF v_vol.first_name IS NULL OR LENGTH(TRIM(v_vol.first_name)) = 0 THEN
        v_issues := array_append(v_issues, 'missing_first_name');
    END IF;
    IF v_vol.last_name IS NULL OR LENGTH(TRIM(v_vol.last_name)) = 0 THEN
        v_issues := array_append(v_issues, 'missing_last_name');
    END IF;

    -- Calculate quality score (0-1)
    v_quality_score := 0;
    IF v_email_valid THEN v_quality_score := v_quality_score + 0.4; END IF;
    IF v_phone_valid THEN v_quality_score := v_quality_score + 0.3; END IF;
    IF v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        v_quality_score := v_quality_score + 0.2;
    END IF;
    IF v_vol.full_address IS NOT NULL THEN v_quality_score := v_quality_score + 0.1; END IF;

    -- Update needs_identity_enrichment flag
    UPDATE trapper.volunteerhub_volunteers
    SET needs_identity_enrichment = (v_quality_score < 0.7)
    WHERE volunteerhub_id = p_volunteerhub_id;

    RETURN jsonb_build_object(
        'volunteerhub_id', p_volunteerhub_id,
        'quality_score', v_quality_score,
        'needs_enrichment', v_quality_score < 0.7,
        'has_valid_email', v_email_valid,
        'has_valid_phone', v_phone_valid,
        'issues', v_issues,
        'matched_person_id', v_vol.matched_person_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.check_volunteer_identity_quality IS
'Checks volunteer data quality for identity matching.
Returns quality score (0-1) and list of issues.
Sets needs_identity_enrichment flag if quality < 0.7.';

\echo 'Created check_volunteer_identity_quality function'

-- ============================================================================
-- Step 4: Batch check all volunteers
-- ============================================================================

\echo ''
\echo 'Step 4: Creating batch quality check function...'

CREATE OR REPLACE FUNCTION trapper.check_all_volunteer_identity_quality()
RETURNS TABLE (
    total_checked INT,
    needs_enrichment INT,
    high_quality INT,
    avg_quality_score NUMERIC
) AS $$
DECLARE
    v_total INT := 0;
    v_needs_enrichment INT := 0;
    v_high_quality INT := 0;
    v_total_score NUMERIC := 0;
    v_vol RECORD;
    v_result JSONB;
BEGIN
    FOR v_vol IN SELECT volunteerhub_id FROM trapper.volunteerhub_volunteers LOOP
        v_result := trapper.check_volunteer_identity_quality(v_vol.volunteerhub_id);
        v_total := v_total + 1;
        v_total_score := v_total_score + COALESCE((v_result->>'quality_score')::NUMERIC, 0);

        IF (v_result->>'needs_enrichment')::BOOLEAN THEN
            v_needs_enrichment := v_needs_enrichment + 1;
        ELSE
            v_high_quality := v_high_quality + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT
        v_total,
        v_needs_enrichment,
        v_high_quality,
        CASE WHEN v_total > 0 THEN v_total_score / v_total ELSE 0 END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.check_all_volunteer_identity_quality IS
'Batch check all volunteers for identity quality.
Updates needs_identity_enrichment flag for each.
Returns summary statistics.';

\echo 'Created check_all_volunteer_identity_quality function'

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_479 Complete ==='
\echo ''
\echo 'VolunteerHub table enhanced with:'
\echo '  - certifications JSONB: Training/certification tracking'
\echo '  - availability JSONB: Volunteer availability windows'
\echo '  - emergency_contact JSONB: Emergency contact info'
\echo '  - needs_identity_enrichment BOOLEAN: Flag for low-quality identity data'
\echo ''
\echo 'New functions:'
\echo '  - check_volunteer_identity_quality(): Check single volunteer'
\echo '  - check_all_volunteer_identity_quality(): Batch check all'
\echo ''

