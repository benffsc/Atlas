-- ============================================================================
-- MIG_3001: Booking Role on clinic_accounts (Phase 1E — Long-Term Strategy)
-- ============================================================================
-- Problem: ops.clinic_accounts.account_type classifies the NAME format
-- (org, site_name, address, partial_name, unknown) but doesn't capture the
-- booking ROLE — i.e., what role the person plays when booking appointments.
--
-- A "real person" name (account_type = 'unknown') could be a trapper,
-- caretaker, rescue operator, or resident. This role determines whether
-- person→cat linking should happen (skip for trappers/orgs — they brought
-- the cat, they don't live with it).
--
-- FFS-901
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_3001: Booking Role on clinic_accounts'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Add booking_role column
-- ============================================================================

\echo '1. Adding booking_role column to ops.clinic_accounts...'

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS booking_role TEXT
  CHECK (booking_role IN (
    'resident',            -- Regular resident/owner (default assumption)
    'colony_caretaker',    -- Manages a colony
    'community_trapper',   -- Community trapper (Tier 2/3)
    'rescue_operator',     -- Runs a home-based rescue
    'organization',        -- Known org (shelter, rescue, vet clinic)
    'site_name',           -- Trapping site name
    'ffsc_staff'           -- FFSC staff booking on behalf of others
  ));

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS booking_role_source TEXT
  CHECK (booking_role_source IN (
    'account_type',     -- Inferred from account_type (org, site_name)
    'trapper_profile',  -- Matched to sot.trapper_profiles
    'soft_blacklist',   -- Email/phone on soft blacklist
    'volume_heuristic', -- High-volume booking pattern (>10 cats)
    'staff_override',   -- Manually set by staff
    'default'           -- Default assignment (resident)
  ));

CREATE INDEX IF NOT EXISTS idx_clinic_accounts_booking_role
  ON ops.clinic_accounts(booking_role)
  WHERE booking_role IS NOT NULL;

\echo '   Added booking_role + booking_role_source columns'

-- ============================================================================
-- 2. Populate from existing data patterns
-- ============================================================================

\echo ''
\echo '2. Populating booking_role from existing data...'

-- Step 2a: Organization and site_name accounts (direct from account_type)
UPDATE ops.clinic_accounts SET
  booking_role = account_type,
  booking_role_source = 'account_type'
WHERE account_type IN ('organization', 'site_name')
  AND booking_role IS NULL;

\echo '   2a: Set role for organization/site_name accounts'

-- Step 2b: Match to trapper profiles
UPDATE ops.clinic_accounts ca SET
  booking_role = 'community_trapper',
  booking_role_source = 'trapper_profile'
FROM sot.trapper_profiles tp
WHERE ca.resolved_person_id = tp.person_id
  AND ca.booking_role IS NULL;

\echo '   2b: Set role for matched trapper profiles'

-- Step 2c: FFSC staff (soft-blacklisted FFSC emails)
UPDATE ops.clinic_accounts ca SET
  booking_role = 'ffsc_staff',
  booking_role_source = 'soft_blacklist'
WHERE EXISTS (
  SELECT 1 FROM sot.soft_blacklist sb
  WHERE sb.identifier_type = 'email'
    AND sb.identifier_norm = LOWER(TRIM(ca.owner_email))
    AND sb.reason ILIKE '%ffsc%staff%'
)
AND ca.booking_role IS NULL;

\echo '   2c: Set role for FFSC staff emails'

-- Step 2d: High-volume bookers (>10 distinct cats → likely caretaker)
UPDATE ops.clinic_accounts ca SET
  booking_role = 'colony_caretaker',
  booking_role_source = 'volume_heuristic'
WHERE ca.cat_count > 10
  AND ca.account_type NOT IN ('organization', 'site_name')
  AND ca.booking_role IS NULL;

\echo '   2d: Set role for high-volume bookers (>10 cats)'

-- Step 2e: Default remaining to resident
UPDATE ops.clinic_accounts SET
  booking_role = 'resident',
  booking_role_source = 'default'
WHERE booking_role IS NULL
  AND account_type NOT IN ('address', 'partial_name');

\echo '   2e: Defaulted remaining to resident'

-- ============================================================================
-- 3. Summary
-- ============================================================================

\echo ''
\echo '3. Booking role distribution:'

SELECT
  booking_role,
  booking_role_source,
  COUNT(*) AS count
FROM ops.clinic_accounts
WHERE booking_role IS NOT NULL
GROUP BY booking_role, booking_role_source
ORDER BY count DESC;

-- ============================================================================
-- 4. Verification
-- ============================================================================

\echo ''
\echo '4. Verifying column exists...'

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops'
  AND table_name = 'clinic_accounts'
  AND column_name IN ('booking_role', 'booking_role_source');

\echo ''
\echo '================================================'
\echo '  MIG_3001 Complete (FFS-901)'
\echo '================================================'
\echo ''
\echo 'Added:'
\echo '  - ops.clinic_accounts.booking_role — role classification'
\echo '  - ops.clinic_accounts.booking_role_source — how role was determined'
\echo '  - Populated from account_type, trapper_profiles, soft_blacklist, volume'
\echo ''
\echo 'Use booking_role to gate entity linking:'
\echo '  Skip person->cat linking when booking_role IN'
\echo '  (community_trapper, organization, ffsc_staff, site_name)'
\echo ''
