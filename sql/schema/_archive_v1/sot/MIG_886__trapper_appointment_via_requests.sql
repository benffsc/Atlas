-- ============================================================================
-- MIG_886: Trapper-Appointment Linking via Request Chain
-- ============================================================================
-- Problem: Only 3.2% of appointments have trapper_person_id. The current
-- link_appointments_to_trappers() matches via owner_email/phone to trapper
-- person_identifiers, but owner != trapper. Only works if trapper brought
-- their own cat.
--
-- Solution: Add appointment→request linking via place + attribution window,
-- then derive trapper from request_trapper_assignments.
--
-- Chain: Appointment → Place → Request → Trapper Assignment → trapper_person_id
--
-- Note: Only 289 requests exist with 187 having trapper assignments, so
-- improvement is modest (~984 appointments → ~5.3% total). The request_id
-- column is infrastructure for future growth as more requests are created.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_886: Trapper-Appointment Linking via Request Chain'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Pre-diagnostic
-- ============================================================================

\echo 'Phase 1: Baseline stats...'

SELECT
  COUNT(*) AS total_appointments,
  COUNT(trapper_person_id) AS has_trapper,
  ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) AS pct_trapper_linked
FROM trapper.sot_appointments;

-- ============================================================================
-- Phase 2: Add request_id column to sot_appointments
-- ============================================================================

\echo ''
\echo 'Phase 2: Adding request_id column...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES trapper.sot_requests(request_id);

CREATE INDEX IF NOT EXISTS idx_appointments_request_id
    ON trapper.sot_appointments(request_id) WHERE request_id IS NOT NULL;

COMMENT ON COLUMN trapper.sot_appointments.request_id IS
'MIG_886: Request linked to this appointment via place + attribution window.
Chain: appointment.place_id → sot_requests.place_id within attribution window.';

-- ============================================================================
-- Phase 3: Create link_appointments_to_requests() function
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating link_appointments_to_requests()...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_to_requests()
RETURNS TABLE(appointments_linked integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Link appointments to requests via place_id + attribution window.
  -- Uses the same window logic as link_cats_to_requests_safe() (MIG_860):
  --   Appointment within 6 months of request creation
  --   OR while request was still active (not resolved)
  --   OR before request was resolved
  --
  -- When multiple requests match, picks the best:
  --   1. Active (not resolved) requests first
  --   2. Most recent source_created_at

  WITH best_request AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      r.request_id
    FROM trapper.sot_appointments a
    JOIN trapper.sot_requests r ON r.place_id = a.place_id
    WHERE a.request_id IS NULL
      AND a.place_id IS NOT NULL
      -- Appointment must be after request creation
      AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at)::date
      -- Attribution window (MIG_860 rules)
      AND (
        -- Within 6 months of request creation
        a.appointment_date <= (COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months')::date
        -- OR request is still active
        OR r.resolved_at IS NULL
        -- OR appointment was while request was active
        OR a.appointment_date <= r.resolved_at::date
      )
    ORDER BY a.appointment_id,
      -- Prefer active requests
      CASE WHEN r.resolved_at IS NULL THEN 0 ELSE 1 END,
      -- Then most recent
      COALESCE(r.source_created_at, r.created_at) DESC
  ),
  updated AS (
    UPDATE trapper.sot_appointments a
    SET request_id = br.request_id
    FROM best_request br
    WHERE a.appointment_id = br.appointment_id
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_linked FROM updated;

  RETURN QUERY SELECT v_linked;
END;
$$;

COMMENT ON FUNCTION trapper.link_appointments_to_requests() IS
'MIG_886: Links appointments to requests via place_id + attribution window.
Same window logic as link_cats_to_requests_safe() (MIG_860).
Picks best request: active first, then most recent.';

-- ============================================================================
-- Phase 4: Update link_appointments_to_trappers() with request chain
-- ============================================================================

\echo ''
\echo 'Phase 4: Updating link_appointments_to_trappers() with request chain...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_to_trappers()
RETURNS TABLE(
    appointments_linked INT,
    trappers_found INT
) AS $$
DECLARE
    v_appointments_linked INT := 0;
    v_trappers_found INT := 0;
    v_pass1 INT := 0;
    v_pass2 INT := 0;
BEGIN
    -- Pass 1 (NEW MIG_886): Link via request chain
    -- appointment.request_id → request_trapper_assignments → trapper_person_id
    WITH matched_via_request AS (
        SELECT DISTINCT ON (a.appointment_id)
            a.appointment_id,
            rta.trapper_person_id
        FROM trapper.sot_appointments a
        JOIN trapper.request_trapper_assignments rta ON rta.request_id = a.request_id
        WHERE a.trapper_person_id IS NULL
          AND a.request_id IS NOT NULL
          AND rta.unassigned_at IS NULL  -- Only active assignments
        ORDER BY a.appointment_id,
          CASE WHEN rta.is_primary THEN 0 ELSE 1 END,  -- Prefer primary trapper
          rta.assigned_at ASC  -- Then earliest assigned
    ),
    updated_pass1 AS (
        UPDATE trapper.sot_appointments a
        SET trapper_person_id = mvr.trapper_person_id
        FROM matched_via_request mvr
        WHERE a.appointment_id = mvr.appointment_id
        RETURNING a.appointment_id, a.trapper_person_id
    )
    SELECT COUNT(DISTINCT appointment_id), COUNT(DISTINCT trapper_person_id)
    INTO v_pass1, v_trappers_found
    FROM updated_pass1;

    RAISE NOTICE 'Pass 1 (request chain): linked % appointments to % trappers', v_pass1, v_trappers_found;

    -- Pass 2 (EXISTING): Link via email/phone matching
    -- Falls back to the original approach for appointments without request_id
    WITH matched_trappers AS (
        SELECT DISTINCT
            a.appointment_id,
            pi.person_id AS trapper_id
        FROM trapper.sot_appointments a
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND a.owner_email IS NOT NULL
             AND pi.id_value_norm = LOWER(TRIM(a.owner_email)))
            OR
            (pi.id_type = 'phone' AND a.owner_phone IS NOT NULL
             AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(a.owner_phone, '[^0-9]', '', 'g'), 10))
        )
        JOIN trapper.person_roles pr ON pr.person_id = pi.person_id
            AND pr.role = 'trapper'
        WHERE a.trapper_person_id IS NULL
    ),
    updated_pass2 AS (
        UPDATE trapper.sot_appointments a
        SET trapper_person_id = mt.trapper_id
        FROM matched_trappers mt
        WHERE a.appointment_id = mt.appointment_id
        RETURNING a.appointment_id, a.trapper_person_id
    )
    SELECT COUNT(DISTINCT appointment_id) INTO v_pass2 FROM updated_pass2;

    RAISE NOTICE 'Pass 2 (email/phone): linked % additional appointments', v_pass2;

    v_appointments_linked := v_pass1 + v_pass2;

    RETURN QUERY SELECT v_appointments_linked, v_trappers_found;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_to_trappers() IS
