-- ============================================================================
-- MIG_2862: Fix enrich_person_from_request — add base case + trigger fix
-- ============================================================================
-- Problem: ops.enrich_person_from_request() (MIG_2532:480-533) only handles
-- third-party reporters and site contacts. When a regular requestor submits,
-- they never get linked to the request's place in sot.person_place.
--
-- Also: auto_classify_requestor() trigger unconditionally overwrites
-- requester_role_at_submission on INSERT, ignoring UI-provided values.
--
-- Also: intake_submissions needs a requester_relationship column so callers
-- can self-identify their relationship to the location.
--
-- FFS-295
-- ============================================================================

\echo ''
\echo '=========================================='
\echo 'MIG_2862: Fix enrich_person_from_request'
\echo '=========================================='

-- ============================================================================
-- 1. Replace enrich_person_from_request with fixed version
-- ============================================================================

\echo ''
\echo '1. Replacing enrich_person_from_request() with base case support...'

CREATE OR REPLACE FUNCTION ops.enrich_person_from_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_req RECORD;
  v_rel_type TEXT;
BEGIN
  SELECT request_id, requester_person_id, place_id, is_third_party_report,
         requester_role_at_submission, site_contact_person_id, is_property_owner
  INTO v_req FROM ops.requests WHERE request_id = p_request_id;

  IF NOT FOUND OR v_req.requester_person_id IS NULL OR v_req.place_id IS NULL THEN
    RETURN;
  END IF;

  -- Skip trapper/staff roles (linked via trapper_service_places, not person_place)
  IF COALESCE(v_req.requester_role_at_submission, 'unknown') IN (
    'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff'
  ) THEN
    RETURN;
  END IF;

  -- CASE 1: Third-party reporter -> referrer
  IF v_req.is_third_party_report THEN
    PERFORM sot.link_person_to_place(
      v_req.requester_person_id, v_req.place_id,
      'referrer', 'request_report', 'atlas_ui', 'high'
    );
  ELSE
    -- CASE 2: Non-third-party -> map role to relationship type
    v_rel_type := CASE v_req.requester_role_at_submission
      WHEN 'resident'          THEN 'resident'
      WHEN 'property_owner'    THEN 'owner'
      WHEN 'colony_caretaker'  THEN 'colony_caretaker'
      WHEN 'neighbor'          THEN 'neighbor'
      WHEN 'concerned_citizen' THEN 'concerned_citizen'
      WHEN 'volunteer'         THEN 'volunteer'
      ELSE 'resident'  -- default for NULL/'unknown'/'frequent_caller'
    END;

    PERFORM sot.link_person_to_place(
      v_req.requester_person_id, v_req.place_id,
      v_rel_type, 'request_report', 'atlas_ui', 'high'
    );
  END IF;

  -- CASE 3: Site contact (if different from requester)
  IF v_req.site_contact_person_id IS NOT NULL
     AND v_req.site_contact_person_id != v_req.requester_person_id THEN
    PERFORM sot.link_person_to_place(
      v_req.site_contact_person_id, v_req.place_id,
      CASE WHEN v_req.is_property_owner THEN 'owner' ELSE 'resident' END,
      'request_report', 'atlas_ui', 'high'
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.enrich_person_from_request(UUID) IS
'Links requestor (and site contact) to request place via sot.link_person_to_place().
Handles: third-party reporters (referrer), regular callers (mapped by role), site contacts.
Skips trappers/staff (linked via trapper_service_places). FFS-295.';

\echo '   Replaced enrich_person_from_request() with base case support'

-- ============================================================================
-- 2. Fix auto_classify_requestor() trigger to respect UI-provided values
-- ============================================================================

\echo ''
\echo '2. Fixing auto_classify_requestor() to respect UI-provided values...'

CREATE OR REPLACE FUNCTION ops.auto_classify_requestor()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Only run if requester_person_id is set
  IF NEW.requester_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Respect explicit UI-provided role (don't overwrite non-'unknown' values)
  IF NEW.requester_role_at_submission IS NOT NULL
     AND NEW.requester_role_at_submission != 'unknown' THEN
    -- Still auto-set requester_is_site_contact logic below
    NULL;
  ELSE
    -- Get requestor role (cache at submission time)
    v_role := ops.classify_requestor_role(NEW.requester_person_id);
    NEW.requester_role_at_submission := v_role;
  END IF;

  -- Auto-set requester_is_site_contact based on role
  IF NEW.requester_is_site_contact IS NULL THEN
    IF NEW.requester_role_at_submission IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff') THEN
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

\echo '   Fixed auto_classify_requestor() to respect UI-provided role values'

-- ============================================================================
-- 3. Add 'request_report' to person_place evidence_type CHECK constraint
-- ============================================================================

\echo ''
\echo '3. Adding request_report to person_place evidence_type CHECK...'

DO $$
BEGIN
  ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_evidence_type_check;
  ALTER TABLE sot.person_place ADD CONSTRAINT person_place_evidence_type_check
    CHECK (evidence_type = ANY (ARRAY[
      'manual', 'inferred', 'imported', 'appointment',
      'owner_address', 'person_relationship', 'request_report'
    ]));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update evidence_type CHECK: %', SQLERRM;
END;
$$;

\echo '   Added request_report to evidence_type CHECK constraint'

-- ============================================================================
-- 4. Add requester_relationship column to intake_submissions
-- ============================================================================

\echo ''
\echo '3. Adding requester_relationship column to intake_submissions...'

ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS requester_relationship TEXT DEFAULT 'resident';

COMMENT ON COLUMN ops.intake_submissions.requester_relationship IS
'Self-reported relationship to location for non-third-party callers: resident, property_owner, colony_caretaker, neighbor, concerned_citizen, volunteer, other. FFS-298.';

\echo '   Added requester_relationship column'

-- ============================================================================
-- 4. Summary
-- ============================================================================

\echo ''
\echo '=========================================='
\echo 'MIG_2862 Complete'
\echo '=========================================='
\echo ''
\echo 'Fixed: enrich_person_from_request() now handles base case (non-third-party requestors)'
\echo 'Fixed: auto_classify_requestor() respects UI-provided requester_role_at_submission'
\echo 'Added: ops.intake_submissions.requester_relationship column'
\echo ''
\echo 'NEXT: Wire enrich call into request creation paths (MIG_2863)'
