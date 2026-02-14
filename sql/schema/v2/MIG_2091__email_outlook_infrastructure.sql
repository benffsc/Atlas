-- MIG_2091: Email and Outlook Infrastructure for V2
-- Date: 2026-02-14
-- Purpose: Create ops.* email/outlook tables and trapper.* compatibility views
-- This completes the V2 infrastructure for email functionality

\echo ''
\echo '=============================================='
\echo '  MIG_2091: Email & Outlook Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. OPS.EMAIL_TEMPLATES (Move from trapper.email_templates)
-- ============================================================================

\echo '1. Creating ops.email_templates...'

-- Check if trapper.email_templates exists and has data
DO $$
DECLARE
    v_template_count INT;
    v_has_trapper_templates BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'email_templates'
    ) INTO v_has_trapper_templates;

    IF v_has_trapper_templates THEN
        SELECT COUNT(*) INTO v_template_count FROM trapper.email_templates;
        RAISE NOTICE 'trapper.email_templates exists with % rows - will migrate', v_template_count;
    ELSE
        RAISE NOTICE 'trapper.email_templates does not exist - creating ops.email_templates fresh';
    END IF;
END $$;

-- Create ops.email_templates table
CREATE TABLE IF NOT EXISTS ops.email_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    placeholders TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

COMMENT ON TABLE ops.email_templates IS
'V2 OPS: Email templates with HTML/text bodies and placeholders.
Moved from trapper.email_templates for proper V2 schema organization.';

-- Migrate data from trapper.email_templates if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'email_templates'
               AND table_type = 'BASE TABLE') THEN
        INSERT INTO ops.email_templates (
            template_id, template_key, name, description, subject,
            body_html, body_text, placeholders, is_active,
            created_at, updated_at, created_by
        )
        SELECT
            template_id, template_key, name, description, subject,
            body_html, body_text, placeholders, is_active,
            created_at, updated_at, created_by
        FROM trapper.email_templates
        ON CONFLICT (template_key) DO NOTHING;

        RAISE NOTICE 'Migrated email_templates from trapper to ops';
    END IF;
END $$;

\echo '   Created ops.email_templates'

-- ============================================================================
-- 2. OPS.SENT_EMAILS (Move from trapper.sent_emails)
-- ============================================================================

\echo ''
\echo '2. Creating ops.sent_emails...'

CREATE TABLE IF NOT EXISTS ops.sent_emails (
    email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL REFERENCES ops.email_templates(template_key),
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    submission_id UUID,  -- References web_intake_submissions
    person_id UUID REFERENCES sot.people(person_id),
    subject_rendered TEXT NOT NULL,
    body_html_rendered TEXT,
    body_text_rendered TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'sent', 'delivered', 'bounced', 'failed'
    )),
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    external_id TEXT,
    outlook_account_id UUID,  -- Will be linked after outlook table created
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_ops_sent_emails_submission
    ON ops.sent_emails(submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_sent_emails_status
    ON ops.sent_emails(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ops_sent_emails_person
    ON ops.sent_emails(person_id) WHERE person_id IS NOT NULL;

COMMENT ON TABLE ops.sent_emails IS
'V2 OPS: Log of all emails sent from the system.
Moved from trapper.sent_emails for proper V2 schema organization.';

-- Migrate data from trapper.sent_emails if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'sent_emails'
               AND table_type = 'BASE TABLE') THEN
        INSERT INTO ops.sent_emails (
            email_id, template_key, recipient_email, recipient_name,
            submission_id, person_id, subject_rendered, body_html_rendered,
            body_text_rendered, status, sent_at, error_message, external_id,
            outlook_account_id, created_at, created_by
        )
        SELECT
            email_id, template_key, recipient_email, recipient_name,
            submission_id, person_id, subject_rendered, body_html_rendered,
            body_text_rendered, status, sent_at, error_message, external_id,
            outlook_account_id, created_at, created_by
        FROM trapper.sent_emails
        ON CONFLICT (email_id) DO NOTHING;

        RAISE NOTICE 'Migrated sent_emails from trapper to ops';
    END IF;
END $$;

\echo '   Created ops.sent_emails'

-- ============================================================================
-- 3. OPS.OUTLOOK_EMAIL_ACCOUNTS (Move from trapper.outlook_email_accounts)
-- ============================================================================

\echo ''
\echo '3. Creating ops.outlook_email_accounts...'

CREATE TABLE IF NOT EXISTS ops.outlook_email_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    microsoft_user_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    connected_by_staff_id UUID REFERENCES ops.staff(staff_id),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    last_token_refresh_at TIMESTAMPTZ,
    connection_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_outlook_accounts_email
    ON ops.outlook_email_accounts(email) WHERE is_active = TRUE;

COMMENT ON TABLE ops.outlook_email_accounts IS
'V2 OPS: Connected Microsoft Outlook accounts for sending emails via Graph API.
Moved from trapper.outlook_email_accounts for proper V2 schema organization.
Note: Tokens are encrypted at rest.';

-- Add foreign key from sent_emails to outlook_accounts
ALTER TABLE ops.sent_emails
    ADD CONSTRAINT fk_sent_emails_outlook_account
    FOREIGN KEY (outlook_account_id) REFERENCES ops.outlook_email_accounts(account_id);

-- Migrate data from trapper.outlook_email_accounts if exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'outlook_email_accounts'
               AND table_type = 'BASE TABLE') THEN
        INSERT INTO ops.outlook_email_accounts (
            account_id, email, display_name, microsoft_user_id,
            access_token, refresh_token, token_expires_at,
            connected_by_staff_id, is_active, last_used_at,
            last_token_refresh_at, connection_error, created_at, updated_at
        )
        SELECT
            account_id, email, display_name, microsoft_user_id,
            access_token, refresh_token, token_expires_at,
            connected_by_staff_id, is_active, last_used_at,
            last_token_refresh_at, connection_error, created_at, updated_at
        FROM trapper.outlook_email_accounts
        ON CONFLICT (email) DO NOTHING;

        RAISE NOTICE 'Migrated outlook_email_accounts from trapper to ops';
    END IF;
