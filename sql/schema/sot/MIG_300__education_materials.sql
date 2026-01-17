-- ============================================================================
-- MIG_300: Education Materials Distribution System
-- ============================================================================
--
-- Creates infrastructure for storing and distributing training materials
-- to trappers during onboarding and ongoing education.
--
-- Tables:
--   - education_materials: Core content storage
--   - material_completions: Track which trappers have viewed required materials
--
-- ============================================================================

\echo '=== MIG_300: Education Materials Distribution System ==='

-- ============================================================================
-- EDUCATION MATERIALS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.education_materials (
    material_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Content metadata
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'general',

    -- File info
    file_type TEXT NOT NULL DEFAULT 'pdf', -- pdf, document, video, image, other
    storage_url TEXT NOT NULL,
    original_filename TEXT,
    file_size_bytes INTEGER,

    -- Onboarding integration
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    required_for_onboarding_status TEXT, -- e.g., 'orientation_scheduled' means must view before orientation

    -- Display
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Usage tracking
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system'
);

COMMENT ON TABLE trapper.education_materials IS 'Training materials, guides, and resources for trappers';
COMMENT ON COLUMN trapper.education_materials.category IS 'Category: general, orientation, trapping, safety, animal_care, forms, video';
COMMENT ON COLUMN trapper.education_materials.required_for_onboarding_status IS 'If set, must be viewed before advancing past this onboarding status';

-- ============================================================================
-- MATERIAL COMPLETIONS (Track Trapper Progress)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.material_completions (
    completion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    material_id UUID NOT NULL REFERENCES trapper.education_materials(material_id),

    -- Completion info
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    downloaded_at TIMESTAMPTZ,

    -- Uniqueness
    UNIQUE(person_id, material_id)
);

COMMENT ON TABLE trapper.material_completions IS 'Tracks which trappers have viewed required materials';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_education_materials_category
    ON trapper.education_materials(category) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_education_materials_required
    ON trapper.education_materials(is_required) WHERE is_active AND is_required;

CREATE INDEX IF NOT EXISTS idx_material_completions_person
    ON trapper.material_completions(person_id);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_trapper_material_progress AS
SELECT
    p.person_id,
    p.display_name,
    COUNT(DISTINCT em.material_id) FILTER (WHERE em.is_required) AS required_materials,
    COUNT(DISTINCT mc.material_id) FILTER (WHERE em.is_required) AS completed_required,
    ROUND(
        100.0 * COUNT(DISTINCT mc.material_id) FILTER (WHERE em.is_required)
        / NULLIF(COUNT(DISTINCT em.material_id) FILTER (WHERE em.is_required), 0)
    , 0) AS completion_pct,
    ARRAY_AGG(DISTINCT em.title) FILTER (WHERE em.is_required AND mc.material_id IS NULL) AS missing_materials
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
    AND pr.role = 'trapper'
    AND pr.trapper_type IN ('ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator')
    AND pr.role_status = 'active'
CROSS JOIN trapper.education_materials em
LEFT JOIN trapper.material_completions mc ON mc.person_id = p.person_id AND mc.material_id = em.material_id
WHERE em.is_active
GROUP BY p.person_id, p.display_name;

COMMENT ON VIEW trapper.v_trapper_material_progress IS 'Shows each active trapper''s progress on required training materials';

-- ============================================================================
-- SEED DATA - Default Categories
-- ============================================================================

-- Insert some placeholder materials that can be replaced with real content
INSERT INTO trapper.education_materials (title, description, category, file_type, storage_url, is_required, display_order)
VALUES
    ('Trapper Orientation Guide', 'Essential reading before your orientation session', 'orientation', 'pdf', 'pending://orientation-guide.pdf', TRUE, 1),
    ('TNR Best Practices', 'Overview of trap-neuter-return methodology', 'trapping', 'pdf', 'pending://tnr-best-practices.pdf', TRUE, 2),
    ('Trapping Safety Guidelines', 'Safety procedures for trapping operations', 'safety', 'pdf', 'pending://safety-guidelines.pdf', TRUE, 3),
    ('Equipment Care Guide', 'How to maintain and clean trapping equipment', 'trapping', 'pdf', 'pending://equipment-care.pdf', FALSE, 4),
    ('Feral Cat Behavior', 'Understanding feral cat behavior for effective trapping', 'animal_care', 'pdf', 'pending://feral-behavior.pdf', FALSE, 5)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- AUTOMATION RULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.automation_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rule metadata
    name TEXT NOT NULL,
    description TEXT,

    -- Trigger configuration
    trigger_type TEXT NOT NULL, -- intake_status_change, onboarding_status_change, county_detected, etc
    trigger_config JSONB NOT NULL DEFAULT '{}'::JSONB,

    -- Action configuration
    action_type TEXT NOT NULL, -- send_email, create_task, update_field, webhook
    action_config JSONB NOT NULL DEFAULT '{}'::JSONB,

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Tracking
    execution_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'admin'
);

