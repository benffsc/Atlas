-- MIG_299: Out of County Auto-Response Infrastructure
--
-- Tracks out-of-county submissions and automates response emails.
-- Based on Airtable workflow where "Out of County Email?" checkbox
-- triggers automatic rejection email with resources.
--
-- Components:
-- 1. Track out_of_county flag on submissions
-- 2. Store email templates
-- 3. Log sent emails
-- 4. Queue for email sending
--
-- Email integration (API side - not in this migration):
--   - Use Resend (resend.com) for transactional emails
--   - Add RESEND_API_KEY to environment
--   - Create /api/emails/send-out-of-county endpoint
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_299__out_of_county_automation.sql

\echo ''
\echo 'MIG_299: Out of County Auto-Response Infrastructure'
\echo '===================================================='
\echo ''

-- ============================================
-- 1. Add out_of_county tracking to submissions
-- ============================================

\echo 'Adding out-of-county tracking fields...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS is_out_of_county BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS out_of_county_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS out_of_county_detected_county TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.is_out_of_county IS
'True if submission is from outside Sonoma County service area';

COMMENT ON COLUMN trapper.web_intake_submissions.out_of_county_email_sent_at IS
'When the out-of-county resources email was sent';

COMMENT ON COLUMN trapper.web_intake_submissions.out_of_county_detected_county IS
'The county detected from geocoding (e.g., "Marin", "Napa")';

-- Index for finding out-of-county submissions
CREATE INDEX IF NOT EXISTS idx_intake_out_of_county
    ON trapper.web_intake_submissions(is_out_of_county)
    WHERE is_out_of_county = TRUE;

-- ============================================
-- 2. Email templates table
-- ============================================

\echo 'Creating email templates table...'

CREATE TABLE IF NOT EXISTS trapper.email_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL UNIQUE, -- 'out_of_county', 'appointment_confirmation', etc.
    name TEXT NOT NULL,
    description TEXT,

    -- Email content
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,           -- HTML email body with {{placeholders}}
    body_text TEXT,                    -- Plain text fallback

    -- Placeholders used (for documentation)
    placeholders TEXT[],               -- ['first_name', 'county', 'resources_url']

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

COMMENT ON TABLE trapper.email_templates IS
'Stores email templates with HTML/text bodies and placeholders for dynamic content';

-- Insert default out-of-county template
INSERT INTO trapper.email_templates (
    template_key, name, description, subject, body_html, body_text, placeholders
) VALUES (
    'out_of_county',
    'Out of County Response',
    'Sent automatically to requesters outside Sonoma County',
    'Forgotten Felines - Resources for {{county}} County',
    E'<html><body>
<p>Dear {{first_name}},</p>

<p>Thank you for reaching out to Forgotten Felines of Sonoma County about your cat situation.</p>

<p>We noticed that your location is in <strong>{{county}} County</strong>. Unfortunately, our services are limited to Sonoma County residents.</p>

<p><strong>Resources for {{county}} County:</strong></p>
<ul>
  <li>Marin Humane: <a href="https://www.marinhumane.org/services/spay-neuter/">marinhumane.org</a></li>
  <li>Napa Humane: <a href="https://napahumane.org/services/spay-neuter/">napahumane.org</a></li>
  <li>Mendocino County Animal Care Services: <a href="https://www.mendocinocounty.org/government/animal-care-services">mendocinocounty.org</a></li>
  <li>ASPCA Low-Cost Clinic Finder: <a href="https://www.aspca.org/pet-care/general-pet-care/low-cost-spayneuter-programs">aspca.org/low-cost</a></li>
</ul>

<p>If you believe this is an error and you are located in Sonoma County, please reply to this email with your correct address and we''ll be happy to help.</p>

<p>Best wishes,<br>
The Forgotten Felines Team</p>
</body></html>',
    E'Dear {{first_name}},

Thank you for reaching out to Forgotten Felines of Sonoma County about your cat situation.

We noticed that your location is in {{county}} County. Unfortunately, our services are limited to Sonoma County residents.

Resources for {{county}} County:
- Marin Humane: marinhumane.org/services/spay-neuter/
- Napa Humane: napahumane.org/services/spay-neuter/
- Mendocino County Animal Care Services: mendocinocounty.org
- ASPCA Low-Cost Clinic Finder: aspca.org/pet-care/general-pet-care/low-cost-spayneuter-programs

If you believe this is an error and you are located in Sonoma County, please reply to this email with your correct address and we''ll be happy to help.

Best wishes,
The Forgotten Felines Team',
    ARRAY['first_name', 'county']
) ON CONFLICT (template_key) DO NOTHING;

-- ============================================
-- 3. Sent emails log
-- ============================================

\echo 'Creating sent emails log...'

