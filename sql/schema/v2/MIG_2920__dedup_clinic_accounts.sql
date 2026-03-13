-- MIG_2920__dedup_clinic_accounts.sql
-- FFS-483: Deduplicate 7,294 duplicate clinic_accounts (39% of all accounts)
--
-- Root cause: upsert_clinic_account_for_owner() bulk migration path (no source_record_id)
-- used ON CONFLICT DO NOTHING, but only PK (auto-generated UUID) was unique → never conflicts.
-- Created one account per appointment instead of one per unique owner.
--
-- This migration:
--   1. Identifies duplicate groups by (name, email, phone, account_type)
--   2. Picks winner (highest appointment_count, earliest created_at)
--   3. Consolidates appointment_count into winner
--   4. Repoints ops.appointments.owner_account_id from losers → winner
--   5. Archives losers to archive.duplicate_clinic_accounts
--   6. Sets merged_into_account_id on losers
--   7. Fixes doubled display_names (owner_first_name = owner_last_name)
--   8. Adds unique partial index to prevent recurrence
--   9. Fixes upsert function fallback path
--  10. Fixes search_unified() to use LATERAL join (1 alias per place)

\echo ''
\echo '=============================================='
\echo '  MIG_2920: Deduplicate Clinic Accounts'
\echo '  FFS-483: 7,294 duplicates (39%)'
\echo '=============================================='

BEGIN;

-- ============================================================================
-- STEP 0: BEFORE COUNTS
-- ============================================================================

\echo ''
\echo '0. Before counts:'

SELECT COUNT(*) as total_active_accounts
FROM ops.clinic_accounts WHERE merged_into_account_id IS NULL;

SELECT account_type, COUNT(*) as cnt
FROM ops.clinic_accounts WHERE merged_into_account_id IS NULL
GROUP BY account_type ORDER BY cnt DESC;

-- ============================================================================
-- STEP 1: IDENTIFY WINNERS AND LOSERS
-- ============================================================================

\echo ''
\echo '1. Identifying duplicate groups and picking winners...'

CREATE TEMP TABLE dedup_plan AS
WITH ranked AS (
  SELECT
    account_id,
    LOWER(COALESCE(owner_first_name, '')) as norm_fn,
    LOWER(COALESCE(owner_last_name, '')) as norm_ln,
    LOWER(COALESCE(owner_email, '')) as norm_email,
    LOWER(COALESCE(owner_phone, '')) as norm_phone,
    account_type,
    appointment_count,
    created_at,
    -- Pick winner: highest appointment_count, then earliest created_at
    ROW_NUMBER() OVER (
      PARTITION BY
        LOWER(COALESCE(owner_first_name, '')),
        LOWER(COALESCE(owner_last_name, '')),
        LOWER(COALESCE(owner_email, '')),
        LOWER(COALESCE(owner_phone, '')),
        account_type
      ORDER BY appointment_count DESC NULLS LAST, created_at ASC
    ) as rn,
    -- Total appointments in group (to consolidate into winner)
    SUM(COALESCE(appointment_count, 0)) OVER (
      PARTITION BY
        LOWER(COALESCE(owner_first_name, '')),
        LOWER(COALESCE(owner_last_name, '')),
        LOWER(COALESCE(owner_email, '')),
        LOWER(COALESCE(owner_phone, '')),
        account_type
    ) as group_total_appts,
    -- Group size
    COUNT(*) OVER (
      PARTITION BY
        LOWER(COALESCE(owner_first_name, '')),
        LOWER(COALESCE(owner_last_name, '')),
        LOWER(COALESCE(owner_email, '')),
        LOWER(COALESCE(owner_phone, '')),
        account_type
    ) as group_size,
    -- Winner account_id for this group
    FIRST_VALUE(account_id) OVER (
      PARTITION BY
        LOWER(COALESCE(owner_first_name, '')),
        LOWER(COALESCE(owner_last_name, '')),
        LOWER(COALESCE(owner_email, '')),
        LOWER(COALESCE(owner_phone, '')),
        account_type
      ORDER BY appointment_count DESC NULLS LAST, created_at ASC
    ) as winner_id
  FROM ops.clinic_accounts
  WHERE merged_into_account_id IS NULL
)
SELECT account_id, rn, group_size, group_total_appts, winner_id
FROM ranked
WHERE group_size > 1;

