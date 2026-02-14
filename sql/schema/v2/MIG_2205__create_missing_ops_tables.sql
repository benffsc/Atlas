-- MIG_2205: Create Missing Operational Tables
-- Date: 2026-02-14
--
-- Purpose: Create tables that code references but don't exist
-- These are critical for various features to work

\echo ''
\echo '=============================================='
\echo '  MIG_2205: Create Missing Operational Tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. TIPPY AI CHAT SYSTEM
-- ============================================================================

\echo '1. Creating Tippy AI tables...'

-- Tippy conversations
CREATE TABLE IF NOT EXISTS ops.tippy_conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID REFERENCES ops.staff(staff_id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tools_used TEXT[] DEFAULT '{}',
    session_context JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_tippy_conversations_staff ON ops.tippy_conversations(staff_id);
CREATE INDEX IF NOT EXISTS idx_tippy_conversations_updated ON ops.tippy_conversations(updated_at DESC);

COMMENT ON TABLE ops.tippy_conversations IS 'Tippy AI chat conversation sessions';

-- Tippy messages
CREATE TABLE IF NOT EXISTS ops.tippy_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_results JSONB,
    tokens_used INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_messages_conversation ON ops.tippy_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tippy_messages_created ON ops.tippy_messages(created_at);

COMMENT ON TABLE ops.tippy_messages IS 'Individual messages in Tippy conversations';

-- Tippy feedback
CREATE TABLE IF NOT EXISTS ops.tippy_feedback (
    feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
    message_id UUID REFERENCES ops.tippy_messages(message_id),
    staff_id UUID REFERENCES ops.staff(staff_id),
    rating INT CHECK (rating >= 1 AND rating <= 5),
    feedback_type TEXT CHECK (feedback_type IN ('helpful', 'not_helpful', 'incorrect', 'suggestion')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_feedback_conversation ON ops.tippy_feedback(conversation_id);

COMMENT ON TABLE ops.tippy_feedback IS 'User feedback on Tippy responses';

-- Tippy draft requests (for AI-assisted request creation)
CREATE TABLE IF NOT EXISTS ops.tippy_draft_requests (
    draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
    staff_id UUID REFERENCES ops.staff(staff_id),
    draft_data JSONB NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'discarded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.tippy_draft_requests IS 'Draft requests created via Tippy AI';

-- Tippy proposed corrections
CREATE TABLE IF NOT EXISTS ops.tippy_proposed_corrections (
    correction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    field_name TEXT NOT NULL,
    current_value TEXT,
    proposed_value TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_applied')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES ops.staff(staff_id)
);

CREATE INDEX IF NOT EXISTS idx_tippy_corrections_status ON ops.tippy_proposed_corrections(status);

COMMENT ON TABLE ops.tippy_proposed_corrections IS 'Data corrections proposed by Tippy AI';

-- Tippy unanswerable questions (for improving capabilities)
CREATE TABLE IF NOT EXISTS ops.tippy_capability_gaps (
    gap_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
    question TEXT NOT NULL,
    category TEXT,
    suggested_tool TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.tippy_capability_gaps IS 'Questions Tippy could not answer - used for improvement';

\echo '   Created ops.tippy_* tables'

-- ============================================================================
-- 2. EMAIL JOB SYSTEM
-- ============================================================================

\echo ''
\echo '2. Creating Email system tables...'

-- Email jobs (individual emails to send)
CREATE TABLE IF NOT EXISTS ops.email_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID,
    template_key TEXT REFERENCES ops.email_templates(template_key),
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    person_id UUID REFERENCES sot.people(person_id),
    submission_id UUID,
    placeholders JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    error_message TEXT,
    outlook_account_id UUID REFERENCES ops.outlook_email_accounts(account_id),
    category_key TEXT,
    priority INT DEFAULT 0,
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON ops.email_jobs(status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_batch ON ops.email_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled ON ops.email_jobs(scheduled_for) WHERE status = 'pending';

COMMENT ON TABLE ops.email_jobs IS 'Individual email sending jobs';

-- Email batches (group of emails sent together)
CREATE TABLE IF NOT EXISTS ops.email_batches (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    template_key TEXT REFERENCES ops.email_templates(template_key),
    created_by UUID REFERENCES ops.staff(staff_id),
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'cancelled')),
    total_recipients INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    outlook_account_id UUID REFERENCES ops.outlook_email_accounts(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_batches_status ON ops.email_batches(status);

COMMENT ON TABLE ops.email_batches IS 'Batch email operations';

-- Email categories
CREATE TABLE IF NOT EXISTS ops.email_categories (
    category_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    default_template_key TEXT,
    is_active BOOLEAN DEFAULT true
);

INSERT INTO ops.email_categories (category_key, display_name, description) VALUES
    ('intake_response', 'Intake Response', 'Automated responses to intake submissions'),
    ('request_update', 'Request Update', 'Updates about trapping requests'),
    ('trapper_assignment', 'Trapper Assignment', 'Notifications to trappers about assignments'),
    ('general', 'General', 'General communications')
ON CONFLICT (category_key) DO NOTHING;

COMMENT ON TABLE ops.email_categories IS 'Email category taxonomy';

\echo '   Created ops.email_* tables'

-- ============================================================================
-- 3. PARTNER ORGANIZATIONS
-- ============================================================================

\echo ''
\echo '3. Creating Partner organization tables...'

CREATE TABLE IF NOT EXISTS ops.partner_organizations (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    org_type TEXT CHECK (org_type IN ('shelter', 'rescue', 'vet_clinic', 'municipal', 'other')),
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_orgs_name ON ops.partner_organizations(name);

INSERT INTO ops.partner_organizations (name, short_name, org_type) VALUES
    ('Sonoma County Animal Services', 'SCAS', 'shelter'),
    ('Marin Humane Society', 'MHS', 'shelter'),
    ('Petaluma Animal Services Foundation', 'PASF', 'shelter')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE ops.partner_organizations IS 'Partner organizations FFSC works with';

-- Organization match log (for entity resolution)
CREATE TABLE IF NOT EXISTS ops.organization_match_log (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES ops.partner_organizations(org_id),
    raw_name TEXT NOT NULL,
    match_score NUMERIC(5,2),
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.organization_match_log IS 'Log of organization name matching attempts';

\echo '   Created ops.partner_organizations'

-- ============================================================================
-- 4. DATA IMPROVEMENTS TRACKING
-- ============================================================================

\echo ''
\echo '4. Creating Data improvement tables...'

CREATE TABLE IF NOT EXISTS ops.data_improvements (
    improvement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    improvement_type TEXT CHECK (improvement_type IN ('correction', 'enrichment', 'cleanup', 'merge')),
    source TEXT DEFAULT 'tippy',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'auto_applied')),
    created_by UUID REFERENCES ops.staff(staff_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    applied_by UUID REFERENCES ops.staff(staff_id)
);

CREATE INDEX IF NOT EXISTS idx_data_improvements_status ON ops.data_improvements(status);
CREATE INDEX IF NOT EXISTS idx_data_improvements_entity ON ops.data_improvements(entity_type, entity_id);

COMMENT ON TABLE ops.data_improvements IS 'Tracked data quality improvements';

\echo '   Created ops.data_improvements'

-- ============================================================================
-- 5. TRAPPER COMPATIBILITY VIEWS
-- ============================================================================

\echo ''
\echo '5. Creating trapper compatibility views...'

-- Create views in trapper schema pointing to new ops tables
CREATE OR REPLACE VIEW trapper.tippy_conversations AS SELECT * FROM ops.tippy_conversations;
CREATE OR REPLACE VIEW trapper.tippy_messages AS SELECT * FROM ops.tippy_messages;
CREATE OR REPLACE VIEW trapper.tippy_feedback AS SELECT * FROM ops.tippy_feedback;
CREATE OR REPLACE VIEW trapper.tippy_draft_requests AS SELECT * FROM ops.tippy_draft_requests;
CREATE OR REPLACE VIEW trapper.tippy_proposed_corrections AS SELECT * FROM ops.tippy_proposed_corrections;
CREATE OR REPLACE VIEW trapper.tippy_capability_gaps AS SELECT * FROM ops.tippy_capability_gaps;
CREATE OR REPLACE VIEW trapper.email_jobs AS SELECT * FROM ops.email_jobs;
CREATE OR REPLACE VIEW trapper.email_batches AS SELECT * FROM ops.email_batches;
CREATE OR REPLACE VIEW trapper.email_categories AS SELECT * FROM ops.email_categories;
CREATE OR REPLACE VIEW trapper.partner_organizations AS SELECT * FROM ops.partner_organizations;
CREATE OR REPLACE VIEW trapper.organization_match_log AS SELECT * FROM ops.organization_match_log;
CREATE OR REPLACE VIEW trapper.data_improvements AS SELECT * FROM ops.data_improvements;

\echo '   Created trapper.* compatibility views'

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_tables TEXT[];
BEGIN
    SELECT array_agg(table_name)
    INTO v_tables
    FROM information_schema.tables
    WHERE table_schema = 'ops'
      AND table_name IN (
          'tippy_conversations', 'tippy_messages', 'tippy_feedback',
          'tippy_draft_requests', 'tippy_proposed_corrections',
          'email_jobs', 'email_batches', 'email_categories',
          'partner_organizations', 'data_improvements'
      );

    RAISE NOTICE 'Created tables: %', array_to_string(v_tables, ', ');
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2205 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created operational tables:'
\echo '  - ops.tippy_conversations, tippy_messages, tippy_feedback'
\echo '  - ops.tippy_draft_requests, tippy_proposed_corrections'
\echo '  - ops.email_jobs, email_batches, email_categories'
\echo '  - ops.partner_organizations, organization_match_log'
\echo '  - ops.data_improvements'
\echo ''
\echo 'Created trapper.* compatibility views for all new tables.'
\echo ''