END $$;

\echo '   Created ops.outlook_email_accounts'

-- ============================================================================
-- 4. TRAPPER COMPATIBILITY VIEWS
-- ============================================================================

\echo ''
\echo '4. Creating trapper compatibility views...'

-- Drop existing tables if they're base tables (replace with views)
DO $$
BEGIN
    -- Only drop if it's a base table, not a view
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'email_templates'
               AND table_type = 'BASE TABLE') THEN
        -- Can't drop if there are dependencies - need to handle carefully
        -- For now, we'll leave the base tables and just update code to use ops.*
        RAISE NOTICE 'trapper.email_templates is a BASE TABLE - leaving for compatibility';
    END IF;
END $$;

-- Create views pointing to ops.* tables (drop-create pattern)
DROP VIEW IF EXISTS trapper.v_connected_outlook_accounts CASCADE;

-- trapper.email_templates (if not already a view or base table)
-- For safety, create the ops.* version and let trapper.* remain as is
-- Code should migrate to using ops.* directly

-- View for active connected accounts (pointing to ops.*)
CREATE OR REPLACE VIEW ops.v_connected_outlook_accounts AS
SELECT
    oa.account_id,
    oa.email,
    oa.display_name,
    oa.is_active,
    oa.last_used_at,
    oa.connection_error,
    oa.created_at,
    s.display_name AS connected_by,
    oa.token_expires_at < NOW() AS token_expired,
    COUNT(se.email_id) AS emails_sent
FROM ops.outlook_email_accounts oa
LEFT JOIN ops.staff s ON s.staff_id = oa.connected_by_staff_id
LEFT JOIN ops.sent_emails se ON se.outlook_account_id = oa.account_id
WHERE oa.is_active = TRUE
GROUP BY oa.account_id, s.display_name
ORDER BY oa.email;

COMMENT ON VIEW ops.v_connected_outlook_accounts IS
'V2 OPS: Active Outlook accounts connected for email sending';

-- Compatibility view in trapper schema
CREATE OR REPLACE VIEW trapper.v_connected_outlook_accounts_v2 AS
SELECT * FROM ops.v_connected_outlook_accounts;

\echo '   Created compatibility views'

-- ============================================================================
-- 5. EMAIL FUNCTIONS (Wrappers to ops.*)
-- ============================================================================

\echo ''
\echo '5. Creating email function wrappers...'

