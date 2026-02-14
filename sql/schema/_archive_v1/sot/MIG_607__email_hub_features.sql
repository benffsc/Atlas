\echo '=== MIG_607: Email Hub Features ==='
\echo 'Adds template suggestions, permission system, and audit views'

-- ============================================================================
-- Template Suggestions Table
-- Allows staff to suggest edits to templates, admins review and approve/reject
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_template_suggestions (
  suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which template
  template_id UUID NOT NULL REFERENCES trapper.email_templates(template_id) ON DELETE CASCADE,
  template_key TEXT NOT NULL, -- Denormalized for easier queries

  -- Suggested changes (null = no change)
  suggested_name TEXT,
  suggested_subject TEXT,
  suggested_body_html TEXT,
  suggested_body_text TEXT,
  suggestion_notes TEXT, -- Staff explains why

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),

  -- Review
  reviewed_by UUID REFERENCES trapper.staff(staff_id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Audit
  created_by UUID NOT NULL REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_suggestions_status
  ON trapper.email_template_suggestions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_template_suggestions_template
  ON trapper.email_template_suggestions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_suggestions_created_by
  ON trapper.email_template_suggestions(created_by);

COMMENT ON TABLE trapper.email_template_suggestions IS
  'Staff-submitted suggestions for template changes. Admins review and approve/reject.';

-- ============================================================================
-- Add Permission and Audit Columns to Templates
-- ============================================================================

ALTER TABLE trapper.email_templates
  ADD COLUMN IF NOT EXISTS edit_restricted BOOLEAN DEFAULT TRUE;

ALTER TABLE trapper.email_templates
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES trapper.staff(staff_id);

ALTER TABLE trapper.email_templates
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.email_templates.edit_restricted IS
  'If true, only admins can edit. Staff must submit suggestions instead.';

-- ============================================================================
-- Add request_id to sent_emails for Better Audit Trail
-- ============================================================================

ALTER TABLE trapper.sent_emails
  ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES trapper.sot_requests(request_id);

CREATE INDEX IF NOT EXISTS idx_sent_emails_request
  ON trapper.sent_emails(request_id) WHERE request_id IS NOT NULL;

-- ============================================================================
-- Email Hub Metrics View
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_email_hub_metrics AS
SELECT
  (SELECT COUNT(*) FROM trapper.outlook_email_accounts WHERE is_active = TRUE) AS connected_accounts,
  (SELECT COUNT(*) FROM trapper.email_templates WHERE is_active = TRUE) AS active_templates,
  (SELECT COUNT(*) FROM trapper.email_jobs WHERE status IN ('draft', 'queued')) AS pending_jobs,
  (SELECT COUNT(*) FROM trapper.email_batches WHERE status = 'draft') AS pending_batches,
  (SELECT COUNT(*) FROM trapper.email_template_suggestions WHERE status = 'pending') AS pending_suggestions,
  (SELECT COUNT(*) FROM trapper.sent_emails WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days') AS emails_sent_30d,
  (SELECT COUNT(*) FROM trapper.sent_emails WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 days') AS emails_failed_30d,
  CASE
    WHEN (SELECT COUNT(*) FROM trapper.sent_emails WHERE created_at > NOW() - INTERVAL '30 days') = 0 THEN 100.0
    ELSE ROUND(
      (SELECT COUNT(*) FROM trapper.sent_emails WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days')::numeric /
      NULLIF((SELECT COUNT(*) FROM trapper.sent_emails WHERE created_at > NOW() - INTERVAL '30 days'), 0) * 100,
      1
    )
  END AS success_rate_30d;

COMMENT ON VIEW trapper.v_email_hub_metrics IS
  'Aggregated metrics for the Email Hub dashboard.';

-- ============================================================================
-- Email Audit Log View
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_email_audit_log AS
SELECT
  se.email_id,
  se.template_key,
  et.name AS template_name,
  se.recipient_email,
  se.recipient_name,
  se.subject_rendered AS subject,
  se.body_html_rendered,
  se.status,
  se.error_message,
  se.sent_at,
  se.created_at,
  se.created_by,
  s.display_name AS sent_by_name,
  oa.email AS from_email,
  se.person_id,
  se.request_id,
  se.submission_id
FROM trapper.sent_emails se
LEFT JOIN trapper.email_templates et ON et.template_key = se.template_key
LEFT JOIN trapper.staff s ON s.staff_id::text = se.created_by
LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = se.outlook_account_id
ORDER BY se.created_at DESC;

COMMENT ON VIEW trapper.v_email_audit_log IS
  'Comprehensive view of all sent emails for audit log with search support.';

-- ============================================================================
-- Pending Template Suggestions View
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_pending_template_suggestions AS
SELECT
  ts.suggestion_id,
  ts.template_id,
  ts.template_key,
  ts.suggested_name,
  ts.suggested_subject,
  ts.suggested_body_html,
  ts.suggested_body_text,
  ts.suggestion_notes,
  ts.status,
  ts.created_at,
  ts.created_by,
  et.name AS template_name,
  et.subject AS current_subject,
  et.body_html AS current_body_html,
  s.display_name AS suggested_by_name,
  s.email AS suggested_by_email
FROM trapper.email_template_suggestions ts
JOIN trapper.email_templates et ON et.template_id = ts.template_id
JOIN trapper.staff s ON s.staff_id = ts.created_by
WHERE ts.status = 'pending'
ORDER BY ts.created_at DESC;

COMMENT ON VIEW trapper.v_pending_template_suggestions IS
  'Pending template suggestions for admin review, with current template values for comparison.';

-- ============================================================================
-- Recent Emails View (for hub preview)
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_recent_emails AS
SELECT
  se.email_id,
  se.template_key,
  et.name AS template_name,
  se.recipient_email,
  se.recipient_name,
  se.subject_rendered AS subject,
  se.status,
  se.sent_at,
  se.created_at,
  s.display_name AS sent_by_name
FROM trapper.sent_emails se
LEFT JOIN trapper.email_templates et ON et.template_key = se.template_key
LEFT JOIN trapper.staff s ON s.staff_id::text = se.created_by
ORDER BY se.created_at DESC
LIMIT 20;

COMMENT ON VIEW trapper.v_recent_emails IS
  'Recent emails for Email Hub dashboard preview.';

\echo 'MIG_607 complete: Email hub features added'