\echo '   Duplicate plan created:'
SELECT
  COUNT(*) FILTER (WHERE rn = 1) as winners,
  COUNT(*) FILTER (WHERE rn > 1) as losers,
  COUNT(*) as total_in_dupe_groups
FROM dedup_plan;

-- ============================================================================
-- STEP 2: CONSOLIDATE APPOINTMENT COUNTS INTO WINNERS
-- ============================================================================

\echo ''
\echo '2. Consolidating appointment_count into winners...'

UPDATE ops.clinic_accounts ca
SET appointment_count = dp.group_total_appts,
    updated_at = NOW()
FROM dedup_plan dp
WHERE ca.account_id = dp.account_id
  AND dp.rn = 1
  AND ca.appointment_count IS DISTINCT FROM dp.group_total_appts;

\echo '   Winners updated: ' || (SELECT COUNT(*) FROM dedup_plan WHERE rn = 1);

-- ============================================================================
-- STEP 3: CONSOLIDATE resolved_person_id AND resolved_place_id INTO WINNERS
-- ============================================================================

\echo ''
\echo '3. Consolidating resolved IDs into winners (fill NULLs from losers)...'

-- If winner has no resolved_person_id but a loser does, copy it
UPDATE ops.clinic_accounts winner
SET resolved_person_id = (
  SELECT ca2.resolved_person_id
  FROM ops.clinic_accounts ca2
  JOIN dedup_plan dp2 ON dp2.account_id = ca2.account_id
  WHERE dp2.winner_id = winner.account_id
    AND dp2.rn > 1
    AND ca2.resolved_person_id IS NOT NULL
  LIMIT 1
),
updated_at = NOW()
FROM dedup_plan dp
WHERE winner.account_id = dp.account_id
  AND dp.rn = 1
  AND winner.resolved_person_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ops.clinic_accounts ca2
    JOIN dedup_plan dp2 ON dp2.account_id = ca2.account_id
    WHERE dp2.winner_id = winner.account_id AND dp2.rn > 1 AND ca2.resolved_person_id IS NOT NULL
  );

-- Same for resolved_place_id
UPDATE ops.clinic_accounts winner
SET resolved_place_id = (
  SELECT ca2.resolved_place_id
  FROM ops.clinic_accounts ca2
  JOIN dedup_plan dp2 ON dp2.account_id = ca2.account_id
  WHERE dp2.winner_id = winner.account_id
    AND dp2.rn > 1
    AND ca2.resolved_place_id IS NOT NULL
  LIMIT 1
),
updated_at = NOW()
FROM dedup_plan dp
WHERE winner.account_id = dp.account_id
  AND dp.rn = 1
  AND winner.resolved_place_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ops.clinic_accounts ca2
    JOIN dedup_plan dp2 ON dp2.account_id = ca2.account_id
    WHERE dp2.winner_id = winner.account_id AND dp2.rn > 1 AND ca2.resolved_place_id IS NOT NULL
  );

-- ============================================================================
-- STEP 4: REPOINT APPOINTMENTS FROM LOSERS TO WINNERS
-- ============================================================================

\echo ''
\echo '4. Repointing ops.appointments.owner_account_id...'

UPDATE ops.appointments a
SET owner_account_id = dp.winner_id,
    updated_at = NOW()
FROM dedup_plan dp
WHERE a.owner_account_id = dp.account_id
  AND dp.rn > 1;

\echo '   Appointments repointed:';
SELECT COUNT(*) FROM ops.appointments a
JOIN dedup_plan dp ON a.owner_account_id = dp.winner_id
WHERE dp.rn = 1;

-- ============================================================================
-- STEP 5: REPOINT HOUSEHOLDS FROM LOSERS TO WINNERS
-- ============================================================================

\echo ''
\echo '5. Repointing sot.households.primary_account_id...'

UPDATE sot.households h
SET primary_account_id = dp.winner_id
FROM dedup_plan dp
WHERE h.primary_account_id = dp.account_id
  AND dp.rn > 1;

-- ============================================================================
-- STEP 6: ARCHIVE LOSERS
-- ============================================================================

\echo ''
\echo '6. Archiving loser accounts...'

INSERT INTO archive.duplicate_clinic_accounts
  (account_id, display_name, email, phone, archived_at, archive_reason, kept_account_id, original_created_at)
SELECT
  ca.account_id,
  ca.display_name,
  ca.owner_email,
  ca.owner_phone,
  NOW(),
  'FFS-483: bulk migration dedup (MIG_2920). Group of ' || dp.group_size || ' accounts.',
  dp.winner_id,
  ca.created_at
