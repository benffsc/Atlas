-- MIG_2002: V2 OPS Layer Enhancements
--
-- Purpose: Enhance OPS layer to preserve messy owner data while linking to SOT
-- This is Layer 2 of the 3-layer architecture (Source → OPS → SOT)
--
-- Key principle: OPS is "usable and cleaned but not too cleaned"
-- - Keeps messy owner_first_name, owner_last_name for ClinicHQ lookup
-- - Enables change detection (when owner name differs between appointments)
-- - Links to sot.* via resolved_*_id columns

\echo ''
\echo '=============================================='
\echo '  MIG_2002: OPS Layer Enhancements'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ENHANCE OPS.APPOINTMENTS
-- ============================================================================

\echo '1. Enhancing ops.appointments...'

-- Add columns for raw owner data preservation
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS owner_raw_payload JSONB;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS source_raw_id UUID;

-- Add resolution tracking
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS resolution_status TEXT
    CHECK (resolution_status IN ('pending', 'auto_linked', 'manual_linked', 'pseudo_profile', 'unresolvable'));
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Default pending for new records
ALTER TABLE ops.appointments ALTER COLUMN resolution_status SET DEFAULT 'pending';

-- Index for unresolved appointments
CREATE INDEX IF NOT EXISTS idx_ops_appointments_unresolved
    ON ops.appointments(resolution_status)
    WHERE resolution_status = 'pending';

-- Comments explaining column purposes
COMMENT ON COLUMN ops.appointments.owner_first_name IS
'Raw owner first name from ClinicHQ.
May be site name like "Silveira Ranch" or "5403 San Antonio Road".
PRESERVED for ClinicHQ lookup and change detection.';

COMMENT ON COLUMN ops.appointments.owner_last_name IS
'Raw owner last name from ClinicHQ.
May contain persons full name when first_name has site name.
PRESERVED for ClinicHQ lookup.';

COMMENT ON COLUMN ops.appointments.owner_raw_payload IS
'Full original owner_info JSON from ClinicHQ export.
Reference for debugging and audit trail.';

COMMENT ON COLUMN ops.appointments.source_raw_id IS
'Link to source.clinichq_raw for full audit trail.';

COMMENT ON COLUMN ops.appointments.resolution_status IS
'Status of identity resolution:
- pending: Not yet processed
- auto_linked: Automatically linked to sot.people
- manual_linked: Staff manually linked
- pseudo_profile: Classified as org/site, linked to ops.clinic_accounts
- unresolvable: Could not resolve (no identifiers, garbage data)';

COMMENT ON COLUMN ops.appointments.resolved_person_id IS
'Link to sot.people after identity resolution.
NULL if pseudo_profile (org/site name) or unresolvable.';

\echo '   Enhanced ops.appointments with owner_raw_payload, source_raw_id, resolution_status'

-- ============================================================================
-- 2. CREATE OPS.CLINIC_ACCOUNTS
-- ============================================================================

\echo ''
\echo '2. Creating ops.clinic_accounts...'

CREATE TABLE IF NOT EXISTS ops.clinic_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Raw ClinicHQ data (preserved exactly as received)
    owner_first_name TEXT,
    owner_last_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    owner_address TEXT,
    owner_city TEXT,
    owner_zip TEXT,

    -- Composite display name
    display_name TEXT GENERATED ALWAYS AS (
        TRIM(COALESCE(owner_first_name, '') || ' ' || COALESCE(owner_last_name, ''))
    ) STORED,

    -- Classification
    account_type TEXT NOT NULL CHECK (account_type IN (
        'organization',    -- Known org (shelter, rescue, vet clinic)
        'site_name',       -- Trapping site name (Silveira Ranch, etc.)
        'address',         -- Address as name (5403 San Antonio Road)
        'partial_name',    -- First name only, no identifiers
        'unknown'          -- Unclassified
    )),
    classification_reason TEXT,
    classification_confidence NUMERIC(3,2) DEFAULT 0.8,

    -- Link to real entity if later resolved by staff
    resolved_person_id UUID REFERENCES sot.people(person_id),
    resolved_place_id UUID REFERENCES sot.places(place_id),
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,

    -- Statistics
    appointment_count INTEGER DEFAULT 1,
    cat_count INTEGER DEFAULT 0,
    first_appointment_date DATE,
    last_appointment_date DATE,

    -- Provenance
    source_system TEXT DEFAULT 'clinichq',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lookup
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_name
    ON ops.clinic_accounts(owner_first_name, owner_last_name);
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_email
    ON ops.clinic_accounts(owner_email) WHERE owner_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_phone
    ON ops.clinic_accounts(owner_phone) WHERE owner_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_type
    ON ops.clinic_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_unresolved
    ON ops.clinic_accounts(account_type)
    WHERE resolved_person_id IS NULL;

COMMENT ON TABLE ops.clinic_accounts IS
'OPS Layer: Pseudo-profiles from ClinicHQ that are NOT real people.
Stores org names, site names, addresses-as-names, etc.
These are kept separate from sot.people to maintain clean SOT data.

Examples:
- "Silveira Ranch" / "Toni Price" (site_name)
- "SCAS" / "" (organization)
- "5403 San Antonio Road" / "Petaluma" (address)
- "Maria" / "" (partial_name - first name only, no identifiers)

Can be later resolved to real sot.people or sot.places by staff.';

\echo '   Created ops.clinic_accounts'

-- ============================================================================
-- 3. ENHANCE OPS.INTAKE_SUBMISSIONS
-- ============================================================================

\echo ''
\echo '3. Enhancing ops.intake_submissions...'

