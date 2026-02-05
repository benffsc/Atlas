-- ============================================================================
-- MIG_887: PetLink Email Decontamination
-- ============================================================================
-- Problem: FFSC staff fabricates emails for PetLink microchip registration
-- (required field). They use street address names as domains:
--   gordon@lohrmanln.com, kathleen@jeffersonst.com, nunes@bodega.com
--
-- These entered person_identifiers with confidence=1.0 and are treated as
-- real contact info for identity matching, search, and primary_email.
--
-- Impact: 1,252 PetLink emails, 1,224 people with fabricated primary_email.
-- Zero cross-contamination so far, but a ticking time bomb.
--
-- Solution: Confidence-based filtering. Classify PetLink emails into tiers,
-- lower confidence, and add confidence >= 0.5 filter to identity matching.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_887: PetLink Email Decontamination'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Pre-diagnostic
-- ============================================================================

\echo 'Phase 1: Baseline...'

SELECT
  COUNT(*) AS total_petlink_emails,
  COUNT(*) FILTER (WHERE pi.confidence = 1.0) AS at_confidence_1
FROM trapper.person_identifiers pi
WHERE pi.source_system = 'petlink' AND pi.id_type = 'email';

SELECT COUNT(*) AS people_with_petlink_primary_email
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND sp.primary_email IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'petlink'
      AND pi.id_value_norm = LOWER(TRIM(sp.primary_email))
  )
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi2
    WHERE pi2.person_id = sp.person_id
      AND pi2.id_type = 'email'
      AND pi2.source_system != 'petlink'
  );

-- Verify zero cross-contamination
SELECT COUNT(*) AS cross_contamination_count
FROM trapper.person_identifiers pi1
JOIN trapper.person_identifiers pi2 ON pi2.id_value_norm = pi1.id_value_norm
  AND pi2.id_type = 'email'
  AND pi2.source_system != 'petlink'
WHERE pi1.source_system = 'petlink' AND pi1.id_type = 'email';

-- ============================================================================
-- Phase 2: Create classify_petlink_email() function
-- ============================================================================

\echo ''
\echo 'Phase 2: Creating classify_petlink_email()...'

CREATE OR REPLACE FUNCTION trapper.classify_petlink_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_domain TEXT;
  v_local TEXT;
BEGIN
  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RETURN 'fabricated';
  END IF;

  v_domain := LOWER(SUBSTRING(p_email FROM '@(.+)$'));
  v_local := LOWER(SUBSTRING(p_email FROM '^(.+)@'));

  IF v_domain IS NULL THEN
    RETURN 'fabricated';
  END IF;

  -- Known real email providers
  IF v_domain IN (
    'gmail.com', 'yahoo.com', 'hotmail.com', 'comcast.net', 'sbcglobal.net',
    'aol.com', 'sonic.net', 'att.net', 'msn.com', 'earthlink.net',
    'icloud.com', 'live.com', 'outlook.com', 'ymail.com', 'mac.com',
    'prodigy.net', 'juno.com', 'me.com', 'rocketmail.com', 'protonmail.com',
    'zoho.com', 'mail.com', 'gmx.com', 'fastmail.com', 'netzero.com',
    'netzero.net', 'peoplepc.com', 'wildblue.net', 'pacbell.net',
    'swbell.net', 'pobox.com', 'care2.com', 'usa.com', 'well.com',
    'saber.net', 'pacific.net'
  ) THEN
    RETURN 'likely_real';
  END IF;

  -- Known educational/gov domains (likely real)
  IF v_domain ~ '\.(edu|gov)$' THEN
    RETURN 'likely_real';
  END IF;

  -- Explicit placeholder domains
  IF v_domain IN ('noemail.com', 'nomail.com', 'none.com', 'na.com', 'no.com') THEN
    RETURN 'fabricated';
  END IF;

  -- Street-address-style domains: word(s) ending in road/street/avenue suffix
  -- Covers: sebastopolrd.com, hearnave.com, lohrmanln.com, jeffersonst.com, etc.
  IF v_domain ~ '^[a-z0-9]+(rd|ave|ln|st|dr|ct|blvd|hwy|way|cir|pl|lane)\.(com|net|org)$' THEN
    RETURN 'fabricated';
  END IF;

  -- Numeric-only local part (e.g., 433134@something.com)
  IF v_local ~ '^\d+$' THEN
    RETURN 'fabricated';
  END IF;

  -- Gmail typos
  IF v_domain IN ('gmaill.com', 'gmailc.om', 'gmsil.com', 'gmail.net') THEN
    RETURN 'likely_real';
  END IF;

  -- Everything else from PetLink: unknown provider, treat conservatively
  RETURN 'unknown_provider';