FROM ops.clinic_accounts ca
JOIN dedup_plan dp ON dp.account_id = ca.account_id
WHERE dp.rn > 1;

\echo '   Archived:';
SELECT COUNT(*) FROM archive.duplicate_clinic_accounts WHERE archive_reason LIKE 'FFS-483%';

-- ============================================================================
-- STEP 7: MARK LOSERS AS MERGED
-- ============================================================================

\echo ''
\echo '7. Setting merged_into_account_id on losers...'

UPDATE ops.clinic_accounts ca
SET merged_into_account_id = dp.winner_id,
    updated_at = NOW()
FROM dedup_plan dp
WHERE ca.account_id = dp.account_id
  AND dp.rn > 1;

\echo '   Merged:';
SELECT COUNT(*) FROM ops.clinic_accounts WHERE merged_into_account_id IS NOT NULL;

-- ============================================================================
-- STEP 8: FIX DOUBLED DISPLAY NAMES
-- ============================================================================

\echo ''
\echo '8. Fixing doubled display_names (owner_first_name = owner_last_name)...'

-- For address/site_name accounts where first = last, NULL out last_name
-- The generated display_name column will then show just the first_name
UPDATE ops.clinic_accounts
SET owner_last_name = NULL,
    updated_at = NOW()
WHERE merged_into_account_id IS NULL
  AND owner_first_name = owner_last_name
  AND owner_first_name IS NOT NULL
  AND account_type IN ('address', 'site_name', 'organization', 'unknown');

\echo '   Fixed doubled names:';
SELECT COUNT(*)
FROM ops.clinic_accounts
WHERE merged_into_account_id IS NULL
  AND owner_first_name = owner_last_name
  AND owner_first_name IS NOT NULL;

DROP TABLE dedup_plan;

-- ============================================================================
-- STEP 9: ADD UNIQUE PARTIAL INDEX TO PREVENT RECURRENCE
-- ============================================================================

\echo ''
\echo '9. Adding unique partial index for no-source-id accounts...'

