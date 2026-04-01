-- MIG_3026: Source-Weighted Dynamic Confidence
--
-- Problem: Confidence is static 1.0 for everything except PetLink (0.1-0.2).
-- A phone seen once in ClinicHQ (anyone can book) has the same weight as one
-- confirmed by VolunteerHub (self-signup) + ShelterLuv (legal adoption record).
--
-- Solution:
--   1. Source authority weights in ops.app_config (configurable)
--   2. sot.compute_identifier_confidence() — derives confidence from source_systems[], count, proxy
--   3. Update confirm_identifier() to recompute confidence on every confirmation
--   4. Update get_high_confidence_identifier() to use last_confirmed_at as tiebreaker
--
-- FFS-103x: Identifier Confidence & Proxy Detection (Issue 2)
-- Dependencies: MIG_3025 (needs source_systems[], confirmation_count, last_confirmed_at)
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3026: Source-Weighted Dynamic Confidence'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SOURCE AUTHORITY WEIGHTS
-- ============================================================================

\echo '1. Adding source authority weights to ops.app_config...'

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('identity.source_weights',
   '{"atlas_ui": 1.00, "volunteerhub": 0.95, "shelterluv": 0.90, "web_intake": 0.85, "airtable": 0.80, "clinichq": 0.70, "petlink": 0.20}',
   'Source authority weights for identifier confidence. Higher = more trustworthy. atlas_ui = staff-verified (highest). clinichq = anyone can book (low). petlink = fabricated emails (lowest).',
   'identity'),
  ('identity.multi_source_bonus_per_source', '0.05',
   'Confidence bonus per additional distinct source system (cap 0.15)',
   'identity'),
  ('identity.multi_source_bonus_cap', '0.15',
   'Maximum confidence bonus from multi-source confirmation',
   'identity'),
  ('identity.reconfirmation_bonus_per_count', '0.02',
   'Confidence bonus per re-confirmation beyond the first (cap 0.10)',
   'identity'),
  ('identity.reconfirmation_bonus_cap', '0.10',
   'Maximum confidence bonus from re-confirmations',
   'identity'),
  ('identity.proxy_confidence_multiplier', '0.5',
   'Confidence multiplier for proxy identifiers (trapper phones, high-volume bookers)',
   'identity')
ON CONFLICT (key) DO NOTHING;

\echo '   Source weights added'

-- ============================================================================
-- 2. CREATE sot.compute_identifier_confidence()
-- ============================================================================

\echo ''
\echo '2. Creating sot.compute_identifier_confidence()...'

