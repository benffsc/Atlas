-- MIG_3027: Proxy Identifier Detection
--
-- Problem: Susan Simons' phone books for 30 different people at different addresses.
-- The system handles this case-by-case (name guard, address guard) but never recognizes
-- the pattern: this phone IS a proxy. The system treats trapper phones identically to
-- personal phones.
--
-- Solution:
--   1. Add is_proxy column to person_identifiers
--   2. Create ops.detect_proxy_identifiers() with 4 detection rules
--   3. Config keys for thresholds
--   4. One-time detection run
--
-- FFS-103x: Identifier Confidence & Proxy Detection (Issue 3)
-- Dependencies: MIG_3025 (source_systems), MIG_3026 (compute_identifier_confidence)
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3027: Proxy Identifier Detection'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SCHEMA CHANGES
-- ============================================================================

\echo '1. Adding is_proxy column to sot.person_identifiers...'

ALTER TABLE sot.person_identifiers
  ADD COLUMN IF NOT EXISTS is_proxy BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN sot.person_identifiers.is_proxy IS
'TRUE if this identifier is used as a proxy (e.g. trapper phone booking for others).
Proxy identifiers get a 0.5x confidence multiplier via compute_identifier_confidence().
Detected by ops.detect_proxy_identifiers() and used by data_engine Phase 0.5 to skip
auto-matching on proxy phones.
MIG_3027.';

CREATE INDEX IF NOT EXISTS idx_person_identifiers_proxy
  ON sot.person_identifiers (is_proxy)
  WHERE is_proxy = TRUE;

\echo '   is_proxy column + index added'

-- ============================================================================
-- 2. CONFIG KEYS
-- ============================================================================

\echo ''
\echo '2. Adding proxy detection config keys...'

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('identity.proxy_name_cardinality_threshold', '5',
   'Flag identifier as proxy when same phone/email appears on 5+ distinct names in clinic_accounts',
   'identity'),
  ('identity.proxy_place_cardinality_threshold', '5',
   'Flag identifier as proxy when person has appointments at 5+ distinct places',
   'identity')
ON CONFLICT (key) DO NOTHING;

\echo '   Config keys added'

-- ============================================================================
-- 3. CREATE ops.detect_proxy_identifiers()
-- ============================================================================

\echo ''
\echo '3. Creating ops.detect_proxy_identifiers()...'

CREATE OR REPLACE FUNCTION ops.detect_proxy_identifiers(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
  person_id UUID,
  display_name TEXT,
  id_type TEXT,
  id_value_norm TEXT,
  detection_rule TEXT,
  evidence JSONB,
  action TEXT
) AS $$
DECLARE
  v_name_threshold INT;
  v_place_threshold INT;
  v_flagged_count INT := 0;