COMMENT ON TABLE trapper.automation_rules IS 'Configurable automation triggers and actions (like Zapier)';
COMMENT ON COLUMN trapper.automation_rules.trigger_type IS 'Event type: intake_status_change, onboarding_status_change, request_status_change, county_detected';
COMMENT ON COLUMN trapper.automation_rules.action_type IS 'Action type: send_email, create_task, update_field, webhook';

CREATE INDEX IF NOT EXISTS idx_automation_rules_active
    ON trapper.automation_rules(trigger_type) WHERE is_active;

-- ============================================================================
-- EMAIL TEMPLATES TABLE (if not exists from MIG_299)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    placeholders JSONB, -- Array of available placeholder names
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.email_templates IS 'Email templates with placeholder support';

-- Seed the out_of_county template
INSERT INTO trapper.email_templates (template_key, name, description, subject, body_html, placeholders)
VALUES (
    'out_of_county',
    'Out of County Notification',
    'Sent automatically when address is outside Sonoma County',
    'Your request is outside our service area',
    '<p>Hi {{first_name}},</p>
<p>Thank you for reaching out to Forgotten Felines of Sonoma County.</p>
<p>Unfortunately, the address you provided appears to be in <strong>{{county}}</strong>, which is outside our service area. We are only able to serve cats within Sonoma County.</p>
<p>We recommend contacting local animal services or TNR organizations in your area for assistance.</p>
<p>Best wishes,<br>Forgotten Felines Team</p>',
    ARRAY['first_name', 'county']
)
ON CONFLICT (template_key) DO NOTHING;

-- Seed onboarding email templates
INSERT INTO trapper.email_templates (template_key, name, description, subject, body_html, placeholders)
VALUES
    ('onboarding_welcome', 'Onboarding Welcome', 'First contact email for new trapper interest',
     'Welcome to Forgotten Felines - Next Steps',
     '<p>Hi {{first_name}},</p><p>Thank you for your interest in becoming a volunteer trapper with Forgotten Felines of Sonoma County!</p><p>We''ll be in touch soon to schedule your orientation session.</p><p>Best,<br>The FFSC Team</p>',
     ARRAY['first_name']),
    ('orientation_reminder', 'Orientation Reminder', 'Reminder before orientation session',
     'Reminder: Your FFSC Orientation',
     '<p>Hi {{first_name}},</p><p>This is a reminder about your upcoming orientation session.</p><p>Please review the training materials at your convenience before attending.</p><p>See you soon!</p>',
     ARRAY['first_name', 'orientation_date']),
    ('training_complete', 'Training Complete', 'Sent when training is completed',
     'Congratulations on Completing Training!',
     '<p>Hi {{first_name}},</p><p>Congratulations on completing your trapper training! You''re almost ready to start helping cats in Sonoma County.</p><p>Next step: We''ll send your volunteer contract for review and signature.</p><p>Thank you for joining our mission!</p>',
     ARRAY['first_name'])
ON CONFLICT (template_key) DO NOTHING;

-- ============================================================================
-- SENT EMAILS TABLE (if not exists from MIG_299)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.sent_emails (
    email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT REFERENCES trapper.email_templates(template_key),
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    subject_rendered TEXT NOT NULL,
    body_html_rendered TEXT,
    body_text_rendered TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, delivered, bounced, failed
    error_message TEXT,
    external_id TEXT, -- ID from email provider (Resend)
    submission_id UUID, -- Link to intake submission if applicable
    person_id UUID REFERENCES trapper.sot_people(person_id),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system'
);

COMMENT ON TABLE trapper.sent_emails IS 'Log of all sent emails for audit and tracking';

CREATE INDEX IF NOT EXISTS idx_sent_emails_submission
    ON trapper.sent_emails(submission_id) WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_person
    ON trapper.sent_emails(person_id) WHERE person_id IS NOT NULL;

\echo '=== MIG_300 Complete ==='
\echo 'Created: trapper.education_materials table'
\echo 'Created: trapper.material_completions table'
\echo 'Created: trapper.automation_rules table'
\echo 'Created: trapper.email_templates table (with seed data)'
\echo 'Created: trapper.sent_emails table'
\echo 'Created: trapper.v_trapper_material_progress view'
\echo ''