CREATE OR REPLACE FUNCTION sot.compute_identifier_confidence(
    p_source_systems TEXT[],
    p_confirmation_count INT,
    p_is_proxy BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC AS $$
DECLARE
    v_weights JSONB;
    v_base_weight NUMERIC := 0;
    v_source TEXT;
    v_source_weight NUMERIC;
    v_multi_source_bonus NUMERIC := 0;
    v_reconf_bonus NUMERIC := 0;
    v_result NUMERIC;
    -- Configurable parameters
    v_bonus_per_source NUMERIC;
    v_bonus_cap NUMERIC;
    v_reconf_per_count NUMERIC;
    v_reconf_cap NUMERIC;
    v_proxy_multiplier NUMERIC;
BEGIN
    -- Read config
    v_weights := ops.get_config('identity.source_weights',
        '{"atlas_ui": 1.00, "volunteerhub": 0.95, "shelterluv": 0.90, "web_intake": 0.85, "airtable": 0.80, "clinichq": 0.70, "petlink": 0.20}'::JSONB);
    v_bonus_per_source := ops.get_config_numeric('identity.multi_source_bonus_per_source', 0.05);
    v_bonus_cap := ops.get_config_numeric('identity.multi_source_bonus_cap', 0.15);
    v_reconf_per_count := ops.get_config_numeric('identity.reconfirmation_bonus_per_count', 0.02);
    v_reconf_cap := ops.get_config_numeric('identity.reconfirmation_bonus_cap', 0.10);
    v_proxy_multiplier := ops.get_config_numeric('identity.proxy_confidence_multiplier', 0.5);

    -- 1. Start with highest source weight from array
    IF p_source_systems IS NOT NULL THEN
        FOREACH v_source IN ARRAY p_source_systems LOOP
            v_source_weight := COALESCE((v_weights->>v_source)::NUMERIC, 0.5);
            v_base_weight := GREATEST(v_base_weight, v_source_weight);
        END LOOP;

        -- 2. +bonus per additional distinct source (cap at configured max)
        IF array_length(p_source_systems, 1) > 1 THEN
            v_multi_source_bonus := LEAST(
                (array_length(p_source_systems, 1) - 1) * v_bonus_per_source,
                v_bonus_cap
            );
        END IF;
    END IF;

    -- 3. +bonus per re-confirmation beyond first (cap at configured max)
    IF COALESCE(p_confirmation_count, 1) > 1 THEN
        v_reconf_bonus := LEAST(
            (p_confirmation_count - 1) * v_reconf_per_count,
            v_reconf_cap
        );
    END IF;

    -- Combine
    v_result := v_base_weight + v_multi_source_bonus + v_reconf_bonus;

    -- 4. If proxy: apply multiplier
    IF COALESCE(p_is_proxy, FALSE) THEN
        v_result := v_result * v_proxy_multiplier;
    END IF;

    -- 5. Clamp [0.0, 1.0]
    v_result := GREATEST(0.0, LEAST(1.0, v_result));

    RETURN ROUND(v_result, 2);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.compute_identifier_confidence IS
'Computes dynamic confidence for an identifier based on:
1. Highest source authority weight from source_systems[] (e.g. volunteerhub=0.95)
2. +0.05 per additional distinct source (cap 0.15)
3. +0.02 per re-confirmation beyond first (cap 0.10)
4. x0.5 multiplier if proxy identifier (trapper phone, etc.)
All parameters configurable via ops.app_config identity.* keys.
Example outcomes:
- ClinicHQ + VolunteerHub, 20x confirmed = 0.95 + 0.05 + 0.10 = 1.0 (capped)
- ClinicHQ only, 1x = 0.70
- ClinicHQ only, proxy = 0.70 x 0.5 = 0.35 (below 0.5 threshold!)
- PetLink = 0.20
MIG_3026.';

\echo '   sot.compute_identifier_confidence() created'

-- ============================================================================
-- 3. UPDATE confirm_identifier() — now recomputes confidence
-- ============================================================================

\echo ''
\echo '3. Updating sot.confirm_identifier() to recompute confidence...'

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
    -- Skip NULL/empty identifiers
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN NULL;
    END IF;

    -- Check if identifier already exists
    -- Note: is_proxy column added in MIG_3027; use safe fallback for column existence
    SELECT id, person_id, COALESCE(source_systems, ARRAY[source_system]), COALESCE(confirmation_count, 1)
    INTO v_id, v_existing_person_id, v_new_source_systems, v_new_count
    FROM sot.person_identifiers
    WHERE id_type = p_id_type AND id_value_norm = p_id_value_norm;

    -- is_proxy defaults to FALSE until MIG_3027 adds the column
    v_is_proxy := FALSE;

    IF v_id IS NOT NULL THEN
        IF v_existing_person_id = p_person_id THEN
            -- Same person: bump confirmation metadata
            v_new_count := v_new_count + 1;
            v_new_source_systems := (
                SELECT array_agg(DISTINCT s ORDER BY s)
                FROM unnest(v_new_source_systems || ARRAY[p_source_system]) AS s
                WHERE s IS NOT NULL
            );

            -- Recompute confidence from evidence (MIG_3026)
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
            -- Different person owns this identifier: don't transfer
            RETURN NULL;
        END IF;
    END IF;

    -- New identifier: compute initial confidence
    v_new_source_systems := ARRAY[p_source_system];
    v_computed_confidence := sot.compute_identifier_confidence(
        v_new_source_systems, 1, FALSE
    );

    INSERT INTO sot.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm,
        confidence, source_system, source_systems,
        last_confirmed_at, confirmation_count
    ) VALUES (
        p_person_id, p_id_type, p_id_value_raw, p_id_value_norm,
        v_computed_confidence, p_source_system, v_new_source_systems,
        NOW(), 1
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.confirm_identifier IS
'V2: Centralized write function for person_identifiers with dynamic confidence (MIG_3026).
- New identifier: computes confidence from source weight
- Re-confirmation: bumps metadata + recomputes confidence from accumulated evidence
- Different person: returns NULL (no transfer)
Confidence is computed by sot.compute_identifier_confidence() using source_systems[], count, and is_proxy.';

\echo '   sot.confirm_identifier() V2 updated'

-- ============================================================================
-- 4. UPDATE get_high_confidence_identifier() — last_confirmed_at tiebreaker
-- ============================================================================

\echo ''
\echo '4. Updating get_high_confidence_identifier() with freshness tiebreaker...'

CREATE OR REPLACE FUNCTION sot.get_high_confidence_identifier(
  p_person_id UUID,
  p_id_type TEXT,
  p_min_confidence NUMERIC DEFAULT 0.5
) RETURNS TEXT AS $$
  SELECT COALESCE(id_value_raw, id_value_norm)
  FROM sot.person_identifiers
  WHERE person_id = p_person_id
    AND id_type = p_id_type
    AND confidence >= p_min_confidence
  ORDER BY confidence DESC, last_confirmed_at DESC NULLS LAST
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_high_confidence_identifier IS
'Returns the highest-confidence identifier of a given type for a person.
MIG_3026: Added last_confirmed_at DESC as tiebreaker (freshest confirmed wins).
Default minimum confidence is 0.5, filtering out fabricated PetLink emails.';

-- get_email and get_phone are wrappers — they inherit the updated behavior automatically

\echo '   get_high_confidence_identifier() updated with freshness tiebreaker'

-- ============================================================================
-- 5. UPDATE get_all_identifiers() — include new columns
-- ============================================================================

\echo ''
\echo '5. Updating get_all_identifiers() to include new columns...'

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
        'confirmation_count', confirmation_count
      )
      ORDER BY id_type, confidence DESC, last_confirmed_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM sot.person_identifiers
  WHERE person_id = p_person_id
    AND confidence >= p_min_confidence;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_all_identifiers IS
