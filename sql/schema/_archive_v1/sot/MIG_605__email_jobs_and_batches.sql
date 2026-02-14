\echo '=== MIG_605: Email Jobs and Batches ==='
\echo 'Creates centralized email job queue and batch system'

-- ============================================================================
-- Email Categories
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_categories (
  category_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  default_outlook_account_id UUID REFERENCES trapper.outlook_email_accounts(account_id),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.email_categories IS
  'Email categories for routing and organization. Each category can have a default Outlook account.';

-- Seed default categories
INSERT INTO trapper.email_categories (category_key, display_name, description, sort_order)
VALUES
  ('client', 'Client Communication', 'Appointment confirmations, out-of-county, general client emails', 1),
  ('trapper', 'Trapper Communication', 'Welcome emails, assignments, trapper updates', 2),
  ('foster', 'Foster Communication', 'Foster family correspondence', 3),
  ('volunteer', 'Volunteer Coordination', 'Volunteer scheduling and updates', 4),
  ('system', 'System Notifications', 'Automated system notifications', 5)
ON CONFLICT (category_key) DO NOTHING;

-- ============================================================================
-- Add category to email_templates
-- ============================================================================

ALTER TABLE trapper.email_templates
  ADD COLUMN IF NOT EXISTS category_key TEXT REFERENCES trapper.email_categories(category_key),
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

COMMENT ON COLUMN trapper.email_templates.category_key IS
  'Category for routing and default account selection';
COMMENT ON COLUMN trapper.email_templates.language IS
  'Language code (en, es) for multi-language support';

-- Update existing templates with categories
UPDATE trapper.email_templates SET category_key = 'client' WHERE template_key = 'out_of_county';
UPDATE trapper.email_templates SET category_key = 'trapper' WHERE template_key = 'onboarding_welcome';
UPDATE trapper.email_templates SET category_key = 'trapper' WHERE template_key = 'orientation_reminder';
UPDATE trapper.email_templates SET category_key = 'trapper' WHERE template_key = 'training_complete';

-- ============================================================================
-- Email Jobs Queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template and category
  category_key TEXT REFERENCES trapper.email_categories(category_key),
  template_key TEXT REFERENCES trapper.email_templates(template_key),

  -- Recipient info
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  recipient_person_id UUID REFERENCES trapper.sot_people(person_id),

  -- Content (for custom emails without template)
  custom_subject TEXT,
  custom_body_html TEXT,

  -- Placeholder values
  placeholders JSONB DEFAULT '{}',

  -- Sending configuration
  outlook_account_id UUID REFERENCES trapper.outlook_email_accounts(account_id),

  -- Context links
  submission_id UUID REFERENCES trapper.web_intake_submissions(submission_id),
  request_id UUID REFERENCES trapper.sot_requests(request_id),

  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  sent_email_id UUID REFERENCES trapper.sent_emails(email_id),

  -- Audit
  created_by UUID REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON trapper.email_jobs(status) WHERE status IN ('draft', 'queued');
CREATE INDEX IF NOT EXISTS idx_email_jobs_category ON trapper.email_jobs(category_key);
CREATE INDEX IF NOT EXISTS idx_email_jobs_recipient ON trapper.email_jobs(recipient_person_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_created ON trapper.email_jobs(created_at DESC);

COMMENT ON TABLE trapper.email_jobs IS
  'Centralized email job queue. Staff creates jobs, reviews, then sends.';

-- ============================================================================
-- Email Batches (for combining multiple items into one email)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Batch type
  batch_type TEXT NOT NULL CHECK (batch_type IN ('trapper_assignments', 'general')),

  -- Recipient
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  recipient_person_id UUID REFERENCES trapper.sot_people(person_id),

  -- Content
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  item_count INT DEFAULT 0,

  -- Sending configuration
  outlook_account_id UUID REFERENCES trapper.outlook_email_accounts(account_id),

  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  sent_email_id UUID REFERENCES trapper.sent_emails(email_id),

  -- Audit
  created_by UUID REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_batches_status ON trapper.email_batches(status) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS idx_email_batches_type ON trapper.email_batches(batch_type);

COMMENT ON TABLE trapper.email_batches IS
  'Batched emails that combine multiple items (like trapper assignments) into one email.';

-- ============================================================================
-- Request Ready-to-Email Fields
-- ============================================================================

ALTER TABLE trapper.sot_requests
  ADD COLUMN IF NOT EXISTS ready_to_email BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_summary TEXT,
  ADD COLUMN IF NOT EXISTS email_batch_id UUID REFERENCES trapper.email_batches(batch_id);

COMMENT ON COLUMN trapper.sot_requests.ready_to_email IS
  'Flag for batching - staff marks requests ready to include in trapper email';
COMMENT ON COLUMN trapper.sot_requests.email_summary IS
  'Staff-written summary to include in batch email card';
COMMENT ON COLUMN trapper.sot_requests.email_batch_id IS
  'Links to batch when request was included in a batch email';

CREATE INDEX IF NOT EXISTS idx_requests_ready_to_email
  ON trapper.sot_requests(ready_to_email) WHERE ready_to_email = TRUE;

-- ============================================================================
-- Views
-- ============================================================================

-- Pending email jobs
CREATE OR REPLACE VIEW trapper.v_pending_email_jobs AS
SELECT
  ej.*,
  et.name AS template_name,
  et.subject AS template_subject,
  ec.display_name AS category_name,
  oa.email AS from_email,
  s.display_name AS created_by_name,
  p.display_name AS recipient_full_name
FROM trapper.email_jobs ej
LEFT JOIN trapper.email_templates et ON et.template_key = ej.template_key
LEFT JOIN trapper.email_categories ec ON ec.category_key = ej.category_key
LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = ej.outlook_account_id
LEFT JOIN trapper.staff s ON s.staff_id = ej.created_by
LEFT JOIN trapper.sot_people p ON p.person_id = ej.recipient_person_id
WHERE ej.status IN ('draft', 'queued')
ORDER BY ej.created_at DESC;

COMMENT ON VIEW trapper.v_pending_email_jobs IS
  'Email jobs pending review or sending';

-- Requests ready to email (for batch creation)
CREATE OR REPLACE VIEW trapper.v_requests_ready_to_email AS
SELECT
  r.request_id,
  r.email_summary,
  r.ready_to_email,
  r.status,
  r.priority,
  r.created_at,
  p.formatted_address,
  pe.display_name AS requester_name,
  (SELECT id_value_norm FROM trapper.person_identifiers
   WHERE person_id = pe.person_id AND id_type = 'email' LIMIT 1) AS requester_email,
  r.estimated_cat_count,
  r.notes
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people pe ON pe.person_id = r.requester_person_id
WHERE r.ready_to_email = TRUE
  AND r.email_batch_id IS NULL
  AND r.status NOT IN ('completed', 'cancelled')
ORDER BY r.priority DESC NULLS LAST, r.created_at;

COMMENT ON VIEW trapper.v_requests_ready_to_email IS
  'Requests marked ready for batch email to trappers';

-- Email job history
CREATE OR REPLACE VIEW trapper.v_email_job_history AS
SELECT
  ej.*,
  et.name AS template_name,
  ec.display_name AS category_name,
  oa.email AS from_email,
  s.display_name AS created_by_name
FROM trapper.email_jobs ej
LEFT JOIN trapper.email_templates et ON et.template_key = ej.template_key
LEFT JOIN trapper.email_categories ec ON ec.category_key = ej.category_key
LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = ej.outlook_account_id
LEFT JOIN trapper.staff s ON s.staff_id = ej.created_by
ORDER BY ej.created_at DESC;

COMMENT ON VIEW trapper.v_email_job_history IS
  'Full email job history with template and sender details';

-- Category stats
CREATE OR REPLACE VIEW trapper.v_email_category_stats AS
SELECT
  ec.category_key,
  ec.display_name,
  ec.description,
  oa.email AS default_from_email,
  COUNT(DISTINCT et.template_id) AS template_count,
  COUNT(DISTINCT ej.job_id) FILTER (WHERE ej.status = 'sent') AS emails_sent,
  MAX(ej.sent_at) AS last_sent_at
FROM trapper.email_categories ec
LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = ec.default_outlook_account_id
LEFT JOIN trapper.email_templates et ON et.category_key = ec.category_key AND et.is_active = TRUE
LEFT JOIN trapper.email_jobs ej ON ej.category_key = ec.category_key
WHERE ec.is_active = TRUE
GROUP BY ec.category_key, ec.display_name, ec.description, oa.email
ORDER BY ec.sort_order;

COMMENT ON VIEW trapper.v_email_category_stats IS
  'Email categories with template counts and send statistics';

\echo 'MIG_605 complete: Email jobs and batches infrastructure created'