-- This is the constraint that was missing.
-- For accounts WITHOUT source_record_id, dedup by (name, email, phone, type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_accounts_dedup_no_source
ON ops.clinic_accounts (
  LOWER(COALESCE(owner_first_name, '')),
  LOWER(COALESCE(owner_last_name, '')),
  LOWER(COALESCE(owner_email, '')),
  LOWER(COALESCE(owner_phone, '')),
  account_type
)
WHERE merged_into_account_id IS NULL
  AND (source_record_id IS NULL OR source_record_id = '');

\echo '   Index created';

-- ============================================================================
-- STEP 10: FIX UPSERT FUNCTION — NO-SOURCE-ID PATH
-- ============================================================================

\echo ''
\echo '10. Fixing upsert_clinic_account_for_owner() fallback path...'

CREATE OR REPLACE FUNCTION ops.upsert_clinic_account_for_owner(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_resolved_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_account_id UUID;
  v_classification TEXT;
  v_account_type TEXT;
  v_place_id UUID;
  v_display_name TEXT;
BEGIN
  -- Build display name for potential place extraction
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  -- Classify the owner name
  v_classification := sot.classify_owner_name(p_first_name, p_last_name);

  -- FFS-483: For non-person accounts where first_name = last_name (doubled address/site names),
  -- NULL out last_name to prevent "Old Stony Point Rd Old Stony Point Rd" display names
  -- and to match the unique index (which stores NULL last_name for cleaned records)
  IF p_first_name IS NOT NULL AND p_first_name = p_last_name
     AND v_classification NOT IN ('likely_person') THEN
    p_last_name := NULL;
  END IF;

  -- Map classification to account_type (with NULL safety)
  v_account_type := CASE COALESCE(v_classification, 'unknown')
    WHEN 'address' THEN 'address'
    WHEN 'organization' THEN 'organization'
    WHEN 'known_org' THEN 'organization'
    WHEN 'apartment_complex' THEN 'site_name'
    WHEN 'site_name' THEN 'site_name'
    WHEN 'likely_person' THEN 'resident'
    ELSE 'unknown'
  END;

  -- ATOMIC UPSERT using INSERT ON CONFLICT
  -- Primary dedup key: source_record_id (if available)
  IF p_source_record_id IS NOT NULL THEN
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, resolved_person_id, source_system, source_record_id,
      first_appointment_date, last_appointment_date, appointment_count
    ) VALUES (
      p_first_name, p_last_name, p_email, p_phone, p_address,
      v_account_type, p_resolved_person_id, 'clinichq', p_source_record_id,
      CURRENT_DATE, CURRENT_DATE, 1
    )
    ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
    DO UPDATE SET
      appointment_count = COALESCE(ops.clinic_accounts.appointment_count, 0) + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      resolved_person_id = COALESCE(ops.clinic_accounts.resolved_person_id, EXCLUDED.resolved_person_id),
      updated_at = NOW()
    RETURNING account_id INTO v_account_id;
  ELSE
    -- FFS-483 FIX: Use the new partial unique index for dedup
    -- idx_clinic_accounts_dedup_no_source on (lower(first), lower(last), lower(email), lower(phone), type)
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, resolved_person_id, source_system,
      first_appointment_date, last_appointment_date, appointment_count
    ) VALUES (
      p_first_name, p_last_name, p_email, p_phone, p_address,
      v_account_type, p_resolved_person_id, 'clinichq',
      CURRENT_DATE, CURRENT_DATE, 1
    )
    ON CONFLICT (
      LOWER(COALESCE(owner_first_name, '')),
      LOWER(COALESCE(owner_last_name, '')),
      LOWER(COALESCE(owner_email, '')),
      LOWER(COALESCE(owner_phone, '')),
      account_type
    ) WHERE merged_into_account_id IS NULL AND (source_record_id IS NULL OR source_record_id = '')
    DO UPDATE SET
      appointment_count = COALESCE(ops.clinic_accounts.appointment_count, 0) + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      resolved_person_id = COALESCE(ops.clinic_accounts.resolved_person_id, EXCLUDED.resolved_person_id),
      updated_at = NOW()
    RETURNING account_id INTO v_account_id;
  END IF;

  -- =========================================================================
  -- DATA_GAP_054 FIX: Extract place for address-type accounts
  -- =========================================================================
  IF v_account_id IS NOT NULL AND v_account_type = 'address' THEN
    -- Check if account already has a resolved_place_id
    IF NOT EXISTS (
      SELECT 1 FROM ops.clinic_accounts
      WHERE account_id = v_account_id AND resolved_place_id IS NOT NULL
    ) THEN
      -- Try to find or create a place from the address-like name
      -- First try: Use the owner_address if it's more complete
      IF p_address IS NOT NULL AND LENGTH(TRIM(p_address)) > 10 THEN
        v_place_id := sot.find_or_create_place_deduped(
          p_formatted_address := TRIM(p_address),
          p_source_system := 'clinichq'
        );
      END IF;

      -- Fallback: Use the display_name (address-as-name)
      IF v_place_id IS NULL AND LENGTH(v_display_name) > 5 THEN
        v_place_id := sot.find_or_create_place_deduped(
          p_formatted_address := v_display_name,
          p_source_system := 'clinichq'
        );
      END IF;

      -- Link account to place
      IF v_place_id IS NOT NULL THEN
        UPDATE ops.clinic_accounts
        SET resolved_place_id = v_place_id,
            updated_at = NOW()
        WHERE account_id = v_account_id;
      END IF;
    END IF;
  END IF;

  RETURN v_account_id;
END;
$function$;

\echo '   Function updated';

-- ============================================================================
-- STEP 11: FIX search_unified() — LATERAL JOIN FOR ALIASES
-- ============================================================================

\echo ''
\echo '11. Fixing search_unified() to use LATERAL join (1 alias per place)...'

