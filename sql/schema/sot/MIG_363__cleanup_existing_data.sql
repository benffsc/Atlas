\echo '=== MIG_363: Cleanup Existing Duplicate Data ==='
\echo 'Fixes doubled names, backfills identifiers, and merges duplicates'
\echo ''

-- ============================================================================
-- This migration cleans up the data pollution caused by the identifier bug:
-- - 26,132 people with only 8,795 unique names
-- - 14,931 people (57%) without identifiers
-- - 1,289 doubled names
-- ============================================================================

-- ============================================================================
-- STEP 1: Fix doubled display names
-- ============================================================================

\echo 'Step 1: Fixing doubled display names...'

-- Show count before
SELECT COUNT(*) as doubled_names_before
FROM trapper.sot_people
WHERE display_name ~ '^(.+) \1$'
  AND merged_into_person_id IS NULL;

-- Fix them
UPDATE trapper.sot_people
SET display_name = regexp_replace(display_name, '^(.+) \1$', '\1'),
    updated_at = NOW()
WHERE display_name ~ '^(.+) \1$'
  AND merged_into_person_id IS NULL;

\echo 'Fixed doubled display names'

-- ============================================================================
-- STEP 2: Backfill missing email identifiers
-- ============================================================================

\echo ''
\echo 'Step 2: Backfilling missing email identifiers...'

-- Show count before
SELECT COUNT(*) as people_missing_email_identifier
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi
    ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.primary_email IS NOT NULL
  AND p.primary_email != ''
  AND pi.person_id IS NULL
  AND p.merged_into_person_id IS NULL;

-- Backfill missing email identifiers
WITH missing_emails AS (
    SELECT
        p.person_id,
        p.primary_email as email_norm,
        COALESCE(p.data_source::text, 'unknown') as source_system
    FROM trapper.sot_people p
    LEFT JOIN trapper.person_identifiers pi
        ON pi.person_id = p.person_id AND pi.id_type = 'email'
    WHERE p.primary_email IS NOT NULL
      AND p.primary_email != ''
      AND pi.person_id IS NULL
      AND p.merged_into_person_id IS NULL
)
INSERT INTO trapper.person_identifiers (
    person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
)
SELECT
    person_id,
    'email',
    email_norm,
    email_norm,
    source_system,
    0.9  -- Slightly lower confidence since backfilled
FROM missing_emails
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

\echo 'Backfilled email identifiers'

-- ============================================================================
-- STEP 3: Backfill missing phone identifiers
-- ============================================================================

\echo ''
\echo 'Step 3: Backfilling missing phone identifiers...'

-- Show count before
SELECT COUNT(*) as people_missing_phone_identifier
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi
    ON pi.person_id = p.person_id AND pi.id_type = 'phone'
WHERE p.primary_phone IS NOT NULL
  AND p.primary_phone != ''
  AND pi.person_id IS NULL
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist bl
      WHERE bl.phone_norm = p.primary_phone
  );

-- Backfill missing phone identifiers (skip blacklisted)
WITH missing_phones AS (
    SELECT
        p.person_id,
        p.primary_phone as phone_norm,
        COALESCE(p.data_source::text, 'unknown') as source_system
    FROM trapper.sot_people p
    LEFT JOIN trapper.person_identifiers pi
        ON pi.person_id = p.person_id AND pi.id_type = 'phone'
    WHERE p.primary_phone IS NOT NULL
      AND p.primary_phone != ''
      AND pi.person_id IS NULL
      AND p.merged_into_person_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.identity_phone_blacklist bl
          WHERE bl.phone_norm = p.primary_phone
      )
)
INSERT INTO trapper.person_identifiers (
    person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
)
SELECT
    person_id,
    'phone',
    phone_norm,
    phone_norm,
    source_system,
    0.9
FROM missing_phones
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

\echo 'Backfilled phone identifiers'

-- ============================================================================
-- STEP 4: Create merge candidates view
-- ============================================================================

\echo ''
\echo 'Step 4: Creating duplicate merge candidates view...'

DROP VIEW IF EXISTS trapper.v_duplicate_merge_candidates;

CREATE VIEW trapper.v_duplicate_merge_candidates AS
WITH identifier_owners AS (
    -- Find the canonical owner of each identifier (person with most appointments)
    SELECT DISTINCT ON (pi.id_type, pi.id_value_norm)
        pi.id_type,
        pi.id_value_norm,
        pi.person_id as canonical_person_id,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = pi.person_id) as appointment_count
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE p.merged_into_person_id IS NULL
    ORDER BY pi.id_type, pi.id_value_norm,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = pi.person_id) DESC,
        pi.created_at ASC
),
duplicates AS (
    SELECT
        p.person_id as duplicate_person_id,
        p.display_name as duplicate_name,
        io.canonical_person_id,
        cp.display_name as canonical_name,
        io.id_type,
        io.id_value_norm,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as dup_appointments,
        io.appointment_count as can_appointments,
        -- Calculate similarity for prioritization
        CASE
            WHEN LOWER(p.display_name) = LOWER(cp.display_name) THEN 1.0
            WHEN p.display_name ILIKE '%' || cp.display_name || '%' OR cp.display_name ILIKE '%' || p.display_name || '%' THEN 0.8
            ELSE trapper.name_similarity(p.display_name, cp.display_name)
        END as name_similarity
    FROM trapper.sot_people p
    CROSS JOIN LATERAL (
        SELECT io.canonical_person_id, io.id_type, io.id_value_norm, io.appointment_count
        FROM identifier_owners io
        WHERE (p.primary_email IS NOT NULL AND io.id_type = 'email' AND io.id_value_norm = p.primary_email)
           OR (p.primary_phone IS NOT NULL AND io.id_type = 'phone' AND io.id_value_norm = p.primary_phone)
        LIMIT 1
    ) io
    JOIN trapper.sot_people cp ON cp.person_id = io.canonical_person_id
    WHERE p.person_id != io.canonical_person_id
      AND p.merged_into_person_id IS NULL
      AND cp.merged_into_person_id IS NULL
)
SELECT
    duplicate_person_id,
    duplicate_name,
    canonical_person_id,
    canonical_name,
    id_type || ': ' || id_value_norm as matching_identifier,
    dup_appointments,
    can_appointments,
    name_similarity,
    CASE
        WHEN name_similarity >= 0.95 THEN 'safe_auto_merge'
        WHEN name_similarity >= 0.7 THEN 'likely_match'
        ELSE 'needs_review'
    END as merge_confidence
