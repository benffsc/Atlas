\echo ''
\echo '=============================================='
\echo 'MIG_802: Safe Batch Person Merges'
\echo '=============================================='
\echo ''
\echo 'Auto-merges tier 1 (email) and tier 2 (phone+name) pairs.'
\echo 'Queues tiers 3-5 for manual staff review.'
\echo 'Uses person_safe_to_merge() guard + merge_people() from MIG_260.'

-- ============================================================================
-- STEP 1: Dry-run report — show what WILL be merged
-- ============================================================================

\echo ''
\echo '── Step 1: Dry-run counts ──'
\echo ''

\echo 'Current duplicate summary (before merges):'
SELECT * FROM trapper.v_person_dedup_summary;

\echo ''
\echo 'Tier 1 (email) candidates to auto-merge:'
SELECT COUNT(*) AS tier1_pairs FROM trapper.v_person_dedup_candidates WHERE match_tier = 1;

\echo ''
\echo 'Tier 2 (phone+name) candidates to auto-merge:'
SELECT COUNT(*) AS tier2_pairs FROM trapper.v_person_dedup_candidates WHERE match_tier = 2;

\echo ''
\echo 'Tiers 3-5 (to queue for manual review):'
SELECT COUNT(*) AS review_pairs FROM trapper.v_person_dedup_candidates WHERE match_tier >= 3;

\echo ''
\echo 'Sample tier 1 pairs (first 10):'
SELECT
  canonical_name,
  duplicate_name,
  shared_email,
  ROUND(name_similarity::numeric, 2) AS name_sim
FROM trapper.v_person_dedup_candidates
WHERE match_tier = 1
LIMIT 10;

-- ============================================================================
-- STEP 2: Execute safe auto-merges
-- ============================================================================

\echo ''
\echo '── Step 2: Executing auto-merges ──'

DO $$
DECLARE
  v_pair RECORD;
  v_result JSONB;
  v_safety TEXT;
  v_tier1_merged INT := 0;
  v_tier1_skipped INT := 0;
  v_tier1_errors INT := 0;
  v_tier2_merged INT := 0;
  v_tier2_skipped INT := 0;
  v_tier2_errors INT := 0;
BEGIN
  -- ── Pass 1: Materialize tier 1 candidates, then merge ──
  CREATE TEMP TABLE _tier1_candidates AS
  SELECT canonical_person_id, duplicate_person_id, shared_email
  FROM trapper.v_person_dedup_candidates
  WHERE match_tier = 1;

  RAISE NOTICE 'Pass 1: Found % tier 1 (email) pairs', (SELECT COUNT(*) FROM _tier1_candidates);

  FOR v_pair IN SELECT * FROM _tier1_candidates LOOP
    BEGIN
      v_safety := trapper.person_safe_to_merge(
        v_pair.canonical_person_id,
        v_pair.duplicate_person_id
      );

      IF v_safety = 'safe' THEN
        v_result := trapper.merge_people(
          v_pair.duplicate_person_id,   -- source (gets absorbed)
          v_pair.canonical_person_id,   -- target (survives)
          'MIG_802_email_dedup',
          'MIG_802'
        );
        v_tier1_merged := v_tier1_merged + 1;
      ELSE
        v_tier1_skipped := v_tier1_skipped + 1;
        RAISE NOTICE 'Skipped tier 1 merge (safety=%): % → %',
          v_safety, v_pair.duplicate_person_id, v_pair.canonical_person_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_tier1_errors := v_tier1_errors + 1;
      RAISE WARNING 'Error in tier 1 merge (% → %): %',
        v_pair.duplicate_person_id, v_pair.canonical_person_id, SQLERRM;
    END;
  END LOOP;

  DROP TABLE _tier1_candidates;

  RAISE NOTICE '';
  RAISE NOTICE 'Pass 1 complete: merged=%, skipped=%, errors=%',
    v_tier1_merged, v_tier1_skipped, v_tier1_errors;

  -- ── Pass 2: Materialize tier 2 candidates, then merge ──
  CREATE TEMP TABLE _tier2_candidates AS
  SELECT canonical_person_id, duplicate_person_id, shared_phone
  FROM trapper.v_person_dedup_candidates
  WHERE match_tier = 2;

  RAISE NOTICE '';
  RAISE NOTICE 'Pass 2: Found % tier 2 (phone+name) pairs', (SELECT COUNT(*) FROM _tier2_candidates);

  FOR v_pair IN SELECT * FROM _tier2_candidates LOOP
    BEGIN
      v_safety := trapper.person_safe_to_merge(
        v_pair.canonical_person_id,
        v_pair.duplicate_person_id
      );

      IF v_safety = 'safe' THEN
        v_result := trapper.merge_people(
          v_pair.duplicate_person_id,
          v_pair.canonical_person_id,
          'MIG_802_phone_name_dedup',
          'MIG_802'
        );
        v_tier2_merged := v_tier2_merged + 1;
      ELSE
        v_tier2_skipped := v_tier2_skipped + 1;
        RAISE NOTICE 'Skipped tier 2 merge (safety=%): % → %',
          v_safety, v_pair.duplicate_person_id, v_pair.canonical_person_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_tier2_errors := v_tier2_errors + 1;
      RAISE WARNING 'Error in tier 2 merge (% → %): %',
        v_pair.duplicate_person_id, v_pair.canonical_person_id, SQLERRM;
    END;
  END LOOP;

  DROP TABLE _tier2_candidates;

  RAISE NOTICE '';
  RAISE NOTICE 'Pass 2 complete: merged=%, skipped=%, errors=%',
    v_tier2_merged, v_tier2_skipped, v_tier2_errors;
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE 'TOTAL AUTO-MERGED: %', v_tier1_merged + v_tier2_merged;
  RAISE NOTICE '═══════════════════════════════════════';