-- Add source raw link
ALTER TABLE ops.intake_submissions ADD COLUMN IF NOT EXISTS source_raw_id UUID;

-- Add resolution tracking
ALTER TABLE ops.intake_submissions ADD COLUMN IF NOT EXISTS resolution_status TEXT
    CHECK (resolution_status IN ('pending', 'auto_linked', 'manual_linked', 'converted', 'rejected'));
ALTER TABLE ops.intake_submissions ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

ALTER TABLE ops.intake_submissions ALTER COLUMN resolution_status SET DEFAULT 'pending';

COMMENT ON COLUMN ops.intake_submissions.source_raw_id IS
'Link to source.web_intake_raw for full audit trail.';

COMMENT ON COLUMN ops.intake_submissions.resolution_status IS
'Status of intake processing:
- pending: Not yet processed
- auto_linked: Person/place auto-linked
- manual_linked: Staff manually linked
- converted: Converted to ops.request
- rejected: Rejected (spam, duplicate, etc.)';

\echo '   Enhanced ops.intake_submissions'

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

\echo ''
\echo '4. Creating helper functions...'

-- Function to upsert clinic account
CREATE OR REPLACE FUNCTION ops.upsert_clinic_account(
    p_owner_first_name TEXT,
    p_owner_last_name TEXT,
    p_owner_email TEXT DEFAULT NULL,
    p_owner_phone TEXT DEFAULT NULL,
    p_owner_address TEXT DEFAULT NULL,
    p_account_type TEXT DEFAULT 'unknown',
    p_classification_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_account_id UUID;
BEGIN
    -- Try to find existing account by name + email/phone
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE owner_first_name = p_owner_first_name
      AND owner_last_name = p_owner_last_name
      AND (owner_email = p_owner_email OR (owner_email IS NULL AND p_owner_email IS NULL))
    LIMIT 1;

    IF v_account_id IS NOT NULL THEN
        -- Update existing
        UPDATE ops.clinic_accounts
        SET appointment_count = appointment_count + 1,
            last_seen_at = NOW(),
            last_appointment_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE account_id = v_account_id;

        RETURN v_account_id;
    END IF;

    -- Create new
    INSERT INTO ops.clinic_accounts (
        owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
        account_type, classification_reason,
        first_appointment_date, last_appointment_date
    ) VALUES (
        p_owner_first_name, p_owner_last_name, p_owner_email, p_owner_phone, p_owner_address,
        p_account_type, p_classification_reason,
        CURRENT_DATE, CURRENT_DATE
    )
    RETURNING account_id INTO v_account_id;

    RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION ops.upsert_clinic_account IS
'Upserts a clinic account (pseudo-profile).
Returns existing account_id if found, creates new if not.
Increments appointment_count on existing accounts.';

-- Function to link appointment to clinic account
CREATE OR REPLACE FUNCTION ops.link_appointment_to_clinic_account(
    p_appointment_id UUID,
    p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE ops.appointments
    SET resolution_status = 'pseudo_profile',
        resolution_notes = 'Linked to clinic_account ' || p_account_id::TEXT,
        resolved_at = NOW()
    WHERE appointment_id = p_appointment_id;

    -- Update cat count on clinic account
    UPDATE ops.clinic_accounts
    SET cat_count = (
        SELECT COUNT(DISTINCT cat_id)
        FROM ops.appointments a
        WHERE a.resolution_status = 'pseudo_profile'
          AND a.resolution_notes LIKE '%' || p_account_id::TEXT || '%'
    )
    WHERE account_id = p_account_id;
END;
$$;

\echo '   Created helper functions'

-- ============================================================================
-- 5. VIEWS FOR UNRESOLVED DATA
-- ============================================================================

\echo ''
\echo '5. Creating views...'

CREATE OR REPLACE VIEW ops.v_unresolved_appointments AS
SELECT
    a.appointment_id,
    a.clinichq_appointment_id,
    a.appointment_date,
    a.owner_first_name,
    a.owner_last_name,
    a.owner_email,
    a.owner_phone,
    sot.classify_owner_name(a.owner_first_name, a.owner_last_name) AS classification,
    a.cat_id,
    c.name AS cat_name,
    a.created_at
FROM ops.appointments a
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
WHERE a.resolution_status = 'pending'
   OR a.resolution_status IS NULL
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW ops.v_unresolved_appointments IS
'Appointments pending identity resolution.
Use classification column to determine routing:
- person → sot.people
- organization/site_name/address → ops.clinic_accounts';

\echo '   Created ops.v_unresolved_appointments'

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ops.appointments new columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'appointments'
  AND column_name IN ('owner_raw_payload', 'source_raw_id', 'resolution_status', 'resolution_notes', 'resolved_at')
ORDER BY column_name;

\echo ''
\echo 'ops.clinic_accounts columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'clinic_accounts'
ORDER BY ordinal_position;

\echo ''
\echo '=============================================='
\echo '  MIG_2002 Complete'
\echo '=============================================='
\echo ''
\echo 'Enhanced OPS Layer:'
\echo '  - ops.appointments: Added owner_raw_payload, source_raw_id, resolution_status'
\echo '  - ops.clinic_accounts: NEW table for pseudo-profiles (orgs, sites, addresses)'
\echo '  - ops.intake_submissions: Added source_raw_id, resolution_status'
\echo ''
\echo 'Key Principle: OPS keeps messy data for:'
\echo '  1. ClinicHQ lookup (find by original owner name)'
\echo '  2. Change detection (owner name changed between appointments)'
\echo '  3. Reference for staff review'
\echo ''
\echo 'SOT remains clean - only real people in sot.people'
\echo ''