END;
$$;

COMMENT ON FUNCTION trapper.classify_petlink_email(TEXT) IS
'MIG_887: Classifies PetLink emails as fabricated (street-address domains, placeholders),
likely_real (known providers like gmail/yahoo), or unknown_provider (conservative default).
Used to set appropriate confidence on person_identifiers.';

-- Show classification results
SELECT
  trapper.classify_petlink_email(pi.id_value_norm) AS classification,
  COUNT(*) AS email_count
FROM trapper.person_identifiers pi
WHERE pi.source_system = 'petlink' AND pi.id_type = 'email'
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- Phase 3: Lower confidence on PetLink email identifiers
-- ============================================================================

\echo ''
\echo 'Phase 3: Lowering PetLink email confidence...'

-- Fabricated → 0.1
WITH updated_fabricated AS (
  UPDATE trapper.person_identifiers
  SET confidence = 0.1
  WHERE source_system = 'petlink'
    AND id_type = 'email'
    AND trapper.classify_petlink_email(id_value_norm) = 'fabricated'
    AND confidence != 0.1
  RETURNING identifier_id
)
SELECT COUNT(*) AS fabricated_lowered FROM updated_fabricated;

-- Unknown provider → 0.2
WITH updated_unknown AS (
  UPDATE trapper.person_identifiers
  SET confidence = 0.2
  WHERE source_system = 'petlink'
    AND id_type = 'email'
    AND trapper.classify_petlink_email(id_value_norm) = 'unknown_provider'
    AND confidence != 0.2
  RETURNING identifier_id
)
SELECT COUNT(*) AS unknown_provider_lowered FROM updated_unknown;

-- Likely real → 0.5
WITH updated_real AS (
  UPDATE trapper.person_identifiers
  SET confidence = 0.5
  WHERE source_system = 'petlink'
    AND id_type = 'email'
    AND trapper.classify_petlink_email(id_value_norm) = 'likely_real'
    AND confidence != 0.5
  RETURNING identifier_id
)
SELECT COUNT(*) AS likely_real_lowered FROM updated_real;

-- ============================================================================
-- Phase 4: Clear primary_email contamination
-- ============================================================================

\echo ''
\echo 'Phase 4: Clearing fabricated primary_email...'

WITH cleared AS (
  UPDATE trapper.sot_people sp
  SET primary_email = NULL,
      updated_at = NOW()
  WHERE sp.merged_into_person_id IS NULL
    AND sp.primary_email IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = sp.person_id
        AND pi.id_type = 'email'
        AND pi.source_system = 'petlink'
        AND pi.confidence < 0.5
        AND pi.id_value_norm = LOWER(TRIM(sp.primary_email))
    )
    -- Only clear if no high-confidence email exists
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi2
      WHERE pi2.person_id = sp.person_id
        AND pi2.id_type = 'email'
        AND pi2.confidence >= 0.5
    )
  RETURNING sp.person_id
)
SELECT COUNT(*) AS primary_email_cleared FROM cleared;

-- ============================================================================
-- Phase 5: Update source_identity_confidence
-- ============================================================================

\echo ''
\echo 'Phase 5: Updating source_identity_confidence...'

UPDATE trapper.source_identity_confidence
SET email_confidence = 0.20,
    notes = 'MIG_887: PetLink emails often fabricated by staff. Real provider emails get 0.5; fabricated get 0.1; unknown get 0.2.',
    updated_at = NOW()
WHERE source_system = 'petlink';

-- ============================================================================
-- Phase 6: Update data_engine_score_candidates() with confidence filter
-- ============================================================================

\echo ''
\echo 'Phase 6: Adding confidence filter to data_engine_score_candidates()...'

