-- MIG_2600: Add Missing link_appointments_to_owners() Function
--
-- Critical Gap: This function was in V1 (MIG_862) but was NEVER ported to V2.
-- The ingest route calls it at line 1433 but it doesn't exist, causing all
-- appointment-person linking to silently fail.
--
-- This migration creates the function in the sot schema with V2 invariants:
-- - INV-19: Confidence filter (>= 0.5) for PetLink emails
-- - INV-23: Respect soft blacklist for org emails
-- - INV-21: Consistent API behavior
--
-- @see DATA_GAPS.md (appointment-person linking gap)
-- @see CLAUDE.md lines 66-78 (Identity & Data Engine Rules)
--
-- Created: 2026-02-28

\echo ''
\echo '=============================================='
\echo '  MIG_2600: Add link_appointments_to_owners'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE FUNCTION
-- ============================================================================

\echo '1. Creating sot.link_appointments_to_owners()...'

CREATE OR REPLACE FUNCTION sot.link_appointments_to_owners(
  p_batch_limit INT DEFAULT 2000
)
RETURNS TABLE(
  appointments_updated INT,
  persons_created INT,
  persons_linked INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_appointments_updated INT := 0;
  v_persons_linked INT := 0;
BEGIN
  -- Link appointments to existing people via email match.
  -- This is the primary linking path - finds people by email in person_identifiers.
  --
  -- Invariants respected:
  -- - INV-19: Only match emails with confidence >= 0.5 (filters PetLink fabricated emails)
  -- - INV-23: Skip soft-blacklisted org emails (marinferals@yahoo.com, etc.)
  -- - INV-7: Only match non-merged people (merged_into_person_id IS NULL)

  WITH email_matches AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      p.person_id
    FROM ops.appointments a
    JOIN sot.person_identifiers pi ON
      LOWER(TRIM(a.owner_email)) = pi.id_value_norm
      AND pi.id_type = 'email'
      AND pi.confidence >= 0.5  -- INV-19: PetLink confidence filter
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL  -- INV-7: Merge-aware
    WHERE a.person_id IS NULL  -- Only unlinked appointments
      AND a.owner_email IS NOT NULL
      AND TRIM(a.owner_email) != ''
      -- INV-23: Respect soft blacklist for org emails
      AND NOT EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist sb
        WHERE sb.identifier_type = 'email'
        AND LOWER(TRIM(a.owner_email)) = sb.identifier_norm
      )
    ORDER BY a.appointment_id, pi.confidence DESC
    LIMIT p_batch_limit
  )
  UPDATE ops.appointments a
  SET person_id = em.person_id,
      updated_at = NOW()
  FROM email_matches em
  WHERE a.appointment_id = em.appointment_id;

  GET DIAGNOSTICS v_appointments_updated = ROW_COUNT;
  v_persons_linked := v_appointments_updated;  -- Each link involves one person

  -- NOTE: Phone matching is intentionally NOT implemented here.
  -- Per INV-12 and MIG_2548, phone matching requires address similarity
  -- verification to avoid cross-linking household members. This is a
  -- future enhancement tracked in INV-15.
  --
  -- For now, email-only linking handles ~75% of appointments.
  -- The remaining phone-only appointments (106+ cats per INV-15) need
  -- the address check which requires additional infrastructure.

  -- Return results matching expected signature from ingest route (line 1432-1437)
  -- persons_created is always 0 since we only link to EXISTING people
  RETURN QUERY SELECT v_appointments_updated, 0::INT, v_persons_linked;
END;
$$;

COMMENT ON FUNCTION sot.link_appointments_to_owners(INT) IS
'Links appointments to existing people via email match.
Respects INV-19 (confidence filter), INV-23 (soft blacklist), INV-7 (merge-aware).
Phone matching not implemented - see INV-15 for future enhancement.
Returns: appointments_updated, persons_created (always 0), persons_linked';

-- ============================================================================
-- 2. RUN INITIAL BACKFILL
-- ============================================================================

\echo '2. Running initial backfill for existing unlinked appointments...'

-- Run with higher batch limit for initial backfill
SELECT * FROM sot.link_appointments_to_owners(10000);

\echo ''
\echo 'MIG_2600 complete. Results:'
\echo ''

-- Show stats
SELECT
  COUNT(*) FILTER (WHERE person_id IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE person_id IS NULL AND owner_email IS NOT NULL) AS still_unlinked_with_email,
  COUNT(*) FILTER (WHERE person_id IS NULL AND owner_email IS NULL AND owner_phone IS NOT NULL) AS phone_only
FROM ops.appointments;
