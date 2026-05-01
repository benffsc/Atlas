-- MIG_3116: Trapper Onboarding Pipeline — real table + functions
--
-- Replaces stub views (MIG_2955) with a real table backing the
-- /trappers/onboarding page and its API routes.
--
-- Pipeline stages:
--   interested → contacted → orientation_complete → training_complete
--   → contract_sent → contract_signed → approved
-- Terminal states: declined, withdrawn, on_hold
--
-- FFS-1430
-- Created: 2026-05-01

\echo ''
\echo '=============================================='
\echo '  MIG_3116: Trapper Onboarding Pipeline'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Create ops.trapper_onboarding table
-- ============================================================================

\echo '1. Creating ops.trapper_onboarding table...'

CREATE TABLE IF NOT EXISTS ops.trapper_onboarding (
  onboarding_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id               UUID NOT NULL REFERENCES sot.people(person_id),
  status                  TEXT NOT NULL DEFAULT 'interested'
    CHECK (status IN (
      'interested', 'contacted',
      'orientation_scheduled', 'orientation_complete',
      'training_scheduled', 'training_complete',
      'contract_sent', 'contract_signed',
      'approved', 'declined', 'withdrawn', 'on_hold'
    )),
  target_trapper_type     TEXT NOT NULL DEFAULT 'ffsc_volunteer'
    CHECK (target_trapper_type IN ('ffsc_volunteer', 'community_trapper')),

  -- Stage completion timestamps
  interest_received_at    TIMESTAMPTZ DEFAULT NOW(),
  first_contact_at        TIMESTAMPTZ,
  orientation_completed_at TIMESTAMPTZ,
  training_completed_at   TIMESTAMPTZ,
  contract_sent_at        TIMESTAMPTZ,
  contract_signed_at      TIMESTAMPTZ,
  approved_at             TIMESTAMPTZ,

  -- Metadata
  coordinator_person_id   UUID REFERENCES sot.people(person_id),
  referral_source         TEXT,
  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(person_id)
);

CREATE INDEX IF NOT EXISTS idx_trapper_onboarding_status
  ON ops.trapper_onboarding(status);

COMMENT ON TABLE ops.trapper_onboarding IS
'Trapper onboarding pipeline. Tracks candidates from initial interest through
approval. Each person has at most one onboarding record (UNIQUE person_id).
FFS-1430.';

-- ============================================================================
-- 2. Replace stub views with real queries
-- ============================================================================

\echo '2. Replacing stub views with real queries...'

CREATE OR REPLACE VIEW ops.v_trapper_onboarding_pipeline AS
SELECT
  o.onboarding_id,
  o.person_id,
  p.display_name,
  sot.get_email(p.person_id) AS primary_email,
  sot.get_phone(p.person_id) AS primary_phone,
  o.status,
  o.target_trapper_type,

  -- Boolean checkpoints
  TRUE AS has_interest,
  o.first_contact_at IS NOT NULL AS has_contact,
  o.orientation_completed_at IS NOT NULL AS has_orientation,
  o.training_completed_at IS NOT NULL AS has_training,
  o.contract_sent_at IS NOT NULL AS has_contract_sent,
  o.contract_signed_at IS NOT NULL AS has_contract_signed,
  o.status = 'approved' AS is_approved,

  -- Timestamps
  o.interest_received_at,
  o.first_contact_at,
  o.orientation_completed_at,
  o.training_completed_at,
  o.contract_sent_at,
  o.contract_signed_at,
  o.approved_at,

  -- Duration metrics
  EXTRACT(DAY FROM NOW() - COALESCE(
    CASE o.status
      WHEN 'interested' THEN o.interest_received_at
      WHEN 'contacted' THEN o.first_contact_at
      WHEN 'orientation_scheduled' THEN o.first_contact_at
      WHEN 'orientation_complete' THEN o.orientation_completed_at
      WHEN 'training_scheduled' THEN o.orientation_completed_at
      WHEN 'training_complete' THEN o.training_completed_at
      WHEN 'contract_sent' THEN o.contract_sent_at
      WHEN 'contract_signed' THEN o.contract_signed_at
      WHEN 'approved' THEN o.approved_at
      ELSE o.updated_at
    END,
    o.created_at
  ))::INT AS days_in_status,
  EXTRACT(DAY FROM NOW() - o.interest_received_at)::INT AS days_in_pipeline,

  -- Coordinator
  coord.display_name AS coordinator_name,
  o.notes,
  o.referral_source