BEGIN
  v_name_threshold := ops.get_config_numeric('identity.proxy_name_cardinality_threshold', 5)::INT;
  v_place_threshold := ops.get_config_numeric('identity.proxy_place_cardinality_threshold', 5)::INT;

  -- Collect all proxy candidates into a temp table
  CREATE TEMP TABLE IF NOT EXISTS _proxy_candidates (
    person_id UUID,
    display_name TEXT,
    id_type TEXT,
    id_value_norm TEXT,
    detection_rule TEXT,
    evidence JSONB
  ) ON COMMIT DROP;
  TRUNCATE _proxy_candidates;

  -- -----------------------------------------------------------------------
  -- Rule 1: Known trappers (person has active trapper_profiles, not colony_caretaker)
  -- Signal: Trapper's own identifiers are likely used as proxies when booking
  -- -----------------------------------------------------------------------
  INSERT INTO _proxy_candidates
  SELECT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm,
         'trapper_profile',
         jsonb_build_object('trapper_type', tp.trapper_type, 'is_active', tp.is_active)
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  JOIN sot.trapper_profiles tp ON tp.person_id = pi.person_id
  WHERE NOT COALESCE(pi.is_proxy, FALSE)
    AND tp.is_active = TRUE
    AND tp.trapper_type NOT IN ('colony_caretaker')
    AND pi.confidence >= 0.5
    AND pi.id_type IN ('phone', 'email');

  -- -----------------------------------------------------------------------
  -- Rule 2: High-volume booker role from clinic_accounts
  -- Signal: Account classified as community_trapper or organization
  -- Note: Uses account_type since booking_role column not yet deployed (MIG_3001)
  -- -----------------------------------------------------------------------
  INSERT INTO _proxy_candidates
  SELECT DISTINCT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm,
         'account_type',
         jsonb_build_object('account_type', ca.account_type, 'account_name', ca.owner_first_name || ' ' || ca.owner_last_name)
  FROM ops.clinic_accounts ca
  JOIN sot.person_identifiers pi ON pi.person_id = ca.resolved_person_id
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  WHERE ca.account_type IN ('community_trapper', 'organization')
    AND NOT COALESCE(pi.is_proxy, FALSE)
    AND pi.confidence >= 0.5
    AND pi.id_type IN ('phone', 'email')
    AND ca.merged_into_account_id IS NULL;

  -- -----------------------------------------------------------------------
  -- Rule 3: Cross-name cardinality (same phone used by N+ distinct names)
  -- Signal: If 5 different people's appointments use the same phone, it's a proxy
  -- -----------------------------------------------------------------------
  INSERT INTO _proxy_candidates
  SELECT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm,
         'cross_name_cardinality',
         jsonb_build_object(
           'name_count', sub.name_count,
           'names', sub.names
         )
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  JOIN (
    SELECT ca.owner_phone AS identifier_norm,
           COUNT(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) AS name_count,
           array_agg(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))
             ORDER BY LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) AS names
    FROM ops.clinic_accounts ca
    WHERE ca.owner_phone IS NOT NULL AND TRIM(ca.owner_phone) != ''
      AND ca.merged_into_account_id IS NULL
    GROUP BY ca.owner_phone
    HAVING COUNT(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) >= v_name_threshold
  ) sub ON sub.identifier_norm = pi.id_value_norm
  WHERE pi.id_type = 'phone'
    AND NOT COALESCE(pi.is_proxy, FALSE)
    AND pi.confidence >= 0.5;

  -- Also check email cross-name cardinality
  INSERT INTO _proxy_candidates
  SELECT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm,
         'cross_name_cardinality',
         jsonb_build_object(
           'name_count', sub.name_count,
           'names', sub.names
         )
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  JOIN (
    SELECT ca.owner_email AS identifier_norm,
           COUNT(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) AS name_count,
           array_agg(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))
             ORDER BY LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) AS names
    FROM ops.clinic_accounts ca
    WHERE ca.owner_email IS NOT NULL AND TRIM(ca.owner_email) != ''
      AND ca.merged_into_account_id IS NULL
    GROUP BY ca.owner_email
    HAVING COUNT(DISTINCT LOWER(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')))) >= v_name_threshold
  ) sub ON sub.identifier_norm = pi.id_value_norm
  WHERE pi.id_type = 'email'
    AND NOT COALESCE(pi.is_proxy, FALSE)
    AND pi.confidence >= 0.5;

  -- -----------------------------------------------------------------------
  -- Rule 4: Cross-address cardinality (person has appointments at N+ distinct places)
  -- Signal: Normal residents don't have appointments at 5+ different addresses
  -- -----------------------------------------------------------------------
  INSERT INTO _proxy_candidates
  SELECT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm,
         'cross_address_cardinality',
         jsonb_build_object('distinct_place_count', sub.place_count)
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  JOIN (
    SELECT a.person_id,
           COUNT(DISTINCT a.inferred_place_id) AS place_count
    FROM ops.appointments a
    WHERE a.inferred_place_id IS NOT NULL
      AND a.person_id IS NOT NULL
    GROUP BY a.person_id
    HAVING COUNT(DISTINCT a.inferred_place_id) >= v_place_threshold
  ) sub ON sub.person_id = pi.person_id
  WHERE NOT COALESCE(pi.is_proxy, FALSE)
    AND pi.confidence >= 0.5
    AND pi.id_type IN ('phone', 'email');

  -- -----------------------------------------------------------------------
  -- Apply flags + recompute confidence (if not dry run)
  -- -----------------------------------------------------------------------
  IF NOT p_dry_run THEN
    WITH to_flag AS (
      SELECT DISTINCT pc.person_id, pc.id_type, pc.id_value_norm
      FROM _proxy_candidates pc
    )
    UPDATE sot.person_identifiers pi
    SET is_proxy = TRUE,
        -- Recompute confidence with proxy multiplier
        confidence = sot.compute_identifier_confidence(
          COALESCE(pi.source_systems, ARRAY[COALESCE(pi.source_system, 'unknown')]),
          COALESCE(pi.confirmation_count, 1),
          TRUE  -- is_proxy = TRUE
        )
    FROM to_flag tf
    WHERE pi.person_id = tf.person_id
      AND pi.id_type = tf.id_type
      AND pi.id_value_norm = tf.id_value_norm;

    GET DIAGNOSTICS v_flagged_count = ROW_COUNT;
    RAISE NOTICE 'Flagged % identifiers as proxy', v_flagged_count;
  END IF;

  -- Return results
  RETURN QUERY
  SELECT pc.person_id, pc.display_name, pc.id_type, pc.id_value_norm,
         pc.detection_rule, pc.evidence,
         CASE WHEN p_dry_run THEN 'would_flag' ELSE 'flagged' END
  FROM _proxy_candidates pc
  ORDER BY pc.display_name, pc.id_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_proxy_identifiers IS
'Detects and flags proxy identifiers (trapper phones, high-volume booker emails).
4 detection rules:
  1. trapper_profile: Active trapper (not colony_caretaker) in sot.trapper_profiles
  2. booking_role: clinic_accounts.booking_role IN (community_trapper, ffsc_staff)
  3. cross_name_cardinality: Same phone/email on 5+ distinct names in clinic_accounts
  4. cross_address_cardinality: Person has appointments at 5+ distinct places
When flagged, confidence is recomputed with 0.5x proxy multiplier.
Configurable thresholds: identity.proxy_name_cardinality_threshold, identity.proxy_place_cardinality_threshold.
MIG_3027.';

\echo '   ops.detect_proxy_identifiers() created'

-- ============================================================================
-- 3b. UPDATE confirm_identifier() to read is_proxy (column now exists)
-- ============================================================================

\echo ''
\echo '3b. Updating confirm_identifier() to read is_proxy column...'

CREATE OR REPLACE FUNCTION sot.confirm_identifier(
    p_person_id UUID,
    p_id_type TEXT,
    p_id_value_raw TEXT,
    p_id_value_norm TEXT,
    p_source_system TEXT,
    p_confidence NUMERIC DEFAULT 1.0
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_existing_person_id UUID;
    v_new_source_systems TEXT[];
    v_new_count INT;
    v_is_proxy BOOLEAN;
    v_computed_confidence NUMERIC;
BEGIN
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN NULL;
    END IF;

    SELECT id, person_id, COALESCE(source_systems, ARRAY[source_system]),
           COALESCE(confirmation_count, 1), COALESCE(is_proxy, FALSE)
    INTO v_id, v_existing_person_id, v_new_source_systems, v_new_count, v_is_proxy
    FROM sot.person_identifiers
    WHERE id_type = p_id_type AND id_value_norm = p_id_value_norm;

    IF v_id IS NOT NULL THEN
        IF v_existing_person_id = p_person_id THEN
            v_new_count := v_new_count + 1;
            v_new_source_systems := (
                SELECT array_agg(DISTINCT s ORDER BY s)
                FROM unnest(v_new_source_systems || ARRAY[p_source_system]) AS s
                WHERE s IS NOT NULL
            );
            v_computed_confidence := sot.compute_identifier_confidence(
                v_new_source_systems, v_new_count, v_is_proxy
            );
            UPDATE sot.person_identifiers
            SET last_confirmed_at = NOW(),
                confirmation_count = v_new_count,
                source_systems = v_new_source_systems,
                confidence = v_computed_confidence,
                id_value_raw = COALESCE(NULLIF(p_id_value_raw, ''), id_value_raw)
            WHERE id = v_id;
            RETURN v_id;
        ELSE
            RETURN NULL;
        END IF;
    END IF;

    v_new_source_systems := ARRAY[p_source_system];
    v_computed_confidence := sot.compute_identifier_confidence(
        v_new_source_systems, 1, FALSE
    );

    INSERT INTO sot.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm,
        confidence, source_system, source_systems,
        last_confirmed_at, confirmation_count, is_proxy
    ) VALUES (
        p_person_id, p_id_type, p_id_value_raw, p_id_value_norm,
        v_computed_confidence, p_source_system, v_new_source_systems,
        NOW(), 1, FALSE
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.confirm_identifier IS
'V3: Now reads is_proxy column (MIG_3027). Proxy identifiers get 0.5x confidence multiplier.';

-- Also update get_all_identifiers to include is_proxy
CREATE OR REPLACE FUNCTION sot.get_all_identifiers(
  p_person_id UUID,
  p_min_confidence NUMERIC DEFAULT 0.5
) RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id_type', id_type,
        'id_value', COALESCE(id_value_raw, id_value_norm),
        'confidence', confidence,
        'source_system', source_system,
        'source_systems', source_systems,
        'last_confirmed_at', last_confirmed_at,
        'confirmation_count', confirmation_count,
        'is_proxy', COALESCE(is_proxy, FALSE)
      )
      ORDER BY id_type, confidence DESC, last_confirmed_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM sot.person_identifiers
  WHERE person_id = p_person_id
    AND confidence >= p_min_confidence;
$$ LANGUAGE sql STABLE;

\echo '   confirm_identifier() V3 + get_all_identifiers() updated with is_proxy'

-- ============================================================================
-- 4. INITIAL DETECTION RUN
-- ============================================================================

\echo ''
\echo '4. Running initial proxy detection...'

\echo ''
\echo 'DRY RUN — preview what would be flagged:'
SELECT detection_rule, COUNT(*) AS count
FROM ops.detect_proxy_identifiers(TRUE)
GROUP BY detection_rule
ORDER BY count DESC;

\echo ''
\echo 'Applying proxy flags...'
SELECT detection_rule, COUNT(*) AS count
FROM ops.detect_proxy_identifiers(FALSE)
GROUP BY detection_rule
ORDER BY count DESC;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Proxy identifier counts:'
SELECT is_proxy, COUNT(*) AS count
FROM sot.person_identifiers
GROUP BY is_proxy
ORDER BY is_proxy;

\echo ''
\echo 'Proxy identifiers by detection source (top 10 by name):'
SELECT p.display_name, pi.id_type, pi.id_value_norm, pi.confidence, pi.source_systems
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id
WHERE pi.is_proxy = TRUE
ORDER BY p.display_name
LIMIT 10;

\echo ''
\echo 'Confidence distribution for proxy vs non-proxy:'
SELECT
  is_proxy,
  ROUND(AVG(confidence), 2) AS avg_confidence,
  ROUND(MIN(confidence), 2) AS min_confidence,
  ROUND(MAX(confidence), 2) AS max_confidence,
  COUNT(*) AS count
FROM sot.person_identifiers
GROUP BY is_proxy
ORDER BY is_proxy;

\echo ''
\echo '=============================================='
\echo '  MIG_3027 Complete!'
\echo '=============================================='
\echo ''
\echo 'CREATED:'
\echo '  - sot.person_identifiers.is_proxy column'
\echo '  - idx_person_identifiers_proxy index'
\echo '  - ops.detect_proxy_identifiers() function (4 rules)'
\echo '  - ops.app_config proxy detection thresholds'
\echo ''
\echo 'APPLIED:'
\echo '  - Initial proxy detection run on all existing identifiers'
\echo '  - Proxy identifiers have confidence recomputed with 0.5x multiplier'
\echo ''
\echo 'NOTE: Add ops.detect_proxy_identifiers(FALSE) to cron schedule'
\echo '      alongside auto_blacklist_shared_identifiers() (MIG_3002).'
\echo ''
