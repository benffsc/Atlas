-- MIG_242: Unified Activity Log System
--
-- Merges Journal and Communication Log into one unified system.
-- Every entity (Person, Place, Cat, Request, Intake Submission)
-- can have activity entries with consistent structure.
--
-- Key features:
-- - Who did it (staff member)
-- - What type (note, call, email, visit, etc.)
-- - When (occurred_at timestamp)
-- - Contact method & result (for communications)
-- - Notes/content
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_242__unified_activity_log.sql

\echo ''
\echo 'MIG_242: Unified Activity Log System'
\echo '====================================='
\echo ''

-- ============================================================
-- 1. Add communication fields to journal_entries
-- ============================================================

\echo 'Adding communication fields to journal_entries...'

-- Add contact_method column
ALTER TABLE trapper.journal_entries
ADD COLUMN IF NOT EXISTS contact_method TEXT;

-- Add contact_result column
ALTER TABLE trapper.journal_entries
ADD COLUMN IF NOT EXISTS contact_result TEXT;

-- Add intake submission link
ALTER TABLE trapper.journal_entries
ADD COLUMN IF NOT EXISTS primary_submission_id UUID REFERENCES trapper.web_intake_submissions(submission_id);

-- Create index for submission lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_submission
ON trapper.journal_entries(primary_submission_id)
WHERE primary_submission_id IS NOT NULL;

-- Add check constraints for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'journal_entries_contact_method_check'
  ) THEN
    ALTER TABLE trapper.journal_entries
    ADD CONSTRAINT journal_entries_contact_method_check
    CHECK (contact_method IS NULL OR contact_method IN (
      'phone', 'email', 'text', 'voicemail', 'in_person', 'mail', 'online_form'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'journal_entries_contact_result_check'
  ) THEN
    ALTER TABLE trapper.journal_entries
    ADD CONSTRAINT journal_entries_contact_result_check
    CHECK (contact_result IS NULL OR contact_result IN (
      'answered', 'no_answer', 'left_voicemail', 'sent', 'scheduled',
      'spoke', 'meeting_held', 'no_response', 'bounced', 'other'
    ));
  END IF;
END $$;

COMMENT ON COLUMN trapper.journal_entries.contact_method IS
'Communication method: phone, email, text, voicemail, in_person, mail, online_form';

COMMENT ON COLUMN trapper.journal_entries.contact_result IS
'Result of contact attempt: answered, no_answer, left_voicemail, sent, scheduled, spoke, etc.';

COMMENT ON COLUMN trapper.journal_entries.primary_submission_id IS
'Links journal entry to an intake submission for communication tracking';

-- ============================================================
-- 2. Update journal_entry_kind enum to include communications
-- ============================================================

\echo 'Adding communication entry kinds...'

-- Check if we need to add new values
DO $$
BEGIN
  -- Add 'communication' if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'communication'
    AND enumtypid = 'trapper.journal_entry_kind'::regtype
  ) THEN
    ALTER TYPE trapper.journal_entry_kind ADD VALUE IF NOT EXISTS 'communication';
  END IF;

  -- Add 'contact_attempt' if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'contact_attempt'
    AND enumtypid = 'trapper.journal_entry_kind'::regtype
  ) THEN
    ALTER TYPE trapper.journal_entry_kind ADD VALUE IF NOT EXISTS 'contact_attempt';
  END IF;

  -- Add 'appointment' if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'appointment'
    AND enumtypid = 'trapper.journal_entry_kind'::regtype
  ) THEN
    ALTER TYPE trapper.journal_entry_kind ADD VALUE IF NOT EXISTS 'appointment';
  END IF;
END $$;

-- ============================================================
-- 3. Migrate existing communication_logs to journal_entries
-- ============================================================

\echo 'Migrating communication_logs to journal_entries...'

INSERT INTO trapper.journal_entries (
  entry_kind,
  body,
  primary_submission_id,
  contact_method,
  contact_result,
  occurred_at,
  created_by,
  created_by_staff_id,
  created_at,
  meta
)
SELECT
  'contact_attempt'::trapper.journal_entry_kind,
  COALESCE(notes, 'Contact logged'),
  submission_id,
  contact_method,
  contact_result,
  contacted_at,
  contacted_by,
  staff_id,
  created_at,
  jsonb_build_object('migrated_from', 'communication_logs', 'original_log_id', log_id)