FROM ops.trapper_onboarding o
JOIN sot.people p ON p.person_id = o.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.people coord ON coord.person_id = o.coordinator_person_id;

CREATE OR REPLACE VIEW ops.v_trapper_onboarding_stats AS
SELECT
  o.status,
  COUNT(*)::INT AS count,
  ROUND(AVG(EXTRACT(DAY FROM NOW() - COALESCE(
    CASE o.status
      WHEN 'interested' THEN o.interest_received_at
      WHEN 'contacted' THEN o.first_contact_at
      WHEN 'orientation_complete' THEN o.orientation_completed_at
      WHEN 'training_complete' THEN o.training_completed_at
      WHEN 'contract_sent' THEN o.contract_sent_at
      WHEN 'contract_signed' THEN o.contract_signed_at
      ELSE o.updated_at
    END,
    o.created_at
  ))), 1)::NUMERIC AS avg_days_in_status
FROM ops.trapper_onboarding o
GROUP BY o.status;

COMMENT ON VIEW ops.v_trapper_onboarding_pipeline IS
'Trapper onboarding pipeline with boolean checkpoints and duration metrics. FFS-1430.';
COMMENT ON VIEW ops.v_trapper_onboarding_stats IS
'Trapper onboarding stats by status. FFS-1430.';

-- ============================================================================
-- 3. ops.create_trapper_interest — create a new onboarding candidate
-- ============================================================================

\echo '3. Creating ops.create_trapper_interest function...'

CREATE OR REPLACE FUNCTION ops.create_trapper_interest(
  p_first_name      TEXT,
  p_last_name       TEXT,
  p_email           TEXT    DEFAULT NULL,
  p_phone           TEXT    DEFAULT NULL,
  p_referral_source TEXT    DEFAULT NULL,
  p_target_type     TEXT    DEFAULT 'ffsc_volunteer',
  p_notes           TEXT    DEFAULT NULL,
  p_source_system   TEXT    DEFAULT 'atlas_ui'
) RETURNS TABLE(person_id UUID, onboarding_id UUID, is_new_person BOOLEAN) AS $$
DECLARE
  v_person_id UUID;
  v_onboarding_id UUID;
  v_is_new BOOLEAN := FALSE;
BEGIN
  -- Try to find existing person by email or phone
  IF p_email IS NOT NULL AND p_email != '' THEN
    SELECT pi.person_id INTO v_person_id
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(p_email))
    LIMIT 1;
  END IF;

  IF v_person_id IS NULL AND p_phone IS NOT NULL AND p_phone != '' THEN
    SELECT pi.person_id INTO v_person_id
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = 'phone' AND pi.id_value_norm = regexp_replace(p_phone, '[^0-9]', '', 'g')
    LIMIT 1;
  END IF;

  -- Create person if not found
  IF v_person_id IS NULL THEN
    v_person_id := sot.find_or_create_person(
      p_email := p_email,
      p_phone := p_phone,
      p_first_name := p_first_name,
      p_last_name := p_last_name,
      p_address := NULL,
      p_source_system := p_source_system
    );
    v_is_new := TRUE;
  END IF;

  -- Create onboarding record (or return existing)
  INSERT INTO ops.trapper_onboarding (
    person_id, status, target_trapper_type,
    referral_source, notes, interest_received_at
  ) VALUES (
    v_person_id, 'interested', COALESCE(p_target_type, 'ffsc_volunteer'),
    p_referral_source, p_notes, NOW()
  )
  ON CONFLICT (person_id) DO UPDATE SET
    notes = COALESCE(NULLIF(ops.trapper_onboarding.notes, ''), EXCLUDED.notes),
    updated_at = NOW()
  RETURNING ops.trapper_onboarding.onboarding_id INTO v_onboarding_id;

  RETURN QUERY SELECT v_person_id, v_onboarding_id, v_is_new;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. ops.advance_trapper_onboarding — move candidate to next status
-- ============================================================================

