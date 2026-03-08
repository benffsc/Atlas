-- ============================================================================
-- MIG_2870: Phone-Based Appointment Linking with Address Verification
-- ============================================================================
-- Problem: link_appointments_to_owners() only does email matching (~75%).
-- Phone-only appointments (106+ cats) never get linked because phone matching
-- requires address similarity verification (INV-12, MIG_2548).
--
-- Fix: Add phone matching block that:
-- 1. Matches unlinked appointments by phone (normalized via norm_phone_us)
-- 2. Verifies address similarity > 0.5 to avoid cross-household linking
-- 3. Respects soft blacklist for org/shared phones
-- 4. Queues ambiguous matches for review
--
-- FFS-314 (INV-15)
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2870: Phone-Based Appointment Linking'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Pre-check: How many phone-only appointments are unlinked?
-- ============================================================================

\echo '1. Pre-check: Phone-only unlinked appointments...'

SELECT
  COUNT(*) FILTER (WHERE a.person_id IS NULL AND a.owner_email IS NULL
    AND sot.norm_phone_us(a.owner_phone) IS NOT NULL) as phone_only_unlinked,
  COUNT(*) FILTER (WHERE a.person_id IS NULL AND a.owner_email IS NOT NULL) as email_unlinked,
  COUNT(*) FILTER (WHERE a.person_id IS NOT NULL) as already_linked,
  COUNT(*) as total
FROM ops.appointments a;

-- ============================================================================
-- 2. Replace link_appointments_to_owners with phone support
-- ============================================================================

\echo ''
\echo '2. Replacing link_appointments_to_owners() with phone support...'

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
  v_email_updated INT := 0;
  v_phone_updated INT := 0;
  v_phone_queued INT := 0;
  v_total_linked INT;