CREATE OR REPLACE FUNCTION sot.search_unified(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    match_reason TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_expanded TEXT := sot.expand_abbreviations(p_query);
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_expanded_pattern TEXT := '%' || v_query_expanded || '%';
    v_tokens TEXT[];
    v_intent TEXT := sot.detect_query_intent(p_query);
    v_intent_boost INT := 0;
BEGIN
    v_intent_boost := CASE v_intent WHEN 'unknown' THEN 0 ELSE 15 END;
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    RETURN QUERY
    WITH ranked_results AS (
        -- ========== CATS ==========
        SELECT
            'cat'::TEXT AS entity_type,
            c.cat_id::TEXT AS entity_id,
            c.name AS display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM sot.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 100
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (
                    SELECT bool_and(LOWER(c.name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(c.name, p_query) >= 0.5 THEN 60 + (similarity(c.name, p_query) * 30)::INT
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END
            + CASE WHEN v_intent = 'cat' THEN v_intent_boost ELSE 0 END
            AS score,
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'exact_microchip'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'prefix_microchip'
                WHEN similarity(c.name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 'contains_identifier'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'has_place', EXISTS (SELECT 1 FROM sot.cat_place cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT pcr.person_id)
                                FROM sot.person_cat pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM sot.cats c
        WHERE c.merged_into_cat_id IS NULL
          AND COALESCE(c.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.name) LIKE v_query_pattern
              OR similarity(c.name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM sot.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern
                         OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            COALESCE(
                (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.role_status = 'active' LIMIT 1),
                (SELECT 'Cats: ' || COUNT(*)::TEXT
                 FROM sot.person_cat pcr
                 WHERE pcr.person_id = p.person_id)
            ) AS subtitle,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 95
                WHEN (
                    SELECT bool_and(LOWER(p.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 40
                ELSE 0
            END
            + CASE WHEN v_intent = 'person' THEN v_intent_boost ELSE 0 END
            AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM sot.person_cat pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL
            ) AS metadata
        FROM sot.people p
        WHERE p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
          )

        UNION ALL

        -- ========== PLACES (with LATERAL clinic account alias — max 1 per place) ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            -- If matched via alias, show it in subtitle
            CASE
                WHEN ca.display_name IS NOT NULL
                     AND (LOWER(ca.display_name) LIKE v_query_pattern
                          OR LOWER(ca.display_name) LIKE v_expanded_pattern
                          OR similarity(ca.display_name, p_query) >= 0.3)
                THEN 'Also known as: ' || ca.display_name || ' - ' || COALESCE(sa.city, '')
                ELSE COALESCE(pl.place_kind::TEXT, 'place') || ' - ' || COALESCE(sa.city, '')
            END AS subtitle,
            -- Score: MAX of place score OR alias score
            GREATEST(
                -- Place name/address scoring
                CASE
                    WHEN LOWER(pl.display_name) = v_query_lower THEN 100
                    WHEN LOWER(pl.formatted_address) = v_query_lower THEN 99
                    WHEN LOWER(pl.display_name) = v_query_expanded THEN 98
                    WHEN LOWER(pl.formatted_address) = v_query_expanded THEN 97
                    WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 95
                    WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 92
                    WHEN (
                        SELECT bool_and(
                            LOWER(COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '')) LIKE '%' || token || '%'
                        )
                        FROM unnest(v_tokens) AS token
                        WHERE LENGTH(token) >= 2
                    ) THEN 75
                    WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                    WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 55 + (similarity(pl.formatted_address, p_query) * 30)::INT
                    WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 50
                    WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 40
                    WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 35
                    WHEN LOWER(sa.city) LIKE v_query_pattern THEN 30
                    ELSE 0
                END,
                -- Clinic account alias scoring
                CASE
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_lower
                        THEN 100 + LEAST(COALESCE(ca.appointment_count, 0), 20)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_expanded
                        THEN 98 + LEAST(COALESCE(ca.appointment_count, 0), 18)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_prefix
                        THEN 95 + LEAST(COALESCE(ca.appointment_count, 0), 15)
                    WHEN ca.display_name IS NOT NULL AND similarity(ca.display_name, p_query) >= 0.5
                        THEN 60 + (similarity(ca.display_name, p_query) * 30)::INT + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_pattern
                        THEN 40 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_expanded_pattern
                        THEN 45 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    ELSE 0
                END
            )
            + CASE WHEN v_intent = 'place' THEN v_intent_boost ELSE 0 END
            AS score,
            -- Match reason
            CASE
                WHEN ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) = v_query_lower
                    OR LOWER(ca.display_name) = v_query_expanded
                    OR LOWER(ca.display_name) LIKE v_query_prefix
                    OR LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ) THEN 'alias_match'
                WHEN LOWER(pl.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 'exact_address'
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 'expanded_address'
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 'contains_address'
                WHEN LOWER(sa.city) LIKE v_query_pattern THEN 'contains_locality'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'locality', sa.city,
                'postal_code', sa.postal_code,
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cpr WHERE cpr.place_id = pl.place_id),
                'person_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.place_id = pl.place_id),
                'is_address_backed', pl.is_address_backed,
                'alias_matched', ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ),
                'alias_name', ca.display_name,
                'alias_appointment_count', ca.appointment_count
            ) AS metadata
        FROM sot.places pl
        LEFT JOIN sot.addresses sa ON sa.address_id = pl.sot_address_id
        -- FFS-483 FIX: Use LATERAL join to pick AT MOST 1 best-matching alias per place
        LEFT JOIN LATERAL (
            SELECT ca_inner.display_name, ca_inner.appointment_count
            FROM ops.clinic_accounts ca_inner
            WHERE ca_inner.resolved_place_id = pl.place_id
              AND ca_inner.merged_into_account_id IS NULL
              AND ca_inner.account_type IN ('site_name', 'address')
              AND (
                  LOWER(ca_inner.display_name) LIKE v_query_pattern
                  OR LOWER(ca_inner.display_name) LIKE v_expanded_pattern
                  OR similarity(ca_inner.display_name, p_query) >= 0.3
              )
            ORDER BY
              CASE
                WHEN LOWER(ca_inner.display_name) = v_query_lower THEN 1
                WHEN LOWER(ca_inner.display_name) = v_query_expanded THEN 2
                WHEN LOWER(ca_inner.display_name) LIKE v_query_prefix THEN 3
                WHEN LOWER(ca_inner.display_name) LIKE v_query_pattern THEN 4
                WHEN LOWER(ca_inner.display_name) LIKE v_expanded_pattern THEN 5
                ELSE 6
              END,
              ca_inner.appointment_count DESC NULLS LAST
            LIMIT 1
        ) ca ON TRUE
        WHERE pl.merged_into_place_id IS NULL
          AND COALESCE(pl.quality_tier, 'good') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              -- Match on place fields
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.city) LIKE v_query_pattern
              OR similarity(pl.display_name, p_query) >= 0.3
              OR similarity(pl.formatted_address, p_query) >= 0.3
              -- Match on expanded query
              OR LOWER(pl.formatted_address) LIKE v_expanded_pattern
              -- Match on alias (lateral subquery already filtered)
              OR ca.display_name IS NOT NULL
          )
    )
    SELECT
        r.entity_type,
        r.entity_id,
        r.display_name,
        r.subtitle,
        CASE
            WHEN r.score >= 90 THEN 'strong'
            WHEN r.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        r.match_reason,
        r.score::NUMERIC,
        r.metadata
    FROM ranked_results r
    WHERE r.score > 0
    ORDER BY r.score DESC, r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