'MIG_886: Two-pass trapper linking. Pass 1: request chain (appointment.request_id → '
'request_trapper_assignments → trapper_person_id). Pass 2: email/phone fallback (MIG_272).';

-- ============================================================================
-- Phase 5: Update run_all_entity_linking() — add Step 5.5
-- ============================================================================

\echo ''
\echo 'Phase 5: Adding link_appointments_to_requests() to pipeline...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Step 1: Link appointments to owners (creates people + person_id on appointments)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_updated FROM trapper.link_appointments_to_owners()), 0);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Cat-place linking (cats → places via microchip + owner chain from staged_records)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT cats_linked FROM trapper.run_cat_place_linking()), 0);
    operation := 'run_cat_place_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_cat_place_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Appointment trapper linking (now two-pass: request chain + email/phone)
  BEGIN
    SELECT INTO v_count COALESCE(trapper.run_appointment_trapper_linking(), 0);
    operation := 'run_appointment_trapper_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_appointment_trapper_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link appointments to partner orgs
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_linked FROM trapper.link_all_appointments_to_partner_orgs()), 0);
    operation := 'link_all_appointments_to_partner_orgs'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_all_appointments_to_partner_orgs (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 5: Link cats to requests via attribution windows
  BEGIN
    SELECT INTO v_count COALESCE((SELECT linked FROM trapper.link_cats_to_requests_safe()), 0);
    operation := 'link_cats_to_requests_safe'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_requests_safe (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 5.5 (NEW MIG_886): Link appointments to requests via place + attribution window
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_linked FROM trapper.link_appointments_to_requests()), 0);
    operation := 'link_appointments_to_requests'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_requests (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: Infer appointment places from person→place relationships
  BEGIN
    WITH inferred AS (
      UPDATE trapper.sot_appointments a
      SET place_id = ppr.place_id
      FROM trapper.person_place_relationships ppr
      WHERE a.person_id = ppr.person_id
        AND a.place_id IS NULL
        AND ppr.place_id IS NOT NULL
      RETURNING a.appointment_id
    )
    SELECT INTO v_count COUNT(*) FROM inferred;
    operation := 'infer_appointment_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7: Create person-cat relationships from linked appointments
  BEGIN
    WITH missing_rels AS (
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      )
      SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
        'clinichq', 'appointments'
      FROM trapper.sot_appointments a
      WHERE a.person_id IS NOT NULL
        AND a.cat_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
        )
      ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
      RETURNING person_id
    )
    SELECT INTO v_count COUNT(*) FROM missing_rels;
    operation := 'create_person_cat_relationships'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'create_person_cat_relationships (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 8: Propagate person_cat + person_place → cat_place (MIG_870, updated MIG_884)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT total_edges FROM trapper.link_cats_to_places()), 0);
    operation := 'link_cats_to_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
  'MIG_886: Orchestrates all entity linking steps with fault tolerance. '
  'Step 5.5 (NEW): link_appointments_to_requests() via place + attribution window. '
  'Step 3 updated: link_appointments_to_trappers() now uses request chain (Pass 1) + email/phone (Pass 2). '
  'Step 8: link_cats_to_places() propagates person_cat + person_place → cat_place.';

-- ============================================================================
-- Phase 6: Backfill — link existing appointments to requests and trappers
-- ============================================================================

\echo ''
\echo 'Phase 6: Backfilling...'

\echo '  Step 1: Linking appointments to requests...'
SELECT * FROM trapper.link_appointments_to_requests();

\echo '  Step 2: Re-running trapper linking with request chain...'
SELECT * FROM trapper.link_appointments_to_trappers();

-- ============================================================================
-- Phase 7: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT
  COUNT(*) AS total_appointments,
  COUNT(request_id) AS has_request,
  COUNT(trapper_person_id) AS has_trapper,
  ROUND(100.0 * COUNT(request_id) / NULLIF(COUNT(*), 0), 1) AS pct_request_linked,
  ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) AS pct_trapper_linked
FROM trapper.sot_appointments;

\echo ''
\echo '=== MIG_886 Complete ==='
\echo 'Added request_id to sot_appointments.'
\echo 'link_appointments_to_requests() uses place + attribution window.'
\echo 'link_appointments_to_trappers() now two-pass: request chain + email/phone.'
\echo 'Pipeline step 5.5 added to run_all_entity_linking().'