\echo '4. Creating ops.advance_trapper_onboarding function...'

CREATE OR REPLACE FUNCTION ops.advance_trapper_onboarding(
  p_person_id   UUID,
  p_new_status  TEXT,
  p_notes       TEXT DEFAULT NULL,
  p_advanced_by TEXT DEFAULT 'web_user'
) RETURNS TABLE(onboarding_id UUID, previous_status TEXT, new_status TEXT, person_created BOOLEAN) AS $$
DECLARE
  v_onboarding_id UUID;
  v_previous_status TEXT;
  v_ts TIMESTAMPTZ := NOW();
BEGIN
  -- Get current onboarding record
  SELECT o.onboarding_id, o.status
  INTO v_onboarding_id, v_previous_status
  FROM ops.trapper_onboarding o
  WHERE o.person_id = p_person_id;

  IF v_onboarding_id IS NULL THEN
    RAISE EXCEPTION 'No onboarding record for person %', p_person_id;
  END IF;

  -- Update status and set the appropriate timestamp
  UPDATE ops.trapper_onboarding o SET
    status = p_new_status,
    notes = CASE WHEN p_notes IS NOT NULL THEN
      COALESCE(o.notes || E'\n', '') || '[' || v_ts::DATE || ' ' || p_advanced_by || '] ' || p_notes
    ELSE o.notes END,
    first_contact_at = CASE WHEN p_new_status = 'contacted' AND o.first_contact_at IS NULL THEN v_ts ELSE o.first_contact_at END,
    orientation_completed_at = CASE WHEN p_new_status = 'orientation_complete' AND o.orientation_completed_at IS NULL THEN v_ts ELSE o.orientation_completed_at END,
    training_completed_at = CASE WHEN p_new_status = 'training_complete' AND o.training_completed_at IS NULL THEN v_ts ELSE o.training_completed_at END,
    contract_sent_at = CASE WHEN p_new_status = 'contract_sent' AND o.contract_sent_at IS NULL THEN v_ts ELSE o.contract_sent_at END,
    contract_signed_at = CASE WHEN p_new_status = 'contract_signed' AND o.contract_signed_at IS NULL THEN v_ts ELSE o.contract_signed_at END,
    approved_at = CASE WHEN p_new_status = 'approved' AND o.approved_at IS NULL THEN v_ts ELSE o.approved_at END,
    updated_at = v_ts
  WHERE o.onboarding_id = v_onboarding_id;

  -- If approved, create/update trapper_profile
  IF p_new_status = 'approved' THEN
    INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, source_system, created_at, updated_at)
    SELECT p_person_id,
           (SELECT target_trapper_type FROM ops.trapper_onboarding WHERE onboarding_id = v_onboarding_id),
           TRUE, 'atlas_ui', v_ts, v_ts
    ON CONFLICT (person_id) DO UPDATE SET
      is_active = TRUE,
      updated_at = v_ts;
  END IF;

  RETURN QUERY SELECT v_onboarding_id, v_previous_status, p_new_status, FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Seed existing active trappers as "approved" in the pipeline
-- ============================================================================

\echo '5. Seeding existing active trappers as approved...'

INSERT INTO ops.trapper_onboarding (person_id, status, target_trapper_type, approved_at, interest_received_at, notes)
SELECT
  tp.person_id,
  'approved',
  tp.trapper_type,
  COALESCE(tp.contract_signed_date, tp.certified_date, tp.created_at),
  COALESCE(tp.certified_date, tp.created_at),
  'Seeded from existing trapper_profile (MIG_3116)'
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
WHERE tp.is_active = TRUE
ON CONFLICT (person_id) DO NOTHING;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Verification:'

\echo ''
\echo 'Onboarding table row count:'
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'approved') AS approved
FROM ops.trapper_onboarding;

\echo ''
\echo 'Pipeline view sample:'
SELECT display_name, status, target_trapper_type, days_in_pipeline
FROM ops.v_trapper_onboarding_pipeline
ORDER BY status, display_name
LIMIT 10;

\echo ''
\echo 'Stats view:'
SELECT * FROM ops.v_trapper_onboarding_stats;

\echo ''
\echo 'Done. /trappers/onboarding page should now show real data.'
\echo ''
