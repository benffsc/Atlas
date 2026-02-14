-- ============================================================================
-- MIG_558: Known Organizations V2 - Enhanced Matching & Audit
-- ============================================================================
-- Enhances the known_organizations table with:
-- 1. Pattern-based matching (name patterns, email domains, phone patterns)
-- 2. Match priority for ordering
-- 3. Auto-link control
-- 4. Organization match audit log
-- 5. Enhanced matching function v2
-- ============================================================================

\echo '=== MIG_558: Known Organizations V2 ==='

-- ============================================================================
-- Enhance known_organizations table
-- ============================================================================

\echo 'Enhancing known_organizations table...'

-- Add new columns for pattern matching
ALTER TABLE trapper.known_organizations
ADD COLUMN IF NOT EXISTS name_patterns TEXT[] DEFAULT '{}';

ALTER TABLE trapper.known_organizations
ADD COLUMN IF NOT EXISTS email_domains TEXT[] DEFAULT '{}';

ALTER TABLE trapper.known_organizations
ADD COLUMN IF NOT EXISTS phone_patterns TEXT[] DEFAULT '{}';

ALTER TABLE trapper.known_organizations
ADD COLUMN IF NOT EXISTS match_priority INT DEFAULT 100;

ALTER TABLE trapper.known_organizations
ADD COLUMN IF NOT EXISTS auto_link BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN trapper.known_organizations.name_patterns IS
  'ILIKE patterns for matching organization names (e.g., ''%Animal Services%'')';
COMMENT ON COLUMN trapper.known_organizations.email_domains IS
  'Email domains to match (e.g., ''sonomacounty.gov'')';
COMMENT ON COLUMN trapper.known_organizations.phone_patterns IS
  'Phone number patterns to match';
COMMENT ON COLUMN trapper.known_organizations.match_priority IS
  'Lower numbers = higher priority (county=10, rescue=50, other=100)';
COMMENT ON COLUMN trapper.known_organizations.auto_link IS
  'If TRUE, auto-link matches. If FALSE, flag for review.';

-- Index for priority ordering
CREATE INDEX IF NOT EXISTS idx_known_organizations_priority
  ON trapper.known_organizations(match_priority, is_active);

-- ============================================================================
-- Populate name_patterns from existing aliases
-- ============================================================================

\echo 'Populating name_patterns from aliases...'

UPDATE trapper.known_organizations
SET name_patterns = ARRAY[
  '%' || canonical_name || '%',
  '%' || short_name || '%'
] || COALESCE(
  (SELECT ARRAY_AGG('%' || a || '%') FROM UNNEST(aliases) a),
  '{}'::TEXT[]
)
WHERE name_patterns = '{}' OR name_patterns IS NULL;

-- Set email domains for known orgs
UPDATE trapper.known_organizations
SET email_domains = ARRAY['sonomacounty.gov']
WHERE short_name = 'SCAS' AND (email_domains = '{}' OR email_domains IS NULL);

UPDATE trapper.known_organizations
SET email_domains = ARRAY['humanesocietysoco.org']
WHERE short_name = 'HSSC' AND (email_domains = '{}' OR email_domains IS NULL);

UPDATE trapper.known_organizations
SET email_domains = ARRAY['forgottenfelines.com']
WHERE short_name = 'FFSC' AND (email_domains = '{}' OR email_domains IS NULL);

-- Set match priorities
UPDATE trapper.known_organizations
SET match_priority = CASE org_type
  WHEN 'shelter' THEN 10
  WHEN 'municipal' THEN 20
  WHEN 'clinic' THEN 30
  WHEN 'rescue' THEN 50
  ELSE 100
END
WHERE match_priority = 100;

-- ============================================================================
-- Create organization match audit log
-- ============================================================================

\echo 'Creating organization_match_log table...'

