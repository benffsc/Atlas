-- MIG_2522: Requestor vs Site Contact Distinction
--
-- Problem: The person who submits a request is often NOT the resident:
-- - Trappers call in colonies at sites they work
-- - Neighbors report cats at adjacent properties
-- - Property managers report for tenants
--
-- Solution:
-- 1. Add site_contact_person_id to track actual location contact
-- 2. Add requester_is_site_contact flag for common case (same person)
-- 3. Auto-detect trapper role to set defaults
-- 4. Cache requestor role at submission time
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2522: Requestor vs Site Contact'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current state
-- ============================================================================

\echo '1. Pre-check: Current request structure...'

SELECT
  COUNT(*) as total_requests,
  COUNT(requester_person_id) as with_requestor,
  COUNT(place_id) as with_place
FROM ops.requests
WHERE status NOT IN ('completed', 'cancelled');

-- ============================================================================
-- 2. Add new columns to ops.requests
-- ============================================================================

\echo ''
\echo '2. Adding site contact columns...'

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS site_contact_person_id UUID REFERENCES sot.people(person_id),
ADD COLUMN IF NOT EXISTS requester_is_site_contact BOOLEAN,
ADD COLUMN IF NOT EXISTS requester_role_at_submission TEXT;

-- Index for site contact lookups
CREATE INDEX IF NOT EXISTS idx_requests_site_contact
ON ops.requests(site_contact_person_id)
WHERE site_contact_person_id IS NOT NULL;

\echo '   Added columns: site_contact_person_id, requester_is_site_contact, requester_role_at_submission'

-- ============================================================================
-- 3. Create requestor role classification function
-- ============================================================================

\echo ''
\echo '3. Creating classify_requestor_role() function...'

