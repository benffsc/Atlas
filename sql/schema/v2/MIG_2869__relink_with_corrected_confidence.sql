-- ============================================================================
-- MIG_2869: Re-link Entities with Corrected Confidence Ranking
-- ============================================================================
-- MIG_2860 fixed the string comparison bug where 'high' < 'low' alphabetically,
-- but existing links may have wrong confidence levels. This migration:
-- 1. Snapshots current confidence distribution
-- 2. Deletes all automated links (preserves manual)
-- 3. Re-runs entity linking pipeline to rebuild with correct ranking
-- 4. Reports before/after distributions
--
-- FFS-313
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2869: Re-link with Corrected Confidence'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Snapshot before state
-- ============================================================================

\echo '1. Before state — cat_place confidence distribution:'

SELECT confidence, COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM sot.cat_place
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

\echo ''
\echo '   Before state — person_cat confidence distribution:'

SELECT confidence, COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM sot.person_cat
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

-- ============================================================================
-- 2. Delete automated links (preserve manual/verified)
-- ============================================================================

\echo ''
\echo '2. Deleting automated cat_place links...'

DO $$
DECLARE
  v_cat_place_deleted INT;
  v_person_cat_deleted INT;
BEGIN
  DELETE FROM sot.cat_place
  WHERE evidence_type != 'manual'
    AND evidence_type != 'verified';
  GET DIAGNOSTICS v_cat_place_deleted = ROW_COUNT;

  DELETE FROM sot.person_cat
  WHERE evidence_type != 'manual'
    AND evidence_type != 'verified';
  GET DIAGNOSTICS v_person_cat_deleted = ROW_COUNT;

  RAISE NOTICE 'Deleted % cat_place and % person_cat automated links',
    v_cat_place_deleted, v_person_cat_deleted;
END;
$$;

-- ============================================================================
-- 3. Re-run full entity linking pipeline
-- ============================================================================

\echo ''
\echo '3. Re-running entity linking pipeline with corrected confidence...'

SELECT jsonb_pretty(sot.run_all_entity_linking());

-- ============================================================================
-- 4. After state
-- ============================================================================

\echo ''
\echo '4. After state — cat_place confidence distribution:'

SELECT confidence, COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM sot.cat_place
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

\echo ''
\echo '   After state — person_cat confidence distribution:'

SELECT confidence, COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM sot.person_cat
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

-- ============================================================================
-- 5. Health check
-- ============================================================================

\echo ''
\echo '5. Health check after re-link:'

SELECT * FROM ops.check_entity_linking_health();

\echo ''
\echo '================================================'
\echo '  MIG_2869 Complete (FFS-313)'
\echo '================================================'
\echo ''
