-- MIG_3019: Identity Write Path Consolidation
--
-- Audit found 3 identifier write paths bypassing confirm_identifier():
-- 1. sync_person_identifiers trigger — raw INSERT, no confidence/source_systems/freshness
-- 2. identifier_demotion_factor() — structurally dead (unique constraint = always 1.0),
--    but still called by scoring functions. Replace with is_proxy-aware version.
-- 3. last_confirmed_at never updated after creation — freshness signal is useless.
--
-- Also: auto_blacklist_shared_identifiers() doesn't exist despite being referenced.
--
-- Industry standard (Senzing, MDM): all identifier writes go through a single
-- centralized function that handles confidence, source tracking, and proxy detection.
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3019: Identity Write Path Consolidation'
\echo '=============================================='
\echo ''

-- ============================================================================
-- SECTION A: Fix sync_person_identifiers trigger
-- ============================================================================
-- The trigger on sot.people fires on INSERT/UPDATE and does raw INSERT into
-- person_identifiers bypassing confirm_identifier(). Replace with a version
-- that calls confirm_identifier() and respects blacklist/proxy/confidence.

\echo '1. Fixing sync_person_identifiers trigger...'

CREATE OR REPLACE FUNCTION sot.sync_person_identifiers()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_source TEXT;
    v_email_norm TEXT;
    v_phone_norm TEXT;
BEGIN
    v_source := COALESCE(NEW.source_system, 'atlas');

    -- Handle primary_email
    IF NEW.primary_email IS NOT NULL AND TRIM(NEW.primary_email) != '' THEN
        v_email_norm := LOWER(TRIM(NEW.primary_email));

        -- Skip blacklisted identifiers
        IF NOT EXISTS (
            SELECT 1 FROM sot.data_engine_soft_blacklist
            WHERE identifier_type = 'email' AND identifier_norm = v_email_norm
        ) THEN
            -- Use confirm_identifier for centralized write path
            PERFORM sot.confirm_identifier(
                NEW.person_id, 'email', NEW.primary_email, v_email_norm,
                v_source, 0.70  -- default confidence, will be recomputed by confirm_identifier
            );
        END IF;
    END IF;

    -- Handle primary_phone
    IF NEW.primary_phone IS NOT NULL AND TRIM(NEW.primary_phone) != '' THEN
        v_phone_norm := REGEXP_REPLACE(NEW.primary_phone, '[^0-9]', '', 'g');

        -- Skip blacklisted identifiers
        IF NOT EXISTS (
            SELECT 1 FROM sot.data_engine_soft_blacklist
            WHERE identifier_type = 'phone' AND identifier_norm = v_phone_norm
        ) THEN
            PERFORM sot.confirm_identifier(
                NEW.person_id, 'phone', NEW.primary_phone, v_phone_norm,
                v_source, 0.70
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION sot.sync_person_identifiers IS
'Trigger on sot.people INSERT/UPDATE. Now uses confirm_identifier() for centralized
write path with confidence, source tracking, and blacklist checking. MIG_3019.';

\echo '   sync_person_identifiers trigger updated to use confirm_identifier()'


-- ============================================================================
-- SECTION B: Fix identifier_demotion_factor() — use is_proxy
-- ============================================================================
-- The old version counts DISTINCT person_id sharing an identifier, but the
-- unique constraint (id_type, id_value_norm) means this ALWAYS returns 1.
-- Replace with is_proxy-aware version that actually works.

\echo ''
\echo '2. Fixing identifier_demotion_factor() to use is_proxy...'

CREATE OR REPLACE FUNCTION sot.identifier_demotion_factor(
    p_id_type TEXT,
    p_id_value_norm TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE
AS $function$
DECLARE
    v_is_proxy BOOLEAN;
    v_proxy_multiplier NUMERIC;
BEGIN
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN 1.0;
    END IF;

    -- Check if identifier is flagged as proxy (MIG_3027)
    SELECT COALESCE(is_proxy, FALSE) INTO v_is_proxy
    FROM sot.person_identifiers
    WHERE id_type = p_id_type AND id_value_norm = p_id_value_norm;

    IF NOT FOUND THEN
        RETURN 1.0;  -- Unknown identifier, no demotion
    END IF;

    IF v_is_proxy THEN
        -- Read proxy multiplier from config (default 0.5)
        SELECT COALESCE(value::numeric, 0.5) INTO v_proxy_multiplier
        FROM ops.app_config WHERE key = 'identity.proxy_confidence_multiplier';
        IF v_proxy_multiplier IS NULL THEN v_proxy_multiplier := 0.5; END IF;
        RETURN v_proxy_multiplier;
    END IF;

    -- Also check soft blacklist (these should get maximum demotion)
    IF EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist
        WHERE identifier_type = p_id_type AND identifier_norm = p_id_value_norm
    ) THEN
        RETURN 0.05;  -- Near-zero weight for blacklisted identifiers
    END IF;

    RETURN 1.0;
END;
$function$;

COMMENT ON FUNCTION sot.identifier_demotion_factor IS
'V2: Uses is_proxy flag (MIG_3027) instead of counting distinct people (broken by unique
constraint). Returns 0.5 for proxy identifiers, 0.05 for blacklisted, 1.0 otherwise.
Called by data_engine_score_candidates_v2() during Phase 1+ scoring. MIG_3019.';

