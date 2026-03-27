-- ============================================================================
-- MIG_3002: Auto-Resolution Expansion (Phase 1B — Long-Term Strategy)
-- ============================================================================
-- Problem: Staff manually reviews dedup candidates that could be auto-resolved.
-- Many patterns have clear resolution logic that doesn't need human judgment.
--
-- Solution: Functions for:
--   1. Auto-blacklist identifiers appearing on 5+ people (org phones)
--   2. Mark stale relationships (no evidence in 2+ years)
--   3. Enhanced auto-merge with safety-gated patterns
--
-- FFS-898, FFS-899, FFS-902
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_3002: Auto-Resolution Expansion'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Auto-blacklist shared identifiers (FFS-898)
-- ============================================================================

\echo '1. Creating ops.auto_blacklist_shared_identifiers() function...'

CREATE OR REPLACE FUNCTION ops.auto_blacklist_shared_identifiers(
  p_threshold INT DEFAULT 5,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  identifier_type TEXT,
  identifier_norm TEXT,
  person_count BIGINT,
  action TEXT
) AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      pi.id_type,
      pi.id_value_norm,
      COUNT(DISTINCT pi.person_id) AS person_count
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL
    WHERE pi.confidence >= 0.5
      AND NOT EXISTS (
        SELECT 1 FROM sot.soft_blacklist sb
        WHERE sb.identifier_type = pi.id_type
          AND sb.identifier_norm = pi.id_value_norm
      )
    GROUP BY pi.id_type, pi.id_value_norm
    HAVING COUNT(DISTINCT pi.person_id) >= p_threshold
    ORDER BY COUNT(DISTINCT pi.person_id) DESC
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO sot.soft_blacklist (
        id, identifier_type, identifier_norm, reason,
        require_name_similarity, auto_detected, created_by
      ) VALUES (
        gen_random_uuid(),
        v_rec.id_type,
        v_rec.id_value_norm,
        'auto_blacklist: shared by ' || v_rec.person_count || ' people',
        1.0,  -- Effectively blocks all matches
        TRUE,
        'auto_resolution_cron'
      )
      ON CONFLICT (identifier_type, identifier_norm) DO NOTHING;
    END IF;

    RETURN QUERY SELECT
      v_rec.id_type,
      v_rec.id_value_norm,
      v_rec.person_count,
      CASE WHEN p_dry_run THEN 'would_blacklist' ELSE 'blacklisted' END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.auto_blacklist_shared_identifiers IS
'Auto-blacklist identifiers (email/phone) shared by 5+ people.
These are org phones, shared family phones, etc. that cause false merges.
Run with p_dry_run=TRUE to preview before applying. FFS-898.';

\echo '   Created ops.auto_blacklist_shared_identifiers()'

-- ============================================================================
-- 2. Mark stale relationships (FFS-899)
-- ============================================================================

\echo ''
\echo '2. Adding is_stale flag to relationship tables...'

-- Add is_stale to cat_place (most impactful)
ALTER TABLE sot.cat_place
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sot.cat_place
ADD COLUMN IF NOT EXISTS stale_marked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cat_place_stale
  ON sot.cat_place(is_stale)
  WHERE is_stale = TRUE;

-- Add is_stale to person_place
ALTER TABLE sot.person_place
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sot.person_place
ADD COLUMN IF NOT EXISTS stale_marked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_person_place_stale
  ON sot.person_place(is_stale)
  WHERE is_stale = TRUE;

\echo '   Added is_stale columns to cat_place and person_place'

\echo ''
\echo '3. Creating ops.mark_stale_relationships() function...'