END;
$$;

-- ============================================================================
-- STEP 3: Queue tiers 3-5 for manual review
-- ============================================================================

\echo ''
\echo '── Step 3: Queuing remaining pairs for manual review ──'

INSERT INTO trapper.potential_person_duplicates (
  person_id,
  potential_match_id,
  match_type,
  matched_identifier,
  new_name,
  existing_name,
  name_similarity,
  status
)
SELECT
  c.duplicate_person_id,
  c.canonical_person_id,
  CASE c.match_tier
    WHEN 3 THEN 'phone_different_name'
    WHEN 4 THEN 'name_shared_place'
    WHEN 5 THEN 'name_only'
  END,
  COALESCE(c.shared_phone, c.canonical_name),
  c.duplicate_name,
  c.canonical_name,
  c.name_similarity,
  'pending'
FROM trapper.v_person_dedup_candidates c
WHERE c.match_tier IN (3, 4, 5)
ON CONFLICT (person_id, potential_match_id) DO NOTHING;

\echo 'Queued pairs for review:'
SELECT
  match_type,
  COUNT(*) AS count
FROM trapper.potential_person_duplicates
WHERE status = 'pending'
GROUP BY match_type
ORDER BY match_type;

-- ============================================================================
-- STEP 4: Final verification
-- ============================================================================

\echo ''
\echo '── Verification ──'
\echo ''

\echo 'Post-merge duplicate summary:'
SELECT * FROM trapper.v_person_dedup_summary;

\echo ''
\echo 'Active vs merged people:'
SELECT
  COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) AS active_people,
  COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) AS merged_people,
  COUNT(*) FILTER (WHERE merge_reason = 'MIG_802_email_dedup') AS merged_by_email,
  COUNT(*) FILTER (WHERE merge_reason = 'MIG_802_phone_name_dedup') AS merged_by_phone_name
FROM trapper.sot_people;

\echo ''
\echo 'Pending review queue:'
SELECT
  status,
  COUNT(*) AS count
FROM trapper.potential_person_duplicates
GROUP BY status
ORDER BY status;

\echo ''
\echo '=============================================='
\echo 'MIG_802 Complete!'
\echo '=============================================='
\echo ''
\echo 'Results:'
\echo '  - Pass 1: Auto-merged tier 1 (email) pairs'
\echo '  - Pass 2: Auto-merged tier 2 (phone+name) pairs'
\echo '  - Pass 3: Queued tiers 3-5 for manual review'
\echo ''
\echo 'Next: Review remaining candidates at /admin/person-dedup'