CREATE OR REPLACE FUNCTION ops.classify_requestor_role(p_person_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_person_id IS NULL THEN
    RETURN 'unknown';
  END IF;

  -- Check trapper roles first (most likely to be "not resident")
  -- Priority order: coordinator > head_trapper > ffsc_trapper > community_trapper
  SELECT pr.role INTO v_role
  FROM sot.person_roles pr
  WHERE pr.person_id = p_person_id
    AND pr.role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper')
    AND pr.is_active = TRUE
  ORDER BY
    CASE pr.role
      WHEN 'coordinator' THEN 1
      WHEN 'head_trapper' THEN 2
      WHEN 'ffsc_trapper' THEN 3
      WHEN 'community_trapper' THEN 4
      WHEN 'trapper' THEN 5
      ELSE 99
    END
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- Check staff
  IF EXISTS (
    SELECT 1 FROM sot.staff
    WHERE person_id = p_person_id AND is_active = TRUE
  ) THEN
    RETURN 'staff';
  END IF;

  -- Check if person has submitted multiple requests (frequent caller)
  IF (
    SELECT COUNT(*) FROM ops.requests
    WHERE requester_person_id = p_person_id
  ) >= 3 THEN
    RETURN 'frequent_caller';
  END IF;

  -- Default: unknown (could be resident or not)
  RETURN 'unknown';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.classify_requestor_role(UUID) IS
'Classifies a person''s role for request context. Returns: coordinator, head_trapper, ffsc_trapper, community_trapper, trapper, staff, frequent_caller, or unknown.';

-- ============================================================================
-- 4. Create auto-classification trigger function
-- ============================================================================

\echo ''
\echo '4. Creating auto_classify_requestor() trigger function...'

CREATE OR REPLACE FUNCTION ops.auto_classify_requestor()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Only run if requester_person_id is set
  IF NEW.requester_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get requestor role (cache at submission time)
  v_role := ops.classify_requestor_role(NEW.requester_person_id);
  NEW.requester_role_at_submission := v_role;

  -- Auto-set requester_is_site_contact based on role
  IF NEW.requester_is_site_contact IS NULL THEN
    IF v_role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff') THEN
      -- Trappers/staff are NOT site contacts by default
      NEW.requester_is_site_contact := FALSE;
    ELSE
      -- Unknown requestors: if no explicit site contact set, assume they ARE the contact
      IF NEW.site_contact_person_id IS NULL THEN
        NEW.requester_is_site_contact := TRUE;
      END IF;
    END IF;
  END IF;

  -- If requester IS site contact and no explicit site_contact_person_id, copy it
  IF NEW.requester_is_site_contact = TRUE AND NEW.site_contact_person_id IS NULL THEN
    NEW.site_contact_person_id := NEW.requester_person_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_auto_classify_requestor ON ops.requests;

-- Create trigger
CREATE TRIGGER trg_auto_classify_requestor
BEFORE INSERT OR UPDATE OF requester_person_id, site_contact_person_id, requester_is_site_contact
ON ops.requests
FOR EACH ROW EXECUTE FUNCTION ops.auto_classify_requestor();

\echo '   Created trigger trg_auto_classify_requestor'

-- ============================================================================
-- 5. Backfill existing requests
-- ============================================================================

\echo ''
\echo '5. Backfilling existing requests with requestor role...'

-- Backfill role classification
UPDATE ops.requests r
SET requester_role_at_submission = ops.classify_requestor_role(r.requester_person_id)
WHERE r.requester_person_id IS NOT NULL
  AND r.requester_role_at_submission IS NULL;

-- Set site_contact for non-trapper requestors who don't have one
UPDATE ops.requests r
SET
  requester_is_site_contact = TRUE,
  site_contact_person_id = r.requester_person_id
WHERE r.requester_person_id IS NOT NULL
  AND r.site_contact_person_id IS NULL
  AND r.requester_role_at_submission NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff');

SELECT
  requester_role_at_submission,
  COUNT(*) as count
FROM ops.requests
WHERE requester_person_id IS NOT NULL
GROUP BY requester_role_at_submission
ORDER BY count DESC;

-- ============================================================================
-- 6. Create helper view for request contacts
-- ============================================================================

\echo ''
\echo '6. Creating v_request_contacts view...'

CREATE OR REPLACE VIEW ops.v_request_contacts AS
SELECT
  r.request_id,
  r.status,
  r.place_id,
  -- Requestor info
  r.requester_person_id,
  req.display_name AS requester_name,
  r.requester_role_at_submission,
  r.requester_is_site_contact,
  (
    SELECT pi.id_value
    FROM sot.person_identifiers pi
    WHERE pi.person_id = r.requester_person_id
      AND pi.id_type = 'email'
      AND pi.confidence >= 0.5
    LIMIT 1
  ) AS requester_email,
  (
    SELECT pi.id_value
    FROM sot.person_identifiers pi
    WHERE pi.person_id = r.requester_person_id
      AND pi.id_type = 'phone'
      AND pi.confidence >= 0.5
    LIMIT 1
  ) AS requester_phone,
  -- Site contact info
  r.site_contact_person_id,
  sc.display_name AS site_contact_name,
  (
    SELECT pi.id_value
    FROM sot.person_identifiers pi
    WHERE pi.person_id = r.site_contact_person_id
      AND pi.id_type = 'email'
      AND pi.confidence >= 0.5
    LIMIT 1
  ) AS site_contact_email,
  (
    SELECT pi.id_value
    FROM sot.person_identifiers pi
    WHERE pi.person_id = r.site_contact_person_id
      AND pi.id_type = 'phone'
      AND pi.confidence >= 0.5
    LIMIT 1
  ) AS site_contact_phone,
  -- Place info
  p.formatted_address AS place_address,
  p.display_name AS place_name
FROM ops.requests r
LEFT JOIN sot.people req ON req.person_id = r.requester_person_id
  AND req.merged_into_person_id IS NULL
LEFT JOIN sot.people sc ON sc.person_id = r.site_contact_person_id
  AND sc.merged_into_person_id IS NULL
LEFT JOIN sot.places p ON p.place_id = r.place_id
  AND p.merged_into_place_id IS NULL;

COMMENT ON VIEW ops.v_request_contacts IS
'View combining requestor and site contact information for requests. Distinguishes between who submitted vs who lives there.';

-- ============================================================================
-- 7. Summary
-- ============================================================================

\echo ''
\echo '7. Summary...'

SELECT
  'requests_with_site_contact' as metric,
  COUNT(*) as value
FROM ops.requests WHERE site_contact_person_id IS NOT NULL
UNION ALL
SELECT 'requests_where_requestor_is_contact', COUNT(*)
FROM ops.requests WHERE requester_is_site_contact = TRUE
UNION ALL
SELECT 'requests_where_requestor_not_contact', COUNT(*)
FROM ops.requests WHERE requester_is_site_contact = FALSE
UNION ALL
SELECT 'trapper_submitted_requests', COUNT(*)
FROM ops.requests
WHERE requester_role_at_submission IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper');

\echo ''
\echo '=============================================='
\echo '  MIG_2522 Complete'
\echo '=============================================='
\echo ''
\echo 'Added: site_contact_person_id column'
\echo 'Added: requester_is_site_contact flag'
\echo 'Added: requester_role_at_submission cache'
\echo 'Created: classify_requestor_role() function'
\echo 'Created: auto_classify_requestor() trigger'
\echo 'Created: v_request_contacts view'
\echo ''
\echo 'NEXT: Update UI to show requestor vs site contact'
\echo ''
