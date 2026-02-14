\echo '=== MIG_239: Communication Logs ==='
\echo 'Track outreach attempts for intake submissions'

-- ============================================================
-- 1. Create communication_logs table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.communication_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to submission (required)
    submission_id UUID NOT NULL REFERENCES trapper.web_intake_submissions(submission_id) ON DELETE CASCADE,

    -- Contact details
    contact_method TEXT NOT NULL CHECK (contact_method IN ('phone', 'email', 'in_person', 'text', 'voicemail')),
    contact_result TEXT NOT NULL CHECK (contact_result IN ('answered', 'no_answer', 'left_voicemail', 'sent', 'spoke_in_person', 'scheduled', 'other')),

    -- Notes
    notes TEXT,

    -- Who and when
    contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    contacted_by TEXT,  -- Staff name or email

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_communication_logs_submission
    ON trapper.communication_logs(submission_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_contacted_at
    ON trapper.communication_logs(contacted_at DESC);

COMMENT ON TABLE trapper.communication_logs IS
'Tracks all communication attempts with requesters. Used to log calls, emails, and in-person contacts.';

COMMENT ON COLUMN trapper.communication_logs.contact_method IS
'How contact was made: phone, email, in_person, text, voicemail';

COMMENT ON COLUMN trapper.communication_logs.contact_result IS
'Outcome: answered, no_answer, left_voicemail, sent (for email/text), spoke_in_person, scheduled, other';

-- ============================================================
-- 2. Add last_contacted fields to web_intake_submissions
-- ============================================================

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_contact_method TEXT,
ADD COLUMN IF NOT EXISTS contact_attempt_count INT DEFAULT 0;

COMMENT ON COLUMN trapper.web_intake_submissions.last_contacted_at IS
'Timestamp of most recent contact attempt';

COMMENT ON COLUMN trapper.web_intake_submissions.contact_attempt_count IS
'Total number of contact attempts logged';

-- ============================================================
-- 3. Function to update submission on new communication log
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.update_submission_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE trapper.web_intake_submissions
    SET
        last_contacted_at = NEW.contacted_at,
        last_contact_method = NEW.contact_method,
        contact_attempt_count = COALESCE(contact_attempt_count, 0) + 1
    WHERE submission_id = NEW.submission_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_communication_log_update_submission ON trapper.communication_logs;
CREATE TRIGGER trg_communication_log_update_submission
    AFTER INSERT ON trapper.communication_logs
    FOR EACH ROW
    EXECUTE FUNCTION trapper.update_submission_contact_stats();

-- ============================================================
-- 4. View for communication history
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_submission_communications AS
SELECT
    cl.log_id,
    cl.submission_id,
    w.first_name || ' ' || w.last_name AS requester_name,
    cl.contact_method,
    cl.contact_result,
    cl.notes,
    cl.contacted_at,
    cl.contacted_by,
    -- Time since last contact
    EXTRACT(DAY FROM NOW() - cl.contacted_at) AS days_since_contact
FROM trapper.communication_logs cl
JOIN trapper.web_intake_submissions w ON w.submission_id = cl.submission_id
ORDER BY cl.contacted_at DESC;

\echo ''
\echo 'MIG_239 complete!'
\echo 'Tables: communication_logs'
\echo 'Views: v_submission_communications'
\echo ''