-- Must DROP first because return type changed in earlier version
DROP FUNCTION IF EXISTS trapper.data_engine_score_candidates(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[],
    used_enrichment BOOLEAN,
    enrichment_source TEXT,
    score_breakdown JSONB,
    rules_applied JSONB
) AS $$
DECLARE
    v_email_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Check if incoming email is blacklisted
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        v_email_blacklisted := trapper.is_blacklisted_email(p_email_norm);
    END IF;

    RETURN QUERY
    WITH
    -- Email matches (with blacklist check + confidence filter)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            -- If email is blacklisted, score is 0 (won't match based on placeholder emails)
            CASE
                WHEN v_email_blacklisted THEN 0.0::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN v_email_blacklisted THEN 'email_blacklisted'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND NOT v_email_blacklisted  -- Don't match on blacklisted emails
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5  -- MIG_887: Exclude low-confidence identifiers (fabricated PetLink, etc.)
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (check blacklists)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.identity_phone_blacklist bl
                    WHERE bl.phone_norm = p_phone_norm
                    AND bl.allow_with_name_match = FALSE
                ) THEN 0.0::NUMERIC
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
              AND bl.allow_with_name_match = FALSE
          )
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
    ),

    -- Enriched address matching (cross-source)
    enriched_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            p.formatted_address AS enriched_address,
            sp.data_source::TEXT AS address_source
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places p ON p.place_id = ppr.place_id
        JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
        WHERE ppr.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND p.formatted_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
          AND sp.merged_into_person_id IS NULL
    ),

    -- Calculate scores for each candidate
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 AS email_component,
            -- Phone score: 25% weight
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 AS phone_component,
            -- Name similarity: 25% weight
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE trapper.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight (with enrichment from cross-source)
            CASE
                -- Direct address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM trapper.person_place_relationships ppr
                    JOIN trapper.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.normalized_address = p_address_norm
                    AND pl.merged_into_place_id IS NULL
                ) THEN 0.10
                -- Cross-source enriched address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                    AND UPPER(eam.enriched_address) = p_address_norm
                ) THEN 0.08
                ELSE 0.0
            END AS address_component,
            -- Household detection
            hm.household_id,
            CASE
                WHEN hm.household_id IS NOT NULL THEN TRUE
                ELSE FALSE
            END AS is_household_candidate,
            -- Track matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                ) THEN 'enriched_address' ELSE NULL END
            ], NULL) AS matched_rules,
            -- Check if enrichment was used
            EXISTS (
                SELECT 1 FROM enriched_address_matches eam
                WHERE eam.matched_person_id = sp.person_id
            ) AS used_enrichment,
            (SELECT eam.address_source FROM enriched_address_matches eam
             WHERE eam.matched_person_id = sp.person_id LIMIT 1) AS enrichment_source
        FROM all_candidates ac
        JOIN trapper.sot_people sp ON sp.person_id = ac.matched_person_id
        LEFT JOIN trapper.household_members hm ON hm.person_id = sp.person_id
        WHERE sp.merged_into_person_id IS NULL
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component AS email_score,
        sc.phone_component AS phone_score,
        sc.name_component AS name_score,
        sc.address_component AS address_score,
        sc.household_id,
        sc.is_household_candidate,
        sc.matched_rules,
        sc.used_enrichment,
        sc.enrichment_source,
        jsonb_build_object(
            'email', sc.email_component,
            'phone', sc.phone_component,
            'name', sc.name_component,
            'address', sc.address_component
        ) AS score_breakdown,
        '[]'::JSONB AS rules_applied
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates(TEXT, TEXT, TEXT, TEXT) IS
'MIG_887: Added pi.confidence >= 0.5 filter to email matching. Prevents fabricated PetLink emails
from causing identity matches. Also checks email blacklist (MIG_522) and phone blacklist.
Weights: email 40%, phone 25%, name 25%, address 10%.';

-- ============================================================================
-- Phase 7: Update create_person_basic() with source-aware confidence
-- ============================================================================

\echo ''
\echo 'Phase 7: Updating create_person_basic() with source-aware confidence...'