FROM duplicates
ORDER BY name_similarity DESC, can_appointments DESC;

COMMENT ON VIEW trapper.v_duplicate_merge_candidates IS
'Shows duplicate people that should be merged into canonical records.
Priority: exact name matches first, then by appointment count.
safe_auto_merge: name_similarity >= 0.95 (safe to auto-merge)
likely_match: 0.7-0.95 (probably same person)
needs_review: < 0.7 (might be household members)';

\echo 'Created v_duplicate_merge_candidates view'

-- Show stats
SELECT merge_confidence, COUNT(*) as count
FROM trapper.v_duplicate_merge_candidates
GROUP BY merge_confidence
ORDER BY merge_confidence;

-- ============================================================================
-- STEP 5: Auto-merge safe duplicates (exact name matches)
-- ============================================================================

\echo ''
\echo 'Step 5: Auto-merging safe duplicates (exact name matches)...'

DO $$
DECLARE
    v_merged_count INT := 0;
    v_error_count INT := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT duplicate_person_id, canonical_person_id, duplicate_name, matching_identifier
        FROM trapper.v_duplicate_merge_candidates
        WHERE merge_confidence = 'safe_auto_merge'
        ORDER BY name_similarity DESC
        LIMIT 1000  -- Process in batches
    LOOP
        BEGIN
            -- Double-check neither is merged
            IF EXISTS (
                SELECT 1 FROM trapper.sot_people
                WHERE person_id = v_rec.duplicate_person_id
                AND merged_into_person_id IS NULL
            ) AND EXISTS (
                SELECT 1 FROM trapper.sot_people
                WHERE person_id = v_rec.canonical_person_id
                AND merged_into_person_id IS NULL
            ) THEN
                PERFORM trapper.merge_people(
                    v_rec.duplicate_person_id,
                    v_rec.canonical_person_id,
                    'MIG_363: Auto-merged - exact name match on ' || v_rec.matching_identifier
                );
                v_merged_count := v_merged_count + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            RAISE NOTICE 'Error merging % into %: %',
                v_rec.duplicate_person_id, v_rec.canonical_person_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Merged % duplicates with % errors', v_merged_count, v_error_count;
END $$;

\echo 'Completed auto-merge of safe duplicates'

-- ============================================================================
-- STEP 6: Flag business entities
-- ============================================================================

\echo ''
\echo 'Step 6: Flagging business names...'

-- Add entity_type column if missing
ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'person';

-- Show count of detected businesses
SELECT COUNT(*) as detected_businesses
FROM trapper.sot_people
WHERE trapper.is_business_name(display_name)
  AND entity_type = 'person'
  AND merged_into_person_id IS NULL;

-- Flag businesses
UPDATE trapper.sot_people
SET entity_type = 'organization',
    updated_at = NOW()
WHERE trapper.is_business_name(display_name)
  AND entity_type = 'person'
  AND merged_into_person_id IS NULL;

\echo 'Flagged business names as entity_type = organization'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT
    'Total active people' as metric,
    COUNT(*)::text as value
FROM trapper.sot_people WHERE merged_into_person_id IS NULL
UNION ALL
SELECT 'Unique display_names', COUNT(DISTINCT display_name)::text
FROM trapper.sot_people WHERE merged_into_person_id IS NULL
UNION ALL
SELECT 'Duplication ratio', ROUND(
    COUNT(*)::numeric / NULLIF(COUNT(DISTINCT display_name), 0), 2
)::text
FROM trapper.sot_people WHERE merged_into_person_id IS NULL
UNION ALL
SELECT 'Doubled names remaining', COUNT(*)::text
FROM trapper.sot_people
WHERE display_name ~ '^(.+) \1$' AND merged_into_person_id IS NULL
UNION ALL
SELECT 'People without identifiers', COUNT(*)::text
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE pi.person_id IS NULL AND p.merged_into_person_id IS NULL
UNION ALL
SELECT 'Organizations flagged', COUNT(*)::text
FROM trapper.sot_people WHERE entity_type = 'organization' AND merged_into_person_id IS NULL
UNION ALL
SELECT 'Remaining merge candidates', COUNT(*)::text
FROM trapper.v_duplicate_merge_candidates;

\echo ''
\echo '=== MIG_363 Complete ==='
\echo 'Cleanup performed:'
\echo '  1. Fixed doubled display names'
\echo '  2. Backfilled missing email identifiers'
\echo '  3. Backfilled missing phone identifiers'
\echo '  4. Created v_duplicate_merge_candidates view'
\echo '  5. Auto-merged safe duplicates (exact name matches)'
\echo '  6. Flagged business names as entity_type = organization'
\echo ''
\echo 'To continue merging remaining candidates:'
\echo '  SELECT * FROM trapper.v_duplicate_merge_candidates WHERE merge_confidence = ''likely_match'' LIMIT 50;'
\echo '  -- Review and approve, then:'
\echo '  SELECT trapper.merge_people(duplicate_person_id, canonical_person_id, ''manual merge'');'
\echo ''