BEGIN
  -- =========================================================================
  -- PASS 1: Email matching (existing logic from MIG_2600)
  -- =========================================================================

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

  GET DIAGNOSTICS v_email_updated = ROW_COUNT;

  -- =========================================================================
  -- PASS 2: Phone matching with address verification (NEW - INV-15)
  -- =========================================================================

  -- Auto-link: same phone + similar address (similarity > 0.5)
  WITH phone_matches AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      p.person_id,
      similarity(
        LOWER(COALESCE(a.owner_address, '')),
        LOWER(COALESCE(pl.formatted_address, ''))
      ) as addr_sim
    FROM ops.appointments a
    JOIN sot.person_identifiers pi ON
      sot.norm_phone_us(a.owner_phone) = pi.id_value_norm
      AND pi.id_type = 'phone'
      AND pi.confidence >= 0.5
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL
    LEFT JOIN sot.places pl ON pl.place_id = p.primary_address_id
      AND pl.merged_into_place_id IS NULL
    WHERE a.person_id IS NULL  -- Still unlinked after email pass
      AND a.owner_email IS NULL  -- Phone-only (email already tried)
      AND sot.norm_phone_us(a.owner_phone) IS NOT NULL
      -- Respect soft blacklist for shared phones
      AND NOT EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist sb
        WHERE sb.identifier_type = 'phone'
        AND sot.norm_phone_us(a.owner_phone) = sb.identifier_norm
      )
      -- Address verification: similar address OR unknown address
      AND (
        -- No address to compare: allow match (moderate confidence)
        a.owner_address IS NULL OR TRIM(a.owner_address) = ''
        OR pl.formatted_address IS NULL
        -- Similar address: high confidence match
        OR similarity(
          LOWER(COALESCE(a.owner_address, '')),
          LOWER(COALESCE(pl.formatted_address, ''))
        ) > 0.5
      )
    ORDER BY a.appointment_id, pi.confidence DESC,
      similarity(LOWER(COALESCE(a.owner_address, '')), LOWER(COALESCE(pl.formatted_address, ''))) DESC
    LIMIT p_batch_limit
  )
  UPDATE ops.appointments a
  SET person_id = pm.person_id,
      updated_at = NOW()
  FROM phone_matches pm
  WHERE a.appointment_id = pm.appointment_id;

  GET DIAGNOSTICS v_phone_updated = ROW_COUNT;

  -- Queue for review: same phone but DIFFERENT address (possible household member)
  INSERT INTO ops.data_quality_review_queue (
    entity_type, entity_id, issue_type, suggested_action, details
  )
  SELECT DISTINCT ON (a.appointment_id)
    'appointment',
    a.appointment_id,
    'phone_address_mismatch',
    'review_link',
    jsonb_build_object(
      'person_id', p.person_id,
      'person_name', p.display_name,
      'appointment_phone', a.owner_phone,
      'appointment_address', a.owner_address,
      'person_address', pl.formatted_address,
      'address_similarity', similarity(
        LOWER(COALESCE(a.owner_address, '')),
        LOWER(COALESCE(pl.formatted_address, ''))
      )
    )
  FROM ops.appointments a
  JOIN sot.person_identifiers pi ON
    sot.norm_phone_us(a.owner_phone) = pi.id_value_norm
    AND pi.id_type = 'phone'
    AND pi.confidence >= 0.5
  JOIN sot.people p ON p.person_id = pi.person_id
    AND p.merged_into_person_id IS NULL
  JOIN sot.places pl ON pl.place_id = p.primary_address_id
    AND pl.merged_into_place_id IS NULL
  WHERE a.person_id IS NULL
    AND a.owner_email IS NULL
    AND sot.norm_phone_us(a.owner_phone) IS NOT NULL
    AND a.owner_address IS NOT NULL AND TRIM(a.owner_address) != ''
    AND pl.formatted_address IS NOT NULL
    -- Different address: similarity <= 0.5
    AND similarity(
      LOWER(a.owner_address),
      LOWER(pl.formatted_address)
    ) <= 0.5
    -- Not already in review queue
    AND NOT EXISTS (
      SELECT 1 FROM ops.data_quality_review_queue q
      WHERE q.entity_id = a.appointment_id
        AND q.issue_type = 'phone_address_mismatch'
        AND q.status = 'pending'
    )
    -- Not soft-blacklisted
    AND NOT EXISTS (
      SELECT 1 FROM sot.data_engine_soft_blacklist sb
      WHERE sb.identifier_type = 'phone'
      AND sot.norm_phone_us(a.owner_phone) = sb.identifier_norm
    )
  ORDER BY a.appointment_id, pi.confidence DESC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_phone_queued = ROW_COUNT;

  v_total_linked := v_email_updated + v_phone_updated;

  RAISE NOTICE 'link_appointments_to_owners: % email, % phone auto-linked, % phone queued for review',
    v_email_updated, v_phone_updated, v_phone_queued;

  RETURN QUERY SELECT v_total_linked, 0::INT, v_total_linked;
END;
$$;

COMMENT ON FUNCTION sot.link_appointments_to_owners(INT) IS
'MIG_2870: Links appointments to existing people via email AND phone.
Email pass: matches by normalized email with confidence >= 0.5 (INV-19).
Phone pass (NEW): matches by norm_phone_us() with address similarity > 0.5.
Phone mismatches (same phone, different address) queued for review.
Respects soft blacklist (INV-23), merge-aware (INV-7). FFS-314/INV-15.';

\echo '   Replaced link_appointments_to_owners() with phone support'

-- ============================================================================
-- 3. Run the updated function
-- ============================================================================

\echo ''
\echo '3. Running updated link_appointments_to_owners()...'

SELECT * FROM sot.link_appointments_to_owners();

-- ============================================================================
-- 4. Post-check
-- ============================================================================

\echo ''
\echo '4. Post-check: Remaining unlinked appointments...'

SELECT
  COUNT(*) FILTER (WHERE a.person_id IS NULL AND a.owner_email IS NULL
    AND sot.norm_phone_us(a.owner_phone) IS NOT NULL) as phone_only_still_unlinked,
  COUNT(*) FILTER (WHERE a.person_id IS NULL) as total_unlinked,
  COUNT(*) FILTER (WHERE a.person_id IS NOT NULL) as linked,
  COUNT(*) as total
FROM ops.appointments a;

\echo ''
\echo 'Phone-address mismatch items queued for review:'

SELECT COUNT(*) as queued_for_review
FROM ops.data_quality_review_queue
WHERE issue_type = 'phone_address_mismatch' AND status = 'pending';

\echo ''
\echo '================================================'
\echo '  MIG_2870 Complete (FFS-314/INV-15)'
\echo '================================================'
\echo ''