\echo '   identifier_demotion_factor() now reads is_proxy flag'


-- ============================================================================
-- SECTION C: Fix last_confirmed_at freshness signal
-- ============================================================================
-- The MIG_3025 backfill set last_confirmed_at = created_at for all rows.
-- But confirm_identifier() updates last_confirmed_at to NOW() on re-confirmation.
-- For identifiers that have been seen in ClinicHQ batches since MIG_3025, we can
-- set last_confirmed_at from the latest appointment date as a proxy for "last seen."

\echo ''
\echo '3. Enriching last_confirmed_at with actual confirmation timestamps...'

-- For ClinicHQ identifiers: set last_confirmed_at to the latest appointment date
-- for that person (approximates when the identifier was last used in a booking)
UPDATE sot.person_identifiers pi
SET last_confirmed_at = sub.latest_appt
FROM (
    SELECT a.person_id, MAX(a.appointment_date)::timestamptz AS latest_appt
    FROM ops.appointments a
    WHERE a.person_id IS NOT NULL
    GROUP BY a.person_id
) sub
WHERE pi.person_id = sub.person_id
  AND pi.source_system = 'clinichq'
  AND sub.latest_appt > pi.last_confirmed_at;

-- For VolunteerHub identifiers: set to VH volunteer sync date
UPDATE sot.person_identifiers pi
SET last_confirmed_at = sub.vh_date
FROM (
    SELECT vv.matched_person_id AS person_id, MAX(vv.created_at) AS vh_date
    FROM source.volunteerhub_volunteers vv
    WHERE vv.matched_person_id IS NOT NULL
    GROUP BY vv.matched_person_id
) sub
WHERE pi.person_id = sub.person_id
  AND pi.source_system = 'volunteerhub'
  AND sub.vh_date > pi.last_confirmed_at;

-- For ShelterLuv identifiers: set to latest SL fetch date
UPDATE sot.person_identifiers pi
SET last_confirmed_at = sub.sl_date
FROM (
    SELECT sr.fetched_at AS sl_date, LOWER(TRIM(sr.payload->>'Email')) AS email
    FROM source.shelterluv_raw sr
    WHERE sr.record_type = 'person' AND sr.payload->>'Email' IS NOT NULL
) sub
WHERE pi.id_type = 'email'
  AND pi.source_system = 'shelterluv'
  AND pi.id_value_norm = sub.email
  AND sub.sl_date > pi.last_confirmed_at;