\echo '   search_unified() updated with LATERAL join';

-- ============================================================================
-- STEP 12: VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2920 Verification'
\echo '=============================================='

\echo ''
\echo '12.1 After counts:'
SELECT COUNT(*) as total_active_accounts
FROM ops.clinic_accounts WHERE merged_into_account_id IS NULL;

SELECT account_type, COUNT(*) as cnt
FROM ops.clinic_accounts WHERE merged_into_account_id IS NULL
GROUP BY account_type ORDER BY cnt DESC;

\echo ''
\echo '12.2 Archive count:'
SELECT COUNT(*) as archived FROM archive.duplicate_clinic_accounts;

\echo ''
\echo '12.3 Search "old stony" — should have NO duplicate entity_ids:'
SELECT entity_type, entity_id, display_name, score, match_reason
FROM sot.search_suggestions('old stony', 10);

\echo ''
\echo '12.4 Remaining doubled display_names (should be 0 for address/site_name):'
SELECT COUNT(*)
FROM ops.clinic_accounts
WHERE merged_into_account_id IS NULL
  AND owner_first_name = owner_last_name
  AND owner_first_name IS NOT NULL
  AND account_type IN ('address', 'site_name');

\echo ''
\echo '12.5 Unique index exists:'
SELECT indexname FROM pg_indexes
WHERE tablename = 'clinic_accounts' AND indexname = 'idx_clinic_accounts_dedup_no_source';

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_2920 Complete'
\echo '=============================================='
\echo ''
\echo 'Summary:'
\echo '  - Deduplicated ~7,294 duplicate clinic_accounts'
\echo '  - Consolidated appointment_count into winners'
\echo '  - Repointed appointments and households'
\echo '  - Archived losers to archive.duplicate_clinic_accounts'
\echo '  - Fixed doubled display_names'
\echo '  - Added unique partial index (idx_clinic_accounts_dedup_no_source)'
\echo '  - Fixed upsert_clinic_account_for_owner() fallback path'
\echo '  - Fixed search_unified() LATERAL join (1 alias per place)'
\echo ''