CREATE TABLE IF NOT EXISTS trapper.organization_match_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES trapper.known_organizations(org_id),
  matched_value TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('name', 'email_domain', 'phone', 'alias', 'pattern')),
  matched_pattern TEXT,
  confidence NUMERIC(3,2),
  source_system TEXT,
  source_record_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('linked', 'skipped', 'flagged', 'review')),
  person_id UUID REFERENCES trapper.sot_people(person_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_match_log_org_id
  ON trapper.organization_match_log(org_id);
CREATE INDEX IF NOT EXISTS idx_org_match_log_created_at
  ON trapper.organization_match_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_match_log_decision
  ON trapper.organization_match_log(decision) WHERE decision = 'review';

COMMENT ON TABLE trapper.organization_match_log IS
  'Audit trail for all organization matching decisions. Used for debugging and monitoring.';

-- ============================================================================
-- Enhanced matching function v2
-- ============================================================================

\echo 'Creating match_known_organization_v2 function...'

CREATE OR REPLACE FUNCTION trapper.match_known_organization_v2(
  p_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
  org_id UUID,
  canonical_name TEXT,
  canonical_person_id UUID,
  canonical_place_id UUID,
  match_type TEXT,
  matched_pattern TEXT,
  confidence NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized_name TEXT;
  v_email_domain TEXT;
  v_normalized_phone TEXT;
BEGIN
  -- Normalize inputs
  v_normalized_name := LOWER(TRIM(REGEXP_REPLACE(COALESCE(p_name, ''), '\s+', ' ', 'g')));

  -- Extract email domain
  IF p_email IS NOT NULL AND p_email LIKE '%@%' THEN
    v_email_domain := LOWER(SPLIT_PART(p_email, '@', 2));
  END IF;

  -- Normalize phone
  v_normalized_phone := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF LENGTH(v_normalized_phone) = 11 AND v_normalized_phone LIKE '1%' THEN
    v_normalized_phone := SUBSTRING(v_normalized_phone FROM 2);
  END IF;

  -- Skip if no usable input
  IF v_normalized_name = '' AND v_email_domain IS NULL AND v_normalized_phone = '' THEN
    RETURN;
  END IF;

  -- ========================================================================
  -- Priority 1: Exact canonical name match (highest confidence)
  -- ========================================================================
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    ko.canonical_person_id,
    ko.canonical_place_id,
    'name'::TEXT AS match_type,
    ko.canonical_name AS matched_pattern,
    1.0::NUMERIC AS confidence
  FROM trapper.known_organizations ko
  WHERE ko.is_active
    AND LOWER(ko.canonical_name) = v_normalized_name
  ORDER BY ko.match_priority
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- ========================================================================
  -- Priority 2: Email domain match (very high confidence)
  -- ========================================================================
  IF v_email_domain IS NOT NULL THEN
    RETURN QUERY
    SELECT
      ko.org_id,
      ko.canonical_name,
      ko.canonical_person_id,
      ko.canonical_place_id,
      'email_domain'::TEXT AS match_type,
      v_email_domain AS matched_pattern,
      0.95::NUMERIC AS confidence
    FROM trapper.known_organizations ko
    WHERE ko.is_active
      AND v_email_domain = ANY(ko.email_domains)
    ORDER BY ko.match_priority
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- ========================================================================
  -- Priority 3: Short name exact match
  -- ========================================================================
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    ko.canonical_person_id,
    ko.canonical_place_id,
    'alias'::TEXT AS match_type,
    ko.short_name AS matched_pattern,
    0.95::NUMERIC AS confidence
  FROM trapper.known_organizations ko
  WHERE ko.is_active
    AND ko.short_name IS NOT NULL
    AND LOWER(ko.short_name) = v_normalized_name
  ORDER BY ko.match_priority
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- ========================================================================
  -- Priority 4: Alias exact match
  -- ========================================================================
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    ko.canonical_person_id,
    ko.canonical_place_id,
    'alias'::TEXT AS match_type,
    (SELECT a FROM UNNEST(ko.aliases) a WHERE LOWER(a) = v_normalized_name LIMIT 1) AS matched_pattern,
    0.90::NUMERIC AS confidence
  FROM trapper.known_organizations ko
  WHERE ko.is_active
    AND v_normalized_name = ANY(SELECT LOWER(a) FROM UNNEST(ko.aliases) a)
  ORDER BY ko.match_priority
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- ========================================================================
  -- Priority 5: Name pattern match (ILIKE)
  -- ========================================================================
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    ko.canonical_person_id,
    ko.canonical_place_id,
    'pattern'::TEXT AS match_type,
    (
      SELECT p FROM UNNEST(ko.name_patterns) p
      WHERE v_normalized_name ILIKE p
      LIMIT 1
    ) AS matched_pattern,
    0.85::NUMERIC AS confidence
  FROM trapper.known_organizations ko
  WHERE ko.is_active
    AND EXISTS (
      SELECT 1 FROM UNNEST(ko.name_patterns) p
      WHERE v_normalized_name ILIKE p
    )
  ORDER BY ko.match_priority
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- ========================================================================
  -- Priority 6: Phone pattern match (lower confidence)
  -- ========================================================================
  IF v_normalized_phone != '' AND LENGTH(v_normalized_phone) >= 7 THEN
    RETURN QUERY
    SELECT
      ko.org_id,
      ko.canonical_name,
      ko.canonical_person_id,
      ko.canonical_place_id,
      'phone'::TEXT AS match_type,
      ko.phone AS matched_pattern,
      0.75::NUMERIC AS confidence
    FROM trapper.known_organizations ko
    WHERE ko.is_active
      AND ko.phone IS NOT NULL
      AND REGEXP_REPLACE(ko.phone, '[^0-9]', '', 'g') = v_normalized_phone
    ORDER BY ko.match_priority
    LIMIT 1;
  END IF;

  -- No match found
  RETURN;
END;
$$;

COMMENT ON FUNCTION trapper.match_known_organization_v2 IS
  'Enhanced organization matching with multiple strategies: exact name, email domain, aliases, patterns, phone.
   Returns org_id, canonical names/ids, match type, matched pattern, and confidence score.
   Checks in priority order and returns first match.';

-- ============================================================================
-- Helper function to log organization matches
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.log_organization_match(
  p_org_id UUID,
  p_matched_value TEXT,
  p_match_type TEXT,
  p_matched_pattern TEXT,
  p_confidence NUMERIC,
  p_source_system TEXT,
  p_source_record_id TEXT,
  p_decision TEXT,
  p_person_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO trapper.organization_match_log (
    org_id, matched_value, match_type, matched_pattern, confidence,
    source_system, source_record_id, decision, person_id, notes
  ) VALUES (
    p_org_id, p_matched_value, p_match_type, p_matched_pattern, p_confidence,
    p_source_system, p_source_record_id, p_decision, p_person_id, p_notes
  )
  RETURNING log_id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ============================================================================
-- View: Organization match statistics
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_organization_match_stats AS
SELECT
  ko.org_id,
  ko.canonical_name,
  ko.short_name,
  ko.org_type,
  ko.canonical_person_id IS NOT NULL AS has_canonical_person,
  ko.is_active,
  -- Match counts
  COUNT(oml.log_id) FILTER (WHERE oml.created_at > NOW() - INTERVAL '24 hours') AS matches_24h,
  COUNT(oml.log_id) FILTER (WHERE oml.created_at > NOW() - INTERVAL '7 days') AS matches_7d,
  COUNT(oml.log_id) AS matches_total,
  -- Decision breakdown
  COUNT(oml.log_id) FILTER (WHERE oml.decision = 'linked') AS linked_count,
  COUNT(oml.log_id) FILTER (WHERE oml.decision = 'review') AS review_count,
  COUNT(oml.log_id) FILTER (WHERE oml.decision = 'flagged') AS flagged_count,
  -- Last match
  MAX(oml.created_at) AS last_match_at
FROM trapper.known_organizations ko
LEFT JOIN trapper.organization_match_log oml ON oml.org_id = ko.org_id
GROUP BY ko.org_id, ko.canonical_name, ko.short_name, ko.org_type,
         ko.canonical_person_id, ko.is_active
ORDER BY matches_24h DESC, ko.canonical_name;

COMMENT ON VIEW trapper.v_organization_match_stats IS
  'Statistics on organization matching activity. Shows match counts, decision breakdown, and recency.';

-- ============================================================================
-- View: Pending organization reviews
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_organization_pending_reviews AS
SELECT
  oml.log_id,
  oml.matched_value,
  oml.match_type,
  oml.matched_pattern,
  oml.confidence,
  oml.source_system,
  oml.source_record_id,
  oml.created_at,
  ko.canonical_name,
  ko.short_name,
  ko.org_type
FROM trapper.organization_match_log oml
JOIN trapper.known_organizations ko ON ko.org_id = oml.org_id
WHERE oml.decision = 'review'
ORDER BY oml.created_at;

COMMENT ON VIEW trapper.v_organization_pending_reviews IS
  'Organization matches flagged for review. Used in admin UI.';

\echo ''
\echo '=== MIG_558 Complete ==='
\echo 'Enhanced: known_organizations table with patterns, email domains, priority'
\echo 'Created: organization_match_log table for audit trail'
\echo 'Created: match_known_organization_v2() function'
\echo 'Created: log_organization_match() helper function'
\echo 'Created: v_organization_match_stats view'
\echo 'Created: v_organization_pending_reviews view'