CREATE OR REPLACE FUNCTION ops.mark_stale_relationships(
  p_stale_years INT DEFAULT 2,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_stale_cat_place INT := 0;
  v_stale_person_place INT := 0;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := NOW() - (p_stale_years || ' years')::INTERVAL;

  IF NOT p_dry_run THEN
    -- Mark cat_place relationships with no recent appointment evidence
    WITH stale_cats AS (
      SELECT cp.cat_id, cp.place_id
      FROM sot.cat_place cp
      WHERE cp.is_stale = FALSE
        AND cp.evidence_type = 'automated'
        AND NOT EXISTS (
          SELECT 1 FROM ops.appointments a
          JOIN sot.cat_identifiers ci ON ci.id_value = a.microchip
          WHERE ci.cat_id = cp.cat_id
            AND a.inferred_place_id = cp.place_id
            AND a.appointment_date > v_cutoff
        )
        AND cp.created_at < v_cutoff
    )
    UPDATE sot.cat_place cp SET
      is_stale = TRUE,
      stale_marked_at = NOW()
    FROM stale_cats sc
    WHERE cp.cat_id = sc.cat_id
      AND cp.place_id = sc.place_id;

    GET DIAGNOSTICS v_stale_cat_place = ROW_COUNT;

    -- Mark person_place relationships with no recent evidence
    WITH stale_persons AS (
      SELECT pp.person_id, pp.place_id
      FROM sot.person_place pp
      WHERE pp.is_stale = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM ops.appointments a
          WHERE a.person_id = pp.person_id
            AND a.inferred_place_id = pp.place_id
            AND a.appointment_date > v_cutoff
        )
        AND NOT EXISTS (
          SELECT 1 FROM ops.requests r
          WHERE r.person_id = pp.person_id
            AND r.place_id = pp.place_id
            AND r.created_at > v_cutoff
        )
        AND pp.created_at < v_cutoff
    )
    UPDATE sot.person_place pp SET
      is_stale = TRUE,
      stale_marked_at = NOW()
    FROM stale_persons sp
    WHERE pp.person_id = sp.person_id
      AND pp.place_id = sp.place_id;

    GET DIAGNOSTICS v_stale_person_place = ROW_COUNT;
  ELSE
    -- Dry run: just count
    SELECT COUNT(*) INTO v_stale_cat_place
    FROM sot.cat_place cp
    WHERE cp.is_stale = FALSE
      AND cp.evidence_type = 'automated'
      AND NOT EXISTS (
        SELECT 1 FROM ops.appointments a
        JOIN sot.cat_identifiers ci ON ci.id_value = a.microchip
        WHERE ci.cat_id = cp.cat_id
          AND a.inferred_place_id = cp.place_id
          AND a.appointment_date > v_cutoff
      )
      AND cp.created_at < v_cutoff;

    SELECT COUNT(*) INTO v_stale_person_place
    FROM sot.person_place pp
    WHERE pp.is_stale = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM ops.appointments a
        WHERE a.person_id = pp.person_id
          AND a.inferred_place_id = pp.place_id
          AND a.appointment_date > v_cutoff
      )
      AND NOT EXISTS (
        SELECT 1 FROM ops.requests r
        WHERE r.person_id = pp.person_id
          AND r.place_id = pp.place_id
          AND r.created_at > v_cutoff
      )
      AND pp.created_at < v_cutoff;
  END IF;

  RETURN jsonb_build_object(
    'stale_cat_place', v_stale_cat_place,
    'stale_person_place', v_stale_person_place,
    'cutoff_date', v_cutoff,
    'dry_run', p_dry_run
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.mark_stale_relationships IS
'Mark relationships with no evidence in 2+ years as stale.
Stale relationships are excluded from entity linking but preserved for audit.
Run with p_dry_run=TRUE to preview counts. FFS-899.';

\echo '   Created ops.mark_stale_relationships()'

-- ============================================================================
-- 4. Enhanced auto-merge patterns
-- ============================================================================

\echo ''
\echo '4. Creating ops.find_auto_mergeable_people() function...'

CREATE OR REPLACE FUNCTION ops.find_auto_mergeable_people(p_limit INT DEFAULT 50)
RETURNS TABLE (
  loser_id UUID,
  winner_id UUID,
  pattern TEXT,
  confidence NUMERIC,
  evidence JSONB
) AS $$
BEGIN
  -- Pattern 1: Same phone + high name similarity + same address
  -- Triple confirmation — safe to auto-merge
  RETURN QUERY
  WITH phone_pairs AS (
    SELECT
      pi1.person_id AS p1_id,
      pi2.person_id AS p2_id,
      pi1.id_value_norm AS phone,
      p1.display_name AS name1,
      p2.display_name AS name2,
      similarity(LOWER(p1.display_name), LOWER(p2.display_name)) AS name_sim
    FROM sot.person_identifiers pi1
    JOIN sot.person_identifiers pi2
      ON pi1.id_type = 'phone'
      AND pi2.id_type = 'phone'
      AND pi1.id_value_norm = pi2.id_value_norm
      AND pi1.person_id < pi2.person_id
      AND pi1.confidence >= 0.5
      AND pi2.confidence >= 0.5
    JOIN sot.people p1 ON p1.person_id = pi1.person_id
      AND p1.merged_into_person_id IS NULL
    JOIN sot.people p2 ON p2.person_id = pi2.person_id
      AND p2.merged_into_person_id IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist sb
      WHERE sb.identifier_type = 'phone'
        AND sb.identifier_norm = pi1.id_value_norm
    )
  ),
  with_address_check AS (
    SELECT
      pp.*,
      EXISTS (
        SELECT 1
        FROM sot.person_place pp1
        JOIN sot.person_place pp2
          ON pp1.place_id = pp2.place_id
        WHERE pp1.person_id = pp.p1_id
          AND pp2.person_id = pp.p2_id
          AND pp1.is_stale = FALSE
          AND pp2.is_stale = FALSE
      ) AS same_address
    FROM phone_pairs pp
    WHERE pp.name_sim >= 0.85
  )
  SELECT
    -- Loser = fewer relationships (preserve the more-connected record)
    CASE WHEN (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = wac.p1_id
    ) < (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = wac.p2_id
    ) THEN wac.p1_id ELSE wac.p2_id END,
    CASE WHEN (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = wac.p1_id
    ) < (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = wac.p2_id
    ) THEN wac.p2_id ELSE wac.p1_id END,
    'same_phone_high_name_sim_same_address'::TEXT,
    0.95::NUMERIC,
    jsonb_build_object(
      'phone', wac.phone,
      'name1', wac.name1,
      'name2', wac.name2,
      'name_similarity', ROUND(wac.name_sim, 3),
      'same_address', wac.same_address
    )
  FROM with_address_check wac
  WHERE wac.same_address = TRUE
  LIMIT p_limit;

  -- Pattern 2: Same email + different name + same address
  -- Household booking pattern — safe to merge with logging
  RETURN QUERY
  WITH email_pairs AS (
    SELECT
      pi1.person_id AS p1_id,
      pi2.person_id AS p2_id,
      pi1.id_value_norm AS email,
      p1.display_name AS name1,
      p2.display_name AS name2,
      similarity(LOWER(p1.display_name), LOWER(p2.display_name)) AS name_sim
    FROM sot.person_identifiers pi1
    JOIN sot.person_identifiers pi2
      ON pi1.id_type = 'email'
      AND pi2.id_type = 'email'
      AND pi1.id_value_norm = pi2.id_value_norm
      AND pi1.person_id < pi2.person_id
      AND pi1.confidence >= 0.5
      AND pi2.confidence >= 0.5
    JOIN sot.people p1 ON p1.person_id = pi1.person_id
      AND p1.merged_into_person_id IS NULL
    JOIN sot.people p2 ON p2.person_id = pi2.person_id
      AND p2.merged_into_person_id IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist sb
      WHERE sb.identifier_type = 'email'
        AND sb.identifier_norm = pi1.id_value_norm
    )
  )
  SELECT
    CASE WHEN (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = ep.p1_id
    ) < (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = ep.p2_id
    ) THEN ep.p1_id ELSE ep.p2_id END,
    CASE WHEN (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = ep.p1_id
    ) < (
      SELECT COUNT(*) FROM sot.person_identifiers WHERE person_id = ep.p2_id
    ) THEN ep.p2_id ELSE ep.p1_id END,
    'same_email_same_address_household'::TEXT,
    0.90::NUMERIC,
    jsonb_build_object(
      'email', ep.email,
      'name1', ep.name1,
      'name2', ep.name2,
      'name_similarity', ROUND(ep.name_sim, 3)
    )
  FROM email_pairs ep
  WHERE ep.name_sim < 0.85  -- Different names (household members)
    AND EXISTS (
      SELECT 1
      FROM sot.person_place pp1
      JOIN sot.person_place pp2
        ON pp1.place_id = pp2.place_id
      WHERE pp1.person_id = ep.p1_id
        AND pp2.person_id = ep.p2_id
        AND pp1.is_stale = FALSE
        AND pp2.is_stale = FALSE
    )
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.find_auto_mergeable_people IS
'Find people that can be safely auto-merged based on high-confidence patterns.
Pattern 1: Same phone + name sim >= 0.85 + same address (triple confirmation).
Pattern 2: Same email + different name + same address (household booking).
Both patterns respect soft blacklist. FFS-902.';

\echo '   Created ops.find_auto_mergeable_people()'

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo ''
\echo '5. Verifying...'

SELECT p.proname, pg_get_function_arguments(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'ops'
  AND p.proname IN (
    'auto_blacklist_shared_identifiers',
    'mark_stale_relationships',
    'find_auto_mergeable_people'
  )
ORDER BY p.proname;

\echo ''
\echo '================================================'
\echo '  MIG_3002 Complete (FFS-898, FFS-899, FFS-902)'
\echo '================================================'
\echo ''
\echo 'Created:'
\echo '  - ops.auto_blacklist_shared_identifiers() — auto-blacklist 5+ shared identifiers'
\echo '  - ops.mark_stale_relationships() — mark 2+ year stale relationships'
\echo '  - ops.find_auto_mergeable_people() — high-confidence merge patterns'
\echo '  - is_stale columns on sot.cat_place and sot.person_place'
\echo ''
