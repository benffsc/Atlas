-- MIG_298: Trapper Onboarding Workflow
--
-- Adds onboarding tracking for new trappers based on FFSC Airtable workflow:
-- 1. Interest received (person expresses interest in trapping)
-- 2. Interest email sent (staff reaches out)
-- 3. Volunteer orientation complete (general FFSC orientation)
-- 4. Trapper training complete (trapping-specific training)
-- 5. Contract sent
-- 6. Contract signed → Becomes active trapper
--
-- Data sources:
--   - Web form interest submissions
--   - VolunteerHub integration (future)
--   - Airtable Potential Trappers sync
--   - Manual entry by staff
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_298__trapper_onboarding_workflow.sql

\echo ''
\echo 'MIG_298: Trapper Onboarding Workflow'
\echo '====================================='
\echo ''

-- ============================================
-- 1. Onboarding status enum
-- ============================================

\echo 'Creating onboarding status enum...'

DO $$
BEGIN
    CREATE TYPE trapper.trapper_onboarding_status AS ENUM (
        'interested',           -- Expressed interest, not yet contacted
        'contacted',            -- Staff has reached out
        'orientation_scheduled', -- Scheduled for orientation
        'orientation_complete', -- Completed general FFSC orientation
        'training_scheduled',   -- Scheduled for trapper training
        'training_complete',    -- Completed trapper training
        'contract_sent',        -- Contract sent for signature
        'contract_signed',      -- Contract signed → ready for approval
        'approved',             -- Active approved trapper
        'declined',             -- Declined to proceed
        'withdrawn',            -- Withdrew interest
        'on_hold'               -- Paused for some reason
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 1.5. Add primary_email and primary_phone to sot_people if not exists
-- ============================================

\echo 'Adding contact columns to sot_people if needed...'

ALTER TABLE trapper.sot_people
    ADD COLUMN IF NOT EXISTS primary_email TEXT,
    ADD COLUMN IF NOT EXISTS primary_phone TEXT;

-- ============================================
-- 2. Trapper onboarding table
-- ============================================

\echo 'Creating trapper_onboarding table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_onboarding (
    onboarding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,

    -- Current status in the pipeline
    status trapper.trapper_onboarding_status NOT NULL DEFAULT 'interested',

    -- Target trapper type (what they're being onboarded for)
    target_trapper_type TEXT NOT NULL DEFAULT 'ffsc_trapper' CHECK (target_trapper_type IN (
        'ffsc_trapper',       -- Full FFSC volunteer trapper
        'community_trapper'   -- Community trapper (less oversight needed)
    )),

    -- Milestone dates (when each step was completed)
    interest_received_at TIMESTAMPTZ,        -- When they first expressed interest
    first_contact_at TIMESTAMPTZ,            -- When staff first contacted them
    orientation_completed_at TIMESTAMPTZ,    -- When orientation was completed
    training_completed_at TIMESTAMPTZ,       -- When trapper training was completed
    contract_sent_at TIMESTAMPTZ,            -- When contract was sent
    contract_signed_at TIMESTAMPTZ,          -- When contract was signed
    approved_at TIMESTAMPTZ,                 -- When finally approved as trapper

    -- Files
    contract_document_url TEXT,              -- URL to signed contract (if stored)

    -- Staff tracking
    assigned_coordinator_id UUID REFERENCES trapper.sot_people(person_id),

    -- Notes
    notes TEXT,                              -- Internal notes about onboarding
    decline_reason TEXT,                     -- If declined/withdrawn, why

    -- How they heard about us / came to us
    referral_source TEXT,                    -- 'volunteerhub', 'website', 'friend', 'event', etc.

    -- Source tracking
    source_system TEXT,                      -- 'airtable', 'web_form', 'volunteerhub', 'manual'
    source_record_id TEXT,                   -- ID in source system

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One onboarding record per person
    UNIQUE (person_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trapper_onboarding_status
    ON trapper.trapper_onboarding(status);
CREATE INDEX IF NOT EXISTS idx_trapper_onboarding_person
    ON trapper.trapper_onboarding(person_id);
CREATE INDEX IF NOT EXISTS idx_trapper_onboarding_coordinator
    ON trapper.trapper_onboarding(assigned_coordinator_id)
    WHERE assigned_coordinator_id IS NOT NULL;

COMMENT ON TABLE trapper.trapper_onboarding IS
'Tracks trapper onboarding progress. One record per person going through the pipeline.
Status flow: interested → contacted → orientation_complete → training_complete → contract_sent → contract_signed → approved';

-- ============================================
-- 3. Function to advance onboarding
-- ============================================

\echo 'Creating onboarding advancement function...'

CREATE OR REPLACE FUNCTION trapper.advance_trapper_onboarding(
    p_person_id UUID,
    p_new_status trapper.trapper_onboarding_status,
    p_notes TEXT DEFAULT NULL,
    p_advanced_by TEXT DEFAULT 'system'
)
RETURNS TABLE (
    onboarding_id UUID,
    previous_status TEXT,
    new_status TEXT,
    person_created BOOLEAN
) AS $$
DECLARE
    v_onboarding_id UUID;
    v_prev_status TEXT;
    v_role_id UUID;
BEGIN
    -- Get or create onboarding record
    INSERT INTO trapper.trapper_onboarding (person_id, status, interest_received_at)
    VALUES (p_person_id, 'interested', NOW())
    ON CONFLICT (person_id) DO NOTHING
    RETURNING trapper_onboarding.onboarding_id INTO v_onboarding_id;

    -- Get current onboarding record
    SELECT o.onboarding_id, o.status::TEXT INTO v_onboarding_id, v_prev_status
    FROM trapper.trapper_onboarding o
    WHERE o.person_id = p_person_id;

    -- Update status and set appropriate milestone date
    UPDATE trapper.trapper_onboarding o
    SET
        status = p_new_status,
        notes = CASE WHEN p_notes IS NOT NULL THEN
            COALESCE(o.notes, '') || E'\n[' || NOW()::DATE || '] ' || p_notes
            ELSE o.notes END,
        -- Set milestone dates based on new status
        first_contact_at = CASE WHEN p_new_status = 'contacted' AND first_contact_at IS NULL THEN NOW() ELSE first_contact_at END,
        orientation_completed_at = CASE WHEN p_new_status = 'orientation_complete' AND orientation_completed_at IS NULL THEN NOW() ELSE orientation_completed_at END,
        training_completed_at = CASE WHEN p_new_status = 'training_complete' AND training_completed_at IS NULL THEN NOW() ELSE training_completed_at END,
        contract_sent_at = CASE WHEN p_new_status = 'contract_sent' AND contract_sent_at IS NULL THEN NOW() ELSE contract_sent_at END,
        contract_signed_at = CASE WHEN p_new_status = 'contract_signed' AND contract_signed_at IS NULL THEN NOW() ELSE contract_signed_at END,
        approved_at = CASE WHEN p_new_status = 'approved' AND approved_at IS NULL THEN NOW() ELSE approved_at END,
        updated_at = NOW()
    WHERE o.person_id = p_person_id;

    -- If approved, create the person_role entry
    IF p_new_status = 'approved' THEN
        -- Get target trapper type
        DECLARE v_trapper_type TEXT;
        BEGIN
            SELECT target_trapper_type INTO v_trapper_type
            FROM trapper.trapper_onboarding
            WHERE person_id = p_person_id;

            -- Create or update person_roles entry
            INSERT INTO trapper.person_roles (
                person_id, role, trapper_type, role_status, started_at, source_system
            ) VALUES (
                p_person_id, 'trapper', v_trapper_type, 'active', CURRENT_DATE, 'onboarding'
            )
            ON CONFLICT (person_id, role) DO UPDATE SET
                role_status = 'active',
                trapper_type = v_trapper_type,
                updated_at = NOW();
        END;
    END IF;

    -- Log to entity_edits
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name,
        old_value, new_value,
        edit_reason, edited_by, edit_source
    ) VALUES (
        'trapper_onboarding', v_onboarding_id, 'status',
        to_jsonb(v_prev_status), to_jsonb(p_new_status::TEXT),
        'onboarding_advance', p_advanced_by, 'function'
    );

    RETURN QUERY SELECT
        v_onboarding_id,
        v_prev_status,
        p_new_status::TEXT,
        v_prev_status IS NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.advance_trapper_onboarding IS
'Advances a person through the trapper onboarding pipeline.
Automatically sets milestone dates and creates person_role when approved.

Usage:
  SELECT * FROM trapper.advance_trapper_onboarding(
    p_person_id := ''uuid'',
    p_new_status := ''orientation_complete'',
    p_notes := ''Attended Jan 15 orientation session'',
    p_advanced_by := ''staff_name''
  );';

-- ============================================
-- 4. View for onboarding pipeline
-- ============================================

\echo 'Creating onboarding pipeline view...'

CREATE OR REPLACE VIEW trapper.v_trapper_onboarding_pipeline AS
SELECT
    o.onboarding_id,
    o.person_id,
    p.display_name,
    COALESCE(p.primary_email, (SELECT pi.id_value_raw FROM trapper.person_identifiers pi
        WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
        ORDER BY pi.created_at DESC LIMIT 1)) AS primary_email,
    COALESCE(p.primary_phone, (SELECT pi.id_value_raw FROM trapper.person_identifiers pi
        WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
        ORDER BY pi.created_at DESC LIMIT 1)) AS primary_phone,
    o.status,
    o.target_trapper_type,
    -- Progress indicators
    o.interest_received_at IS NOT NULL AS has_interest,
    o.first_contact_at IS NOT NULL AS has_contact,
    o.orientation_completed_at IS NOT NULL AS has_orientation,
    o.training_completed_at IS NOT NULL AS has_training,
    o.contract_sent_at IS NOT NULL AS has_contract_sent,
    o.contract_signed_at IS NOT NULL AS has_contract_signed,
    o.approved_at IS NOT NULL AS is_approved,
    -- Dates
    o.interest_received_at,
    o.first_contact_at,
    o.orientation_completed_at,
    o.training_completed_at,
    o.contract_sent_at,
    o.contract_signed_at,
    o.approved_at,
    -- Days in current status
    EXTRACT(DAY FROM NOW() - o.updated_at)::INT AS days_in_status,
    -- Days since interest (total time in pipeline)
    EXTRACT(DAY FROM NOW() - COALESCE(o.interest_received_at, o.created_at))::INT AS days_in_pipeline,
    -- Assigned coordinator
    o.assigned_coordinator_id,
    coord.display_name AS coordinator_name,
    -- Notes
    o.notes,
    o.decline_reason,
    o.referral_source,
    -- Source
    o.source_system,
    o.created_at
FROM trapper.trapper_onboarding o
JOIN trapper.sot_people p ON p.person_id = o.person_id
LEFT JOIN trapper.sot_people coord ON coord.person_id = o.assigned_coordinator_id
ORDER BY
    -- Active statuses first, then by how long they've been waiting
    CASE o.status
        WHEN 'interested' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'orientation_scheduled' THEN 3
        WHEN 'orientation_complete' THEN 4
        WHEN 'training_scheduled' THEN 5
        WHEN 'training_complete' THEN 6
        WHEN 'contract_sent' THEN 7
        WHEN 'contract_signed' THEN 8
        WHEN 'approved' THEN 10
        WHEN 'on_hold' THEN 11
        ELSE 20
    END,
    o.updated_at ASC;  -- Oldest first within status

-- ============================================
-- 5. Function to create new trapper interest
-- ============================================

\echo 'Creating new interest function...'

CREATE OR REPLACE FUNCTION trapper.create_trapper_interest(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_referral_source TEXT DEFAULT NULL,
    p_target_type TEXT DEFAULT 'ffsc_trapper',
    p_notes TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_form'
)
RETURNS TABLE (
    person_id UUID,
    onboarding_id UUID,
    is_new_person BOOLEAN
) AS $$
DECLARE
    v_person_id UUID;
    v_onboarding_id UUID;
    v_is_new BOOLEAN := FALSE;
BEGIN
    -- Find or create person using centralized function
    SELECT trapper.find_or_create_person(
        p_email := p_email,
        p_phone := p_phone,
        p_first_name := p_first_name,
        p_last_name := p_last_name,
        p_display_name := p_first_name || ' ' || p_last_name,
        p_source_system := p_source_system
    ) INTO v_person_id;

    -- Check if this is a new person (no onboarding record exists)
    IF NOT EXISTS (SELECT 1 FROM trapper.trapper_onboarding WHERE trapper_onboarding.person_id = v_person_id) THEN
        v_is_new := TRUE;
    END IF;

    -- Create or update onboarding record
    INSERT INTO trapper.trapper_onboarding (
        person_id,
        status,
        target_trapper_type,
        interest_received_at,
        referral_source,
        notes,
        source_system
    ) VALUES (
        v_person_id,
        'interested',
        p_target_type,
        NOW(),
        p_referral_source,
        p_notes,
        p_source_system
    )
    ON CONFLICT (person_id) DO UPDATE SET
        -- Only update if they're in early stage (don't regress someone in progress)
        status = CASE
            WHEN trapper_onboarding.status IN ('interested', 'declined', 'withdrawn')
            THEN 'interested'::trapper.trapper_onboarding_status
            ELSE trapper_onboarding.status
        END,
        notes = CASE
            WHEN p_notes IS NOT NULL
            THEN COALESCE(trapper_onboarding.notes, '') || E'\n[Re-interest ' || NOW()::DATE || '] ' || p_notes
            ELSE trapper_onboarding.notes
        END,
        updated_at = NOW()
    RETURNING trapper_onboarding.onboarding_id INTO v_onboarding_id;

    -- Get onboarding_id if it wasn't returned (existed before)
    IF v_onboarding_id IS NULL THEN
        SELECT o.onboarding_id INTO v_onboarding_id
        FROM trapper.trapper_onboarding o
        WHERE o.person_id = v_person_id;
    END IF;

    RETURN QUERY SELECT v_person_id, v_onboarding_id, v_is_new;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_trapper_interest IS
'Creates a new trapper interest record. Uses find_or_create_person for deduplication.
If person already has onboarding record, updates notes but doesn''t regress status.

Usage:
  SELECT * FROM trapper.create_trapper_interest(
    p_first_name := ''Jane'',
    p_last_name := ''Doe'',
    p_email := ''jane@example.com'',
    p_phone := ''707-555-1234'',
    p_referral_source := ''volunteerhub'',
    p_notes := ''Interested in helping with local colonies''
  );';

-- ============================================
-- 6. Summary stats
-- ============================================

\echo ''
\echo 'Creating onboarding stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_onboarding_stats AS
SELECT
    status,
    COUNT(*) AS count,
    ROUND(AVG(EXTRACT(DAY FROM NOW() - updated_at)), 1) AS avg_days_in_status
FROM trapper.trapper_onboarding
GROUP BY status
ORDER BY
    CASE status
        WHEN 'interested' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'orientation_scheduled' THEN 3
        WHEN 'orientation_complete' THEN 4
        WHEN 'training_scheduled' THEN 5
        WHEN 'training_complete' THEN 6
        WHEN 'contract_sent' THEN 7
        WHEN 'contract_signed' THEN 8
        WHEN 'approved' THEN 9
        ELSE 10
    END;

\echo ''
\echo 'MIG_298 complete!'
\echo ''
\echo 'New components:'
\echo '  - trapper_onboarding table - Tracks progress through pipeline'
\echo '  - trapper_onboarding_status enum - Pipeline stages'
\echo '  - advance_trapper_onboarding() - Move person to next stage'
\echo '  - create_trapper_interest() - Create new interest (deduped)'
\echo '  - v_trapper_onboarding_pipeline - View pipeline with progress'
\echo '  - v_trapper_onboarding_stats - Summary stats by status'
\echo ''
\echo 'Status flow:'
\echo '  interested → contacted → orientation_complete →'
\echo '  training_complete → contract_sent → contract_signed → approved'
\echo ''
\echo 'Usage:'
\echo '  -- Create new interest:'
\echo '  SELECT * FROM trapper.create_trapper_interest('
\echo '    p_first_name := ''Jane'','
\echo '    p_last_name := ''Doe'','
\echo '    p_email := ''jane@example.com'''
\echo '  );'
\echo ''
\echo '  -- Advance to next stage:'
\echo '  SELECT * FROM trapper.advance_trapper_onboarding('
\echo '    p_person_id := ''uuid'','
\echo '    p_new_status := ''orientation_complete'','
\echo '    p_notes := ''Completed orientation Jan 15'''
\echo '  );'
\echo ''