CREATE TABLE IF NOT EXISTS trapper.sent_emails (
    email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL REFERENCES trapper.email_templates(template_key),

    -- Recipient
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,

    -- Related entities
    submission_id UUID REFERENCES trapper.web_intake_submissions(submission_id),
    person_id UUID REFERENCES trapper.sot_people(person_id),

    -- Email details
    subject_rendered TEXT NOT NULL,      -- After placeholder replacement
    body_html_rendered TEXT,
    body_text_rendered TEXT,

    -- Send status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',    -- Queued but not sent
        'sent',       -- Successfully sent
        'delivered',  -- Delivery confirmed (webhook)
        'bounced',    -- Bounced
        'failed'      -- Send failed
    )),
    sent_at TIMESTAMPTZ,
    error_message TEXT,

    -- External tracking
    external_id TEXT,                    -- ID from email provider (Resend, SendGrid)

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_submission
    ON trapper.sent_emails(submission_id)
    WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_status
    ON trapper.sent_emails(status, created_at);

COMMENT ON TABLE trapper.sent_emails IS
'Log of all emails sent from the system. Used for audit trail and preventing duplicates.';

-- ============================================
-- 4. Function to detect and flag out-of-county
-- ============================================

\echo 'Creating out-of-county detection function...'

CREATE OR REPLACE FUNCTION trapper.flag_out_of_county_submissions()
RETURNS INT AS $$
DECLARE
    v_flagged INT := 0;
BEGIN
    -- Flag submissions where county is not Sonoma and not already flagged
    WITH flagged AS (
        UPDATE trapper.web_intake_submissions
        SET
            is_out_of_county = TRUE,
            out_of_county_detected_county = county,
            updated_at = NOW()
        WHERE is_out_of_county = FALSE
          AND county IS NOT NULL
          AND county != ''
          AND LOWER(county) NOT IN ('sonoma', 'sonoma county')
          -- Don't flag already-processed submissions
          AND out_of_county_email_sent_at IS NULL
        RETURNING submission_id
    )
    SELECT COUNT(*) INTO v_flagged FROM flagged;

    RETURN v_flagged;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.flag_out_of_county_submissions IS
'Flags submissions from outside Sonoma County. Run after geocoding.';

-- ============================================
-- 5. View for pending out-of-county emails
-- ============================================

\echo 'Creating pending out-of-county view...'

CREATE OR REPLACE VIEW trapper.v_pending_out_of_county_emails AS
SELECT
    w.submission_id,
    w.first_name,
    w.last_name,
    w.email,
    w.county AS detected_county,
    w.submitted_at,
    w.is_out_of_county,
    w.out_of_county_email_sent_at
FROM trapper.web_intake_submissions w
WHERE w.is_out_of_county = TRUE
  AND w.out_of_county_email_sent_at IS NULL
  AND w.email IS NOT NULL
  AND w.email != ''
ORDER BY w.submitted_at ASC;

COMMENT ON VIEW trapper.v_pending_out_of_county_emails IS
'Submissions from outside Sonoma County that need the auto-response email';

-- ============================================
-- 6. Function to mark email as sent
-- ============================================

\echo 'Creating email sent marker function...'

CREATE OR REPLACE FUNCTION trapper.mark_out_of_county_email_sent(
    p_submission_id UUID,
    p_email_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.web_intake_submissions
    SET
        out_of_county_email_sent_at = NOW(),
        submission_status = 'complete',  -- Auto-close out-of-county submissions
        updated_at = NOW()
    WHERE submission_id = p_submission_id
      AND is_out_of_county = TRUE;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Summary
-- ============================================

\echo ''
\echo 'Running initial out-of-county flagging...'
SELECT trapper.flag_out_of_county_submissions() AS newly_flagged;

\echo ''
\echo 'Current out-of-county stats:'
SELECT
    COUNT(*) FILTER (WHERE is_out_of_county) AS total_out_of_county,
    COUNT(*) FILTER (WHERE is_out_of_county AND out_of_county_email_sent_at IS NOT NULL) AS emails_sent,
    COUNT(*) FILTER (WHERE is_out_of_county AND out_of_county_email_sent_at IS NULL) AS pending_emails
FROM trapper.web_intake_submissions;

\echo ''
\echo 'MIG_299 complete!'
\echo ''
\echo 'New components:'
\echo '  - is_out_of_county, out_of_county_email_sent_at columns on submissions'
\echo '  - email_templates table with default out-of-county template'
\echo '  - sent_emails log table'
\echo '  - flag_out_of_county_submissions() function'
\echo '  - v_pending_out_of_county_emails view'
\echo '  - mark_out_of_county_email_sent() function'
\echo ''
\echo 'Next steps (API implementation needed):'
\echo '  1. Add RESEND_API_KEY to environment variables'
\echo '  2. Create /api/emails/send-out-of-county endpoint'
\echo '  3. Add cron job to send pending out-of-county emails'
\echo '  4. Update intake triage to auto-flag out-of-county'
\echo ''