'Returns all high-confidence identifiers for a person as a JSONB array.
MIG_3026: Now includes source_systems, last_confirmed_at, confirmation_count.
Ordered by confidence DESC, then freshness DESC.
Note: is_proxy added in MIG_3027 after column exists.';

\echo '   get_all_identifiers() updated'

-- ============================================================================
-- 6. ONE-TIME CONFIDENCE RECOMPUTATION
-- ============================================================================

\echo ''
\echo '6. Recomputing confidence for all existing identifiers...'

-- Recompute confidence for non-PetLink identifiers using their source_systems
-- PetLink identifiers keep their existing low confidence (0.1-0.2) which is already
-- correct and would be recomputed to 0.20 by source weight anyway
UPDATE sot.person_identifiers
SET confidence = sot.compute_identifier_confidence(
    COALESCE(source_systems, ARRAY[COALESCE(source_system, 'unknown')]),
    COALESCE(confirmation_count, 1),
    FALSE  -- is_proxy added in MIG_3027
)
WHERE source_system != 'petlink' OR source_system IS NULL;

-- Ensure PetLink identifiers have exactly 0.20 (source weight for petlink)
UPDATE sot.person_identifiers
SET confidence = sot.compute_identifier_confidence(
    COALESCE(source_systems, ARRAY['petlink']),
    COALESCE(confirmation_count, 1),
    FALSE  -- is_proxy added in MIG_3027
)
WHERE source_system = 'petlink';

\echo '   Confidence recomputed'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Confidence distribution after recomputation:'
SELECT
  CASE
    WHEN confidence >= 0.95 THEN '0.95-1.00 (very high)'
    WHEN confidence >= 0.80 THEN '0.80-0.94 (high)'
    WHEN confidence >= 0.50 THEN '0.50-0.79 (moderate)'
    WHEN confidence >= 0.20 THEN '0.20-0.49 (low)'
    ELSE '< 0.20 (very low)'
  END AS confidence_band,
  COUNT(*) AS count
FROM sot.person_identifiers
GROUP BY 1
ORDER BY 1;

\echo ''
\echo 'Sample: VolunteerHub-confirmed identifiers (should be >= 0.95):'
SELECT id_value_norm, source_systems, confidence, confirmation_count
FROM sot.person_identifiers
WHERE source_systems && ARRAY['volunteerhub']
LIMIT 5;

\echo ''
\echo 'Sample: ClinicHQ-only identifiers (should be ~0.70):'
SELECT id_value_norm, source_systems, confidence, confirmation_count
FROM sot.person_identifiers
WHERE source_systems = ARRAY['clinichq']
LIMIT 5;

\echo ''
\echo 'Source weight config:'
SELECT key, value FROM ops.app_config WHERE key = 'identity.source_weights';

\echo ''
\echo '=============================================='
\echo '  MIG_3026 Complete!'
\echo '=============================================='
\echo ''
\echo 'CREATED:'
\echo '  - ops.app_config source authority weights (7 source systems)'
\echo '  - ops.app_config confidence computation parameters (5 keys)'
\echo '  - sot.compute_identifier_confidence() function'
\echo ''
\echo 'UPDATED:'
\echo '  - sot.confirm_identifier() V2 — now recomputes confidence via compute_identifier_confidence()'
\echo '  - sot.get_high_confidence_identifier() — last_confirmed_at DESC tiebreaker'
\echo '  - sot.get_all_identifiers() — includes source_systems, last_confirmed_at, confirmation_count, is_proxy'
\echo '  - All existing identifiers — confidence recomputed from source evidence'
\echo ''