FROM trapper.communication_logs cl
WHERE NOT EXISTS (
  -- Skip if already migrated
  SELECT 1 FROM trapper.journal_entries je
  WHERE je.meta->>'original_log_id' = cl.log_id::text
);

-- ============================================================
-- 4. Create unified activity view
-- ============================================================

\echo 'Creating v_unified_activity_log view...'

CREATE OR REPLACE VIEW trapper.v_unified_activity_log AS
SELECT
  je.id as activity_id,
  je.entry_kind as activity_type,
  CASE
    WHEN je.entry_kind = 'contact_attempt' THEN
      CASE je.contact_method
        WHEN 'phone' THEN 'Phone call'
        WHEN 'email' THEN 'Email'
        WHEN 'text' THEN 'Text message'
        WHEN 'voicemail' THEN 'Voicemail'
        WHEN 'in_person' THEN 'In person'
        ELSE 'Contact'
      END
    ELSE je.entry_kind::text
  END as activity_label,
  je.title,
  je.body as notes,
  je.contact_method,
  je.contact_result,
  COALESCE(je.occurred_at, je.created_at) as occurred_at,
  je.created_at,
  -- Staff info
  s.display_name as staff_name,
  s.staff_id,
  je.created_by,
  -- Linked entities
  je.primary_submission_id,
  je.primary_request_id,
  je.primary_person_id,
  je.primary_place_id,
  je.primary_cat_id,
  -- Entity names for display
  CASE
    WHEN je.primary_submission_id IS NOT NULL THEN
      (SELECT CONCAT(first_name, ' ', last_name) FROM trapper.web_intake_submissions WHERE submission_id = je.primary_submission_id)
    WHEN je.primary_person_id IS NOT NULL THEN
      (SELECT display_name FROM trapper.sot_people WHERE person_id = je.primary_person_id)
    WHEN je.primary_place_id IS NOT NULL THEN
      (SELECT COALESCE(display_name, formatted_address) FROM trapper.places WHERE place_id = je.primary_place_id)
    ELSE NULL
  END as primary_entity_name,
  -- Metadata
  je.tags,
  je.is_pinned,
  je.is_archived
FROM trapper.journal_entries je
LEFT JOIN trapper.staff s ON s.staff_id = je.created_by_staff_id
WHERE je.is_archived = FALSE
ORDER BY COALESCE(je.occurred_at, je.created_at) DESC;

COMMENT ON VIEW trapper.v_unified_activity_log IS
'Unified view of all activity (notes, communications, updates) across all entities.
Use for activity feeds on any entity page.';

-- ============================================================
-- 5. Create function to log activity (replaces both systems)
-- ============================================================

\echo 'Creating log_activity function...'

