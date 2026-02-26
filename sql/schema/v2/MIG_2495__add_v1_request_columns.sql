-- MIG_2495: Add V1 Request Columns to V2 ops.requests
--
-- Problem: The ops.requests table in V2 is missing many columns that exist in V1
-- and are expected by the request detail page and API routes. This causes
-- "column does not exist" errors when trying to update requests.
--
-- Solution: Add the missing columns to ops.requests for full V1 compatibility.
--
-- Created: 2026-02-24

\echo ''
\echo '=============================================='
\echo '  MIG_2495: Add V1 Request Columns to V2'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. KITTEN & CAT ASSESSMENT COLUMNS
-- ============================================================================

\echo '1. Adding kitten and cat assessment columns...'

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS has_kittens BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS cats_are_friendly BOOLEAN;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_count INTEGER;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_age_weeks INTEGER;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessment_status TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessment_outcome TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_foster_readiness TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_urgency_factors TEXT[];
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessment_notes TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS not_assessing_reason TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessed_by TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessed_at TIMESTAMPTZ;

\echo '   Added kitten/cat assessment columns'

-- ============================================================================
-- 2. SCHEDULING & ASSIGNMENT COLUMNS
-- ============================================================================

\echo ''
\echo '2. Adding scheduling and assignment columns...'

-- Legacy assignment fields (deprecated but still used for backwards compat)
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS assigned_trapper_type TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS assignment_notes TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Scheduling
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS scheduled_time_range TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;

\echo '   Added scheduling/assignment columns'

-- ============================================================================
-- 3. RESOLUTION COLUMNS
-- ============================================================================

\echo ''
\echo '3. Adding resolution columns...'

-- Note: V2 has `resolution` column, V1 has `resolution_notes`
-- We keep both for compatibility
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS cats_trapped INTEGER;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS cats_returned INTEGER;

-- Sync resolution_notes from resolution if it exists but resolution_notes doesn't
UPDATE ops.requests SET resolution_notes = resolution WHERE resolution_notes IS NULL AND resolution IS NOT NULL;

\echo '   Added resolution columns'

-- ============================================================================
-- 4. HOLD MANAGEMENT COLUMNS
-- ============================================================================

\echo ''
\echo '4. Adding hold management columns...'

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS hold_started_at TIMESTAMPTZ;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS hold_reason_notes TEXT;

\echo '   Added hold management columns'

-- ============================================================================
-- 5. ENHANCED INTAKE COLUMNS
-- ============================================================================

\echo ''
\echo '5. Adding enhanced intake columns...'

-- Property/Access
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS permission_status TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS property_owner_contact TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS access_notes TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS traps_overnight_safe BOOLEAN;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS access_without_contact BOOLEAN;

-- Colony info
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS colony_duration TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS location_description TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS eartip_count INTEGER;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS eartip_estimate TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS count_confidence TEXT;

-- Feeding
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS is_being_fed BOOLEAN;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS feeder_name TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS feeding_schedule TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS best_times_seen TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS best_contact_times TEXT;

-- Urgency
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_reasons TEXT[];
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_deadline TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_notes TEXT;

-- Call sheet trapping logistics (for trapper sheet prefill)
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS dogs_on_site TEXT;          -- 'yes'/'no'
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS trap_savvy TEXT;             -- 'yes'/'no'/'unknown'
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS previous_tnr TEXT;           -- 'yes'/'no'/'partial'
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS handleability TEXT;          -- 'friendly_carrier'/'shy_handleable'/'unhandleable_trap'
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS fixed_status TEXT;           -- 'none_fixed'/'some_fixed'/'most_fixed'/'unknown'
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS ownership_status TEXT;       -- 'unknown_stray'/'community_colony'/etc.
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS has_medical_concerns BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS medical_description TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS important_notes TEXT[];      -- Checkbox flags from call sheet

\echo '   Added enhanced intake columns'

-- ============================================================================
-- 6. EMAIL BATCHING COLUMNS (MIG_605)
-- ============================================================================

\echo ''
\echo '6. Adding email batching columns...'

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS ready_to_email BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS email_summary TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS email_batch_id UUID;

\echo '   Added email batching columns'

-- ============================================================================
-- 7. REDIRECT/HANDOFF COLUMNS
-- ============================================================================

\echo ''
\echo '7. Adding redirect/handoff columns...'

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS redirected_to_request_id UUID REFERENCES ops.requests(request_id);
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS redirected_from_request_id UUID REFERENCES ops.requests(request_id);
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS redirect_reason TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS redirect_at TIMESTAMPTZ;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS transfer_type TEXT;

\echo '   Added redirect/handoff columns'

-- ============================================================================
-- 8. ACTIVITY TRACKING COLUMNS
-- ============================================================================

\echo ''
\echo '8. Adding activity tracking columns...'

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS last_activity_type TEXT;

\echo '   Added activity tracking columns'

-- ============================================================================
-- 9. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Checking that key columns exist:'

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'requests'
  AND column_name IN (
    'has_kittens', 'kitten_count', 'scheduled_date',
    'hold_reason_notes', 'resolution_reason', 'cats_trapped',
    'ready_to_email', 'redirected_to_request_id'
  )
ORDER BY column_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2495 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Added all V1 request columns to V2 ops.requests table.'
\echo 'The request detail page and PATCH API should now work correctly.'
\echo ''
