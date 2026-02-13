-- MIG_2009: Seed Soft Blacklist with Known Org Emails
--
-- Purpose: Populate the V2 soft blacklist with known organizational emails
-- that should NOT create person records. These identifiers:
-- 1. Route to ops.clinic_accounts (pseudo-profiles) instead of sot.people
-- 2. Score at 50% weight in identity matching (if somehow matched)
--
-- Sources:
-- - V1 data_engine_soft_blacklist (MIG_888)
-- - Historical data analysis showing shared org emails
-- - FFSC staff booking emails
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2009: Seed Soft Blacklist'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FFSC ORGANIZATIONAL EMAILS
-- ============================================================================

\echo '1. Adding FFSC organizational emails...'

INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, auto_detected)
VALUES
    -- Main organizational emails
    ('email', 'info@forgottenfelines.com', 'FFSC organizational - shared inbox, 3000+ appointments', 1.0, FALSE),
    ('email', 'info@forgottenfelines.org', 'FFSC organizational - shared inbox', 1.0, FALSE),
    ('email', 'office@forgottenfelines.com', 'FFSC organizational - office shared inbox', 1.0, FALSE),
    ('email', 'contact@forgottenfelines.com', 'FFSC organizational - contact form', 1.0, FALSE),

    -- Staff booking emails (used for appointments booked on behalf of clients)
    ('email', 'sandra@forgottenfelines.com', 'FFSC staff booking email - Sandra (Clinic Coordinator)', 0.95, FALSE),
    ('email', 'addie@forgottenfelines.com', 'FFSC staff booking email - Addie (Adoption Coordinator)', 0.95, FALSE),
    ('email', 'jami@forgottenfelines.com', 'FFSC staff booking email - Jami (Admin Assistant)', 0.95, FALSE),
    ('email', 'neely@forgottenfelines.com', 'FFSC staff booking email - Neely (Foster Coordinator)', 0.95, FALSE),
    ('email', 'julia@forgottenfelines.com', 'FFSC staff booking email - Julia (Foster Coordinator)', 0.95, FALSE),
    ('email', 'kate@forgottenfelines.com', 'FFSC staff booking email - Kate (Accounting)', 0.95, FALSE),
    ('email', 'pip@forgottenfelines.com', 'FFSC staff booking email - Pip (Executive Director)', 0.95, FALSE),
    ('email', 'ben@forgottenfelines.com', 'FFSC staff booking email - Ben (Trapping Coordinator)', 0.95, FALSE),
    ('email', 'brian@forgottenfelines.com', 'FFSC staff booking email - Brian (Pick of the Litter)', 0.95, FALSE),
    ('email', 'jenniferc@forgottenfelines.com', 'FFSC staff booking email - Jennifer (Clinic Coordinator)', 0.95, FALSE),
    ('email', 'wcbc@forgottenfelines.com', 'FFSC staff booking email - Heidi (Relo Coordinator)', 0.95, FALSE),
    ('email', 'valentina@forgottenfelines.com', 'FFSC staff booking email - Valentina (Marketing)', 0.95, FALSE),
    ('email', 'bridget@forgottenfelines.com', 'FFSC staff booking email - Bridget (Volunteer Coordinator)', 0.95, FALSE),
    ('email', 'ethan@forgottenfelines.com', 'FFSC staff booking email - Ethan (Associate Clinic Coordinator)', 0.95, FALSE)
ON CONFLICT (identifier_type, identifier_norm) DO UPDATE SET
    reason = EXCLUDED.reason,
    require_name_similarity = EXCLUDED.require_name_similarity;

\echo '   Added FFSC organizational and staff booking emails'

-- ============================================================================
-- 2. PARTNER ORGANIZATION EMAILS (from MIG_888)
-- ============================================================================

\echo ''
\echo '2. Adding partner organization emails...'

INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, auto_detected)
VALUES
    -- Marin Friends of Ferals (shared by multiple people)
    ('email', 'marinferals@yahoo.com', 'Partner org: Marin Friends of Ferals - shared by Jeanie Garcia, Carlos Lopez', 0.95, TRUE),

    -- Sonoma County organizations
    ('email', 'cats@sonomacounty.org', 'Sonoma County organizational email', 0.95, TRUE),
    ('email', 'animalservices@sonomacounty.org', 'County animal services organizational', 0.95, TRUE),

    -- Petaluma Animal Services
    ('email', 'info@petalumaanimalservices.org', 'Partner org: Petaluma Animal Services', 0.95, TRUE),

    -- Sonoma Humane
    ('email', 'intake@sonomahumane.org', 'Partner org: Sonoma Humane intake', 0.95, TRUE),
    ('email', 'info@sonomahumane.org', 'Partner org: Sonoma Humane general', 0.95, TRUE),

    -- Generic org patterns
    ('email', 'cats@humanesociety.org', 'Generic humane society email', 0.95, TRUE)
ON CONFLICT (identifier_type, identifier_norm) DO UPDATE SET
    reason = EXCLUDED.reason,
    require_name_similarity = EXCLUDED.require_name_similarity;

\echo '   Added partner organization emails'

-- ============================================================================
-- 3. FFSC PHONE NUMBERS
-- ============================================================================

\echo ''
\echo '3. Adding FFSC phone numbers...'

INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, auto_detected)
VALUES
    -- Main FFSC phone
    ('phone', '7075671373', 'FFSC main office phone - shared by all staff', 1.0, FALSE),
    ('phone', '7075671374', 'FFSC secondary phone', 1.0, FALSE)
ON CONFLICT (identifier_type, identifier_norm) DO UPDATE SET
    reason = EXCLUDED.reason,
    require_name_similarity = EXCLUDED.require_name_similarity;

\echo '   Added FFSC phone numbers'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Soft blacklist entries by type:'
SELECT
    identifier_type,
    COUNT(*) as count
FROM sot.soft_blacklist
GROUP BY identifier_type
ORDER BY identifier_type;

\echo ''
\echo 'Sample blacklisted emails:'
SELECT
    identifier_norm,
    reason,
    require_name_similarity
FROM sot.soft_blacklist
WHERE identifier_type = 'email'
ORDER BY identifier_norm
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2009 Complete!'
\echo '=============================================='
\echo ''
\echo 'Seeded soft blacklist with:'
\echo '  - FFSC organizational emails (info@, office@)'
\echo '  - FFSC staff booking emails (sandra@, addie@, etc.)'
\echo '  - Partner organization emails (marinferals, sonomahumane)'
\echo '  - FFSC phone numbers'
\echo ''
\echo 'Effect: These identifiers will NOT create person records.'
\echo 'Instead, appointments will route to ops.clinic_accounts.'
\echo ''