CREATE OR REPLACE FUNCTION trapper.log_activity(
  -- What type
  p_activity_type TEXT DEFAULT 'note',  -- 'note', 'contact_attempt', 'update', 'appointment'
  p_notes TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  -- Communication details (optional)
  p_contact_method TEXT DEFAULT NULL,  -- 'phone', 'email', 'text', etc.
  p_contact_result TEXT DEFAULT NULL,  -- 'answered', 'no_answer', etc.
  -- Who did it
  p_staff_id UUID DEFAULT NULL,
  p_staff_name TEXT DEFAULT NULL,
  -- When
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  -- What entity (provide ONE of these)
  p_submission_id UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL,
  p_person_id UUID DEFAULT NULL,
  p_place_id UUID DEFAULT NULL,
  p_cat_id UUID DEFAULT NULL,
  -- Extra
  p_tags TEXT[] DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_entry_id UUID;
  v_entry_kind trapper.journal_entry_kind;
BEGIN
  -- Map activity type to entry kind
  v_entry_kind := CASE p_activity_type
    WHEN 'contact_attempt' THEN 'contact_attempt'::trapper.journal_entry_kind
    WHEN 'communication' THEN 'communication'::trapper.journal_entry_kind
    WHEN 'appointment' THEN 'appointment'::trapper.journal_entry_kind
    WHEN 'update' THEN 'update'::trapper.journal_entry_kind
    ELSE 'note'::trapper.journal_entry_kind
  END;

  INSERT INTO trapper.journal_entries (
    entry_kind,
    title,
    body,
    contact_method,
    contact_result,
    primary_submission_id,
    primary_request_id,
    primary_person_id,
    primary_place_id,
    primary_cat_id,
    occurred_at,
    created_by,
    created_by_staff_id,
    tags,
    created_at
  ) VALUES (
    v_entry_kind,
    p_title,
    COALESCE(p_notes, ''),
    p_contact_method,
    p_contact_result,
    p_submission_id,
    p_request_id,
    p_person_id,
    p_place_id,
    p_cat_id,
    COALESCE(p_occurred_at, NOW()),
    p_staff_name,
    p_staff_id,
    COALESCE(p_tags, '{}'),
    NOW()
  )
  RETURNING id INTO v_entry_id;

  -- If this is a contact attempt on a submission, update the submission stats
  IF p_submission_id IS NOT NULL AND p_activity_type = 'contact_attempt' THEN
    UPDATE trapper.web_intake_submissions
    SET
      last_contacted_at = COALESCE(p_occurred_at, NOW()),
      last_contact_method = p_contact_method,
      contact_attempt_count = COALESCE(contact_attempt_count, 0) + 1
    WHERE submission_id = p_submission_id;
  END IF;

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.log_activity IS
'Universal function to log any activity (note, contact attempt, update).
Works with any entity type. Replaces both journal and communication log systems.';

-- ============================================================
-- 6. Create view for submission activity (for intake queue)
-- ============================================================

\echo 'Creating v_submission_activity view...'

CREATE OR REPLACE VIEW trapper.v_submission_activity AS
SELECT
  je.id as activity_id,
  je.primary_submission_id as submission_id,
  je.entry_kind as activity_type,
  CASE je.contact_method
    WHEN 'phone' THEN 'Phone'
    WHEN 'email' THEN 'Email'
    WHEN 'text' THEN 'Text'
    WHEN 'voicemail' THEN 'Voicemail'
    WHEN 'in_person' THEN 'In Person'
    ELSE je.entry_kind::text
  END as activity_label,
  je.body as notes,
  je.contact_method,
  je.contact_result,
  COALESCE(je.occurred_at, je.created_at) as occurred_at,
  s.display_name as staff_name,
  je.created_by as staff_name_fallback
FROM trapper.journal_entries je
LEFT JOIN trapper.staff s ON s.staff_id = je.created_by_staff_id
WHERE je.primary_submission_id IS NOT NULL
  AND je.is_archived = FALSE
ORDER BY COALESCE(je.occurred_at, je.created_at) DESC;

COMMENT ON VIEW trapper.v_submission_activity IS
'Activity log for intake submissions. Use in intake queue detail modal.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_242 Complete!'
\echo ''
\echo 'What changed:'
\echo '  - journal_entries now has contact_method, contact_result, primary_submission_id'
\echo '  - Existing communication_logs migrated to journal_entries'
\echo '  - New entry kinds: contact_attempt, communication, appointment'
\echo ''
\echo 'New function:'
\echo '  trapper.log_activity() - Universal function to log any activity'
\echo ''
\echo 'New views:'
\echo '  v_unified_activity_log - All activity across all entities'
\echo '  v_submission_activity - Activity for intake submissions'
\echo ''
\echo 'Usage:'
\echo '  -- Log a phone call to a submission'
\echo '  SELECT trapper.log_activity('
\echo '    p_activity_type := ''contact_attempt'','
\echo '    p_notes := ''Left voicemail about appointment'','
\echo '    p_contact_method := ''phone'','
\echo '    p_contact_result := ''left_voicemail'','
\echo '    p_staff_id := ''abc-123...''::UUID,'
\echo '    p_submission_id := ''xyz-456...''::UUID'
\echo '  );'
\echo ''
\echo '  -- Log a note on a person'
\echo '  SELECT trapper.log_activity('
\echo '    p_activity_type := ''note'','
\echo '    p_notes := ''Approved as foster parent'','
\echo '    p_staff_id := ''abc-123...''::UUID,'
\echo '    p_person_id := ''xyz-456...''::UUID'
\echo '  );'
\echo ''