\echo '   last_confirmed_at enriched with actual activity timestamps'


-- ============================================================================
-- SECTION D: Create auto_blacklist_shared_identifiers()
-- ============================================================================
-- Referenced in docs and CLAUDE.md but never created.
-- Detects identifiers used by many distinct clinic_accounts (NOT person_identifiers,
-- which has a unique constraint) and adds them to the soft blacklist.

\echo ''
\echo '4. Creating auto_blacklist_shared_identifiers()...'

CREATE OR REPLACE FUNCTION ops.auto_blacklist_shared_identifiers(
    p_threshold INT DEFAULT 5,
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
    identifier_type TEXT,
    identifier_value TEXT,
    shared_by_count INT,
    action_taken TEXT
) AS $$
DECLARE
    v_rec RECORD;
BEGIN
    -- Detect phones shared by many distinct clinic account names
    FOR v_rec IN
        SELECT 'phone' AS id_type,
            sot.norm_phone_us(ca.owner_phone) AS id_value,
            COUNT(DISTINCT ca.display_name) AS name_count
        FROM ops.clinic_accounts ca
        WHERE ca.owner_phone IS NOT NULL AND TRIM(ca.owner_phone) != ''
          AND sot.norm_phone_us(ca.owner_phone) IS NOT NULL
        GROUP BY sot.norm_phone_us(ca.owner_phone)
        HAVING COUNT(DISTINCT ca.display_name) >= p_threshold
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM sot.data_engine_soft_blacklist
            WHERE identifier_type = v_rec.id_type AND identifier_norm = v_rec.id_value
        ) THEN
            IF NOT p_dry_run THEN
                INSERT INTO sot.data_engine_soft_blacklist (
                    identifier_type, identifier_norm, reason, auto_detected
                ) VALUES (
                    v_rec.id_type, v_rec.id_value,
                    'auto_blacklist: ' || v_rec.name_count || ' distinct names (MIG_3019)',
                    TRUE
                ) ON CONFLICT DO NOTHING;
            END IF;
            identifier_type := v_rec.id_type;
            identifier_value := v_rec.id_value;
            shared_by_count := v_rec.name_count;
            action_taken := CASE WHEN p_dry_run THEN 'would_blacklist' ELSE 'blacklisted' END;
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Detect emails shared by many distinct clinic account names
    FOR v_rec IN
        SELECT 'email' AS id_type,
            LOWER(TRIM(ca.owner_email)) AS id_value,
            COUNT(DISTINCT ca.display_name) AS name_count
        FROM ops.clinic_accounts ca
        WHERE ca.owner_email IS NOT NULL AND TRIM(ca.owner_email) != ''
        GROUP BY LOWER(TRIM(ca.owner_email))
        HAVING COUNT(DISTINCT ca.display_name) >= p_threshold
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM sot.data_engine_soft_blacklist
            WHERE identifier_type = v_rec.id_type AND identifier_norm = v_rec.id_value
        ) THEN
            IF NOT p_dry_run THEN
                INSERT INTO sot.data_engine_soft_blacklist (
                    identifier_type, identifier_norm, reason, auto_detected
                ) VALUES (
                    v_rec.id_type, v_rec.id_value,
                    'auto_blacklist: ' || v_rec.name_count || ' distinct names (MIG_3019)',
                    TRUE
                ) ON CONFLICT DO NOTHING;
            END IF;
            identifier_type := v_rec.id_type;
            identifier_value := v_rec.id_value;
            shared_by_count := v_rec.name_count;
            action_taken := CASE WHEN p_dry_run THEN 'would_blacklist' ELSE 'blacklisted' END;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.auto_blacklist_shared_identifiers IS
'Detects phone/email identifiers used by 5+ distinct clinic account names
and adds to soft blacklist. Uses ops.clinic_accounts as the source of truth
for shared identifier detection (not person_identifiers which has unique constraint).
Configurable threshold. MIG_3019.';