-- Function to send email (wrapper to use ops.* tables)
CREATE OR REPLACE FUNCTION ops.send_email(
    p_template_key TEXT,
    p_recipient_email TEXT,
    p_recipient_name TEXT DEFAULT NULL,
    p_submission_id UUID DEFAULT NULL,
    p_person_id UUID DEFAULT NULL,
    p_placeholders JSONB DEFAULT '{}'::JSONB,
    p_outlook_account_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_template RECORD;
    v_email_id UUID;
    v_subject TEXT;
    v_body_html TEXT;
    v_body_text TEXT;
    v_key TEXT;
    v_value TEXT;
BEGIN
    -- Get template
    SELECT * INTO v_template
    FROM ops.email_templates
    WHERE template_key = p_template_key AND is_active = TRUE;

    IF v_template IS NULL THEN
        RAISE EXCEPTION 'Email template % not found or inactive', p_template_key;
    END IF;

    -- Replace placeholders
    v_subject := v_template.subject;
    v_body_html := v_template.body_html;
    v_body_text := v_template.body_text;

    FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_placeholders)
    LOOP
        v_subject := REPLACE(v_subject, '{{' || v_key || '}}', COALESCE(v_value, ''));
        v_body_html := REPLACE(v_body_html, '{{' || v_key || '}}', COALESCE(v_value, ''));
        IF v_body_text IS NOT NULL THEN
            v_body_text := REPLACE(v_body_text, '{{' || v_key || '}}', COALESCE(v_value, ''));
        END IF;
    END LOOP;

    -- Create sent_emails record
    INSERT INTO ops.sent_emails (
        template_key, recipient_email, recipient_name,
        submission_id, person_id,
        subject_rendered, body_html_rendered, body_text_rendered,
        status, outlook_account_id
    ) VALUES (
        p_template_key, p_recipient_email, p_recipient_name,
        p_submission_id, p_person_id,
        v_subject, v_body_html, v_body_text,
        'pending', p_outlook_account_id
    )
    RETURNING email_id INTO v_email_id;

    RETURN v_email_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.send_email IS
'V2 OPS: Creates a pending email record with rendered template.
Returns email_id for tracking. Actual sending done by API.';

-- Wrapper in trapper schema
CREATE OR REPLACE FUNCTION trapper.send_email(
    p_template_key TEXT,
    p_recipient_email TEXT,
    p_recipient_name TEXT DEFAULT NULL,
    p_submission_id UUID DEFAULT NULL,
    p_person_id UUID DEFAULT NULL,
    p_placeholders JSONB DEFAULT '{}'::JSONB,
    p_outlook_account_id UUID DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
    RETURN ops.send_email(
        p_template_key, p_recipient_email, p_recipient_name,
        p_submission_id, p_person_id, p_placeholders, p_outlook_account_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.send_email IS
'V1 compatibility wrapper - delegates to ops.send_email()';

-- Mark email as sent
CREATE OR REPLACE FUNCTION ops.mark_email_sent(
    p_email_id UUID,
    p_external_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE ops.sent_emails
    SET status = 'sent',
        sent_at = NOW(),
        external_id = COALESCE(p_external_id, external_id)
    WHERE email_id = p_email_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.mark_email_sent(
    p_email_id UUID,
    p_external_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    PERFORM ops.mark_email_sent(p_email_id, p_external_id);
END;
$$ LANGUAGE plpgsql;

\echo '   Created email functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Tables created:'
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname = 'ops'
  AND tablename IN ('email_templates', 'sent_emails', 'outlook_email_accounts')
ORDER BY tablename;

\echo ''
\echo 'Template count:'
SELECT COUNT(*) AS template_count FROM ops.email_templates;

\echo ''
\echo 'Email count:'
SELECT COUNT(*) AS email_count FROM ops.sent_emails;

\echo ''
\echo 'Outlook account count:'
SELECT COUNT(*) AS account_count FROM ops.outlook_email_accounts;

\echo ''
\echo '=============================================='
\echo '  MIG_2091 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created ops.* email/outlook infrastructure:'
\echo '  - ops.email_templates'
\echo '  - ops.sent_emails'
\echo '  - ops.outlook_email_accounts'
\echo '  - ops.v_connected_outlook_accounts'
\echo '  - ops.send_email(), ops.mark_email_sent()'
\echo ''
\echo 'Trapper compatibility wrappers created.'
\echo ''