CREATE OR REPLACE FUNCTION trapper.create_person_basic(
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_existing_person_id UUID;
    v_data_source trapper.data_source;
    v_lock_key BIGINT;
    v_email_confidence NUMERIC(3,2);
BEGIN
    -- Validate name
    IF NOT trapper.is_valid_person_name(p_display_name) THEN
        RETURN NULL;
    END IF;

    -- Calculate lock key from identifiers
    v_lock_key := COALESCE(
        hashtext(COALESCE(p_email_norm, '') || '|' || COALESCE(p_phone_norm, '')),
        0
    );

    -- Skip locking if no identifiers
    IF p_email_norm IS NULL AND p_phone_norm IS NULL THEN
        v_data_source := CASE p_source_system
            WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
            WHEN 'airtable' THEN 'airtable'::trapper.data_source
            WHEN 'web_intake' THEN 'web_app'::trapper.data_source
            WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
            WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
            WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
            ELSE 'web_app'::trapper.data_source
        END;

        INSERT INTO trapper.sot_people (
            display_name, data_source, is_canonical, primary_email, primary_phone
        ) VALUES (
            p_display_name, v_data_source, TRUE, NULL, NULL
        ) RETURNING person_id INTO v_person_id;

        RETURN v_person_id;
    END IF;

    -- Acquire transaction-scoped advisory lock
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Double-check: After acquiring lock, check if identifier now exists
    IF p_email_norm IS NOT NULL THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5  -- MIG_887: Only match on high-confidence emails
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_existing_person_id IS NOT NULL THEN
            RAISE NOTICE 'Race condition avoided: returning existing person % (matched by email)', v_existing_person_id;
            RETURN v_existing_person_id;
        END IF;
    END IF;

    IF p_phone_norm IS NOT NULL AND v_existing_person_id IS NULL THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND sp.merged_into_person_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
          )
        LIMIT 1;

        IF v_existing_person_id IS NOT NULL THEN
            RAISE NOTICE 'Race condition avoided: returning existing person % (matched by phone)', v_existing_person_id;
            RETURN v_existing_person_id;
        END IF;
    END IF;

    -- No existing person found - safe to create
    v_data_source := CASE p_source_system
        WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
        WHEN 'airtable' THEN 'airtable'::trapper.data_source
        WHEN 'web_intake' THEN 'web_app'::trapper.data_source
        WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
        WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
        WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
        ELSE 'web_app'::trapper.data_source
    END;

    -- MIG_887: Source-aware email confidence
    v_email_confidence := CASE p_source_system
        WHEN 'petlink' THEN 0.2
        ELSE 1.0
    END;

    -- Create person
    -- MIG_887: Only set primary_email if confidence is high enough
    INSERT INTO trapper.sot_people (
        display_name, data_source, is_canonical, primary_email, primary_phone
    ) VALUES (
        p_display_name, v_data_source, TRUE,
        CASE WHEN v_email_confidence >= 0.5 THEN p_email_norm ELSE NULL END,
        p_phone_norm
    ) RETURNING person_id INTO v_person_id;

    -- Add email identifier with source-aware confidence
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
            v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, v_email_confidence
        ) ON CONFLICT (id_type, id_value_norm) DO UPDATE
        SET person_id = EXCLUDED.person_id
        WHERE trapper.person_identifiers.person_id IN (
            SELECT person_id FROM trapper.sot_people
            WHERE merged_into_person_id IS NOT NULL
        );
    END IF;

    -- Add phone identifier (if not blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (
                person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
            ) VALUES (
                v_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system, 1.0
            ) ON CONFLICT (id_type, id_value_norm) DO UPDATE
            SET person_id = EXCLUDED.person_id
            WHERE trapper.person_identifiers.person_id IN (
                SELECT person_id FROM trapper.sot_people
                WHERE merged_into_person_id IS NOT NULL
            );
        END IF;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_basic(TEXT, TEXT, TEXT, TEXT) IS
'MIG_887: Source-aware email confidence. PetLink emails get confidence 0.2 (not used for matching).
Other sources get 1.0. primary_email only set when confidence >= 0.5.
Race protection via pg_advisory_xact_lock (MIG_568).';

-- ============================================================================
-- Phase 8: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT
  trapper.classify_petlink_email(pi.id_value_norm) AS classification,
  pi.confidence,
  COUNT(*) AS email_count
FROM trapper.person_identifiers pi
WHERE pi.source_system = 'petlink' AND pi.id_type = 'email'
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT COUNT(*) AS people_with_null_primary_email
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND sp.primary_email IS NULL
  AND EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'petlink'
  );

-- Verify Gordon Maxwell specifically
SELECT sp.person_id, sp.display_name, sp.primary_email,
  pi.id_value_norm AS petlink_email, pi.confidence
FROM trapper.sot_people sp
JOIN trapper.person_identifiers pi ON pi.person_id = sp.person_id
  AND pi.id_type = 'email' AND pi.source_system = 'petlink'
WHERE sp.display_name ILIKE '%gordon%maxwell%'
  AND sp.merged_into_person_id IS NULL;

\echo ''
\echo '=== MIG_887 Complete ==='
\echo 'PetLink emails classified and confidence lowered.'
\echo 'Fabricated → 0.1, Unknown provider → 0.2, Likely real → 0.5'
\echo 'Identity matching now requires pi.confidence >= 0.5.'
\echo 'primary_email cleared for fabricated-only people.'