-- Run initial detection (dry run first to see what would be caught)
\echo '   Running auto_blacklist dry run...'
SELECT * FROM ops.auto_blacklist_shared_identifiers(5, TRUE);

\echo '   Running auto_blacklist (live)...'
SELECT * FROM ops.auto_blacklist_shared_identifiers(5, FALSE);


-- ============================================================================
-- SECTION E: Identity health monitoring view
-- ============================================================================

\echo ''
\echo '5. Creating identity health monitoring view...'

CREATE OR REPLACE VIEW ops.v_identity_health AS
SELECT
    -- Overall stats
    (SELECT COUNT(*) FROM sot.person_identifiers) AS total_identifiers,
    (SELECT COUNT(DISTINCT person_id) FROM sot.person_identifiers) AS persons_with_identifiers,
    (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = people.person_id)
    ) AS skeleton_persons,
    -- Confidence distribution
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE confidence >= 0.95) AS conf_very_high,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE confidence >= 0.70 AND confidence < 0.95) AS conf_high,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE confidence >= 0.50 AND confidence < 0.70) AS conf_moderate,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE confidence < 0.50) AS conf_low_excluded,
    -- Proxy stats
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE is_proxy = TRUE) AS proxy_identifiers,
    (SELECT ROUND(AVG(confidence), 3) FROM sot.person_identifiers WHERE is_proxy = TRUE) AS proxy_avg_confidence,
    -- Freshness
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE last_confirmed_at >= NOW() - INTERVAL '90 days') AS fresh_90d,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE last_confirmed_at < NOW() - INTERVAL '365 days') AS stale_1yr,
    -- Multi-source
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE array_length(source_systems, 1) > 1) AS multi_source,
    -- Blacklist
    (SELECT COUNT(*) FROM sot.data_engine_soft_blacklist) AS blacklisted_identifiers,
    -- Source distribution
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE source_system = 'clinichq') AS src_clinichq,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE source_system = 'shelterluv') AS src_shelterluv,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE source_system = 'volunteerhub') AS src_volunteerhub,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE source_system = 'web_intake') AS src_web_intake,
    (SELECT COUNT(*) FROM sot.person_identifiers WHERE source_system = 'atlas_ui') AS src_atlas_ui;

COMMENT ON VIEW ops.v_identity_health IS
'Single-row view with identity resolution health metrics. Covers confidence distribution,
proxy detection, freshness, multi-source tracking, and blacklist status. MIG_3019.';

\echo '   Identity health view created'


-- ============================================================================
-- SECTION F: Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Identity health dashboard:'
SELECT * FROM ops.v_identity_health;

\echo ''
\echo 'Freshness distribution (should now have spread):'
SELECT
  CASE
    WHEN last_confirmed_at >= NOW() - INTERVAL '90 days' THEN 'fresh_90d'
    WHEN last_confirmed_at >= NOW() - INTERVAL '365 days' THEN 'stale_1yr'
    ELSE 'very_stale_1yr+'
  END AS freshness,
  COUNT(*),
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM sot.person_identifiers
GROUP BY 1 ORDER BY 1;

\echo ''
\echo 'Demotion factor for known proxies (should now be < 1.0):'
SELECT sot.identifier_demotion_factor('phone', '7075436499') AS susan_phone,
       sot.identifier_demotion_factor('phone', '7074809223') AS pullman_phone,
       sot.identifier_demotion_factor('phone', '7075767999') AS ffsc_main;

\echo ''
\echo 'New blacklist entries:'
SELECT identifier_type, identifier_value, reason
FROM sot.data_engine_soft_blacklist
WHERE reason LIKE '%auto_blacklist%'
ORDER BY identifier_value;

\echo ''
\echo '=============================================='
\echo '  MIG_3019 Complete'
\echo '=============================================='
