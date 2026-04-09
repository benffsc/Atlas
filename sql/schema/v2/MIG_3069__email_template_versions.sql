-- MIG_3069: Email Template Version History
--
-- Part of FFS-1181 Follow-Up — Phase 6. Adds audit/versioning to
-- ops.email_templates. Every UPDATE that changes subject/body_html/
-- body_text snapshots the OLD row into ops.email_template_versions so
-- staff can view history and roll back.
--
-- Also seeds a v1 row for every existing template so the history is
-- non-empty on day one.
--
-- Depends on:
--   - ops.email_templates (MIG_2091)
--   - ops.staff
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3069: Email Template Version History'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.email_template_versions
-- ============================================================================

\echo '1. Creating ops.email_template_versions...'

CREATE TABLE IF NOT EXISTS ops.email_template_versions (
  version_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL REFERENCES ops.email_templates(template_key),
  version_number  INT NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_text       TEXT,
  placeholders    TEXT[],
  change_summary  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES ops.staff(staff_id),
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (template_key, version_number)
);

CREATE INDEX IF NOT EXISTS idx_email_template_versions_template
  ON ops.email_template_versions (template_key, version_number DESC);

COMMENT ON TABLE ops.email_template_versions IS
'MIG_3069 (FFS-1181 follow-up Phase 6): immutable version snapshots of
ops.email_templates. Created by trg_version_email_template on every
meaningful UPDATE. Used by the admin template edit UI for history +
rollback.';

-- ============================================================================
-- 2. Trigger function — snapshot previous state on UPDATE
-- ============================================================================

\echo '2. Creating ops.version_email_template() trigger function...'

CREATE OR REPLACE FUNCTION ops.version_email_template()
RETURNS TRIGGER AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
    FROM ops.email_template_versions
   WHERE template_key = OLD.template_key;

  INSERT INTO ops.email_template_versions (
    template_key, version_number, subject, body_html, body_text,
    placeholders, change_summary, created_by, is_active
  )
  VALUES (
    OLD.template_key,
    v_next,
    OLD.subject,
    OLD.body_html,
    OLD.body_text,
    OLD.placeholders,
    'Auto-versioned on update',
    NULL,
    FALSE
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_version_email_template ON ops.email_templates;
CREATE TRIGGER trg_version_email_template
  BEFORE UPDATE ON ops.email_templates
  FOR EACH ROW
  WHEN (
    OLD.body_html IS DISTINCT FROM NEW.body_html
    OR OLD.subject IS DISTINCT FROM NEW.subject
    OR OLD.body_text IS DISTINCT FROM NEW.body_text
  )
  EXECUTE FUNCTION ops.version_email_template();

-- ============================================================================
-- 3. Seed v1 for every existing template
-- ============================================================================

\echo '3. Seeding v1 for existing templates...'

INSERT INTO ops.email_template_versions (
  template_key, version_number, subject, body_html, body_text,
  placeholders, change_summary, is_active
)
SELECT
  t.template_key,
  1,
  t.subject,
  t.body_html,
  t.body_text,
  t.placeholders,
  'Initial version seeded by MIG_3069',
  TRUE
FROM ops.email_templates t
WHERE NOT EXISTS (
  SELECT 1
    FROM ops.email_template_versions v
   WHERE v.template_key = t.template_key
);

-- ============================================================================
-- 4. Verification
-- ============================================================================

\echo '4. Verification...'

DO $$
DECLARE
  v_versioned INT;
  v_templates INT;
BEGIN
  SELECT COUNT(*) INTO v_templates FROM ops.email_templates;
  SELECT COUNT(DISTINCT template_key) INTO v_versioned
    FROM ops.email_template_versions;

  RAISE NOTICE '   Templates seeded with v1: %/%', v_versioned, v_templates;

  IF v_versioned < v_templates THEN
    RAISE EXCEPTION 'Not all templates got a v1 seed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_version_email_template'
  ) THEN
    RAISE EXCEPTION 'trg_version_email_template trigger not created';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3069 complete'
\echo ''
