-- MIG_2514: Staff Verification Schema
--
-- Builds on MIG_2505 (honest relationship labeling) to add:
-- 1. Extended relationship_type taxonomy for TNR-specific roles
-- 2. Verification metadata columns (verified_at, verified_by, verification_method)
-- 3. Financial commitment tracking table
-- 4. Verification function for API use
--
-- Why this matters:
-- - 10,907 person_place relationships are unverified (automated inference)
-- - Staff need to confirm "resident" vs "contact address" vs "colony caretaker"
-- - Financial commitment tracking needed ("will pay $10K" vs "food only")
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2514: Staff Verification Schema'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. EXTEND relationship_type CONSTRAINT
-- ============================================================================

\echo '1. Extending relationship_type constraint with TNR-specific roles...'

ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place ADD CONSTRAINT person_place_relationship_type_check
CHECK (relationship_type IN (
  -- Residence types
  'resident',           -- Confirmed: person lives at this address
  'property_owner',     -- Confirmed: person owns this property

  -- Colony caretaker hierarchy (Alley Cat Allies taxonomy)
  'colony_caretaker',   -- Primary caretaker: manages feeding, TNR coordination
  'colony_supervisor',  -- Oversees multiple caretakers (larger colonies)
  'feeder',             -- Feeds cats but not full caretaker

  -- Transport/logistics
  'transporter',        -- Transports cats to/from this location

  -- Referral/contact
  'referrer',           -- Referred FFSC to this location (may not live there)
  'neighbor',           -- Neighbor who reported cats

  -- Work/volunteer
  'works_at',           -- Works at this business/organization
  'volunteers_at',      -- Volunteers at this location

  -- Automated/unverified (from MIG_2505)
  'contact_address',    -- Address from booking (NOT verified residence)

  -- Legacy (kept for backward compatibility)
  'owner',              -- Legacy: same as property_owner
  'manager',            -- Legacy: property manager
  'caretaker',          -- Legacy: generic caretaker
  'requester',          -- Legacy: requested TNR service
  'trapper_at'          -- Legacy: trapper assigned to this location
));

\echo '   relationship_type constraint updated with TNR taxonomy'

-- ============================================================================
-- 2. ADD VERIFICATION METADATA COLUMNS
-- ============================================================================

\echo ''
\echo '2. Adding verification metadata columns...'

ALTER TABLE sot.person_place
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS verified_by UUID,
ADD COLUMN IF NOT EXISTS verification_method TEXT;

-- Add constraint for verification_method
ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_verification_method_check;

ALTER TABLE sot.person_place ADD CONSTRAINT person_place_verification_method_check
CHECK (verification_method IS NULL OR verification_method IN (
  'phone_call',       -- Confirmed via phone call
  'site_visit',       -- Confirmed during site visit
  'ui_button',        -- Staff clicked verify button in UI
  'import_confirmed', -- Confirmed during data import review
  'intake_form',      -- Confirmed via intake form submission
  'adopter_record'    -- Confirmed via adoption paperwork
));

-- Add foreign key for verified_by (references staff)
-- Note: Using DO block to avoid error if constraint already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'person_place_verified_by_fkey'
    AND table_schema = 'sot'
  ) THEN
    ALTER TABLE sot.person_place
    ADD CONSTRAINT person_place_verified_by_fkey
    FOREIGN KEY (verified_by) REFERENCES sot.staff(staff_id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN sot.person_place.verified_at IS 'When this relationship was verified by staff';
COMMENT ON COLUMN sot.person_place.verified_by IS 'Staff member who verified this relationship';
COMMENT ON COLUMN sot.person_place.verification_method IS 'How the relationship was verified: phone_call, site_visit, ui_button, import_confirmed, intake_form, adopter_record';

\echo '   Verification metadata columns added'

-- ============================================================================
-- 3. CREATE FINANCIAL COMMITMENT TRACKING TABLE
-- ============================================================================

\echo ''
\echo '3. Creating person_place_details table for financial commitment tracking...'

CREATE TABLE IF NOT EXISTS sot.person_place_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_place_id UUID NOT NULL,

  -- Financial commitment
  financial_commitment TEXT CHECK (financial_commitment IN (
    'full',           -- Will cover all costs
    'limited',        -- Can contribute partially
    'emergency_only', -- Only for emergencies
    'none'            -- Cannot contribute financially
  )),
  financial_amount_offered NUMERIC(10,2),  -- Specific amount if mentioned
  financial_notes TEXT,                    -- "Can pay up to $500 total"

  -- Contact preferences
  is_primary_contact BOOLEAN DEFAULT FALSE,
  preferred_contact_method TEXT CHECK (preferred_contact_method IN ('phone', 'email', 'text', 'any')),
  best_contact_time TEXT,  -- "Mornings before 10am"

  -- Additional context
  notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES sot.staff(staff_id),

  UNIQUE(person_place_id)
);

-- Add foreign key to person_place (using the id column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'person_place_details_person_place_id_fkey'
    AND table_schema = 'sot'
  ) THEN
    ALTER TABLE sot.person_place_details
    ADD CONSTRAINT person_place_details_person_place_id_fkey
    FOREIGN KEY (person_place_id) REFERENCES sot.person_place(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_person_place_details_person_place_id
ON sot.person_place_details(person_place_id);

COMMENT ON TABLE sot.person_place_details IS
'Extended details for person-place relationships including financial commitment tracking.
One record per person_place relationship (optional).

Financial commitment levels:
- full: Will cover all costs for TNR at this location
- limited: Can contribute partially (see financial_amount_offered)
- emergency_only: Will only help in emergencies
- none: Cannot contribute financially

Created by MIG_2514.';

\echo '   person_place_details table created'

-- ============================================================================
-- 4. CREATE VERIFICATION FUNCTION
-- ============================================================================

\echo ''
\echo '4. Creating verification function...'

CREATE OR REPLACE FUNCTION sot.verify_person_place(
  p_person_place_id UUID,
  p_verified_by UUID,
  p_method TEXT,
  p_relationship_type TEXT DEFAULT NULL,
  p_financial_commitment TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_old_type TEXT;
  v_new_type TEXT;
  v_result JSONB;
BEGIN
  -- Validate person_place exists
  IF NOT EXISTS (SELECT 1 FROM sot.person_place WHERE id = p_person_place_id) THEN
    RAISE EXCEPTION 'person_place not found: %', p_person_place_id;
  END IF;

  -- Get current relationship type
  SELECT relationship_type INTO v_old_type
  FROM sot.person_place
  WHERE id = p_person_place_id;

  -- Determine new relationship type
  v_new_type := COALESCE(p_relationship_type, v_old_type);

  -- Update verification status
  UPDATE sot.person_place
  SET is_staff_verified = TRUE,
      verified_at = NOW(),
      verified_by = p_verified_by,
      verification_method = p_method,
      relationship_type = v_new_type
  WHERE id = p_person_place_id;

  -- Upsert financial commitment if provided
  IF p_financial_commitment IS NOT NULL OR p_notes IS NOT NULL THEN
    INSERT INTO sot.person_place_details (person_place_id, financial_commitment, notes, created_by)
    VALUES (p_person_place_id, p_financial_commitment, p_notes, p_verified_by)
    ON CONFLICT (person_place_id) DO UPDATE
    SET financial_commitment = COALESCE(EXCLUDED.financial_commitment, sot.person_place_details.financial_commitment),
        notes = COALESCE(EXCLUDED.notes, sot.person_place_details.notes),
        updated_at = NOW();
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'success', TRUE,
    'person_place_id', p_person_place_id,
    'old_relationship_type', v_old_type,
    'new_relationship_type', v_new_type,
    'verified_at', NOW(),
    'verification_method', p_method
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.verify_person_place IS
'Verifies a person-place relationship with optional role update and financial commitment tracking.

Parameters:
  p_person_place_id: The ID of the person_place record to verify
  p_verified_by: Staff UUID who is verifying
  p_method: How verified (phone_call, site_visit, ui_button, etc.)
  p_relationship_type: Optional new role (resident, colony_caretaker, etc.)
  p_financial_commitment: Optional commitment level (full, limited, emergency_only, none)
  p_notes: Optional notes about the relationship

Returns JSONB with verification details.

Example:
  SELECT sot.verify_person_place(
    ''abc-123'',
    ''staff-uuid'',
    ''phone_call'',
    ''colony_caretaker'',
    ''limited'',
    ''Can contribute $200/month for food''
  );

Created by MIG_2514.';

\echo '   verify_person_place function created'

-- ============================================================================
-- 5. CREATE VIEW FOR VERIFICATION QUEUE
-- ============================================================================

\echo ''
\echo '5. Creating verification queue view...'

CREATE OR REPLACE VIEW sot.v_person_place_verification_queue AS
SELECT
  pp.id as person_place_id,
  pp.person_id,
  pp.place_id,
  pp.relationship_type,
  pp.is_staff_verified,
  pp.verified_at,
  pp.verification_method,
  pp.evidence_type,
  pp.source_system,
  pp.confidence,
  pp.created_at,

  -- Person details
  p.display_name as person_name,
  p.first_name,
  p.last_name,

  -- Place details
  pl.display_name as place_name,
  pl.formatted_address,

  -- Financial details (if exists)
  ppd.financial_commitment,
  ppd.is_primary_contact,

  -- Linked entities count
  (SELECT COUNT(*) FROM sot.person_cat_relationships pcr WHERE pcr.person_id = pp.person_id) as cat_count,

  -- Priority score (higher = more important to verify)
  CASE
    WHEN pp.relationship_type = 'contact_address' THEN 10
    WHEN pp.relationship_type IN ('resident', 'colony_caretaker') THEN 8
    WHEN pp.evidence_type = 'person_relationship' THEN 5
    ELSE 3
  END as verification_priority

FROM sot.person_place pp
JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id

WHERE pp.is_staff_verified = FALSE
ORDER BY verification_priority DESC, pp.created_at DESC;

COMMENT ON VIEW sot.v_person_place_verification_queue IS
'Queue of person-place relationships awaiting staff verification.
Ordered by priority (contact_address most important to verify).

Created by MIG_2514.';

\echo '   Verification queue view created'

-- ============================================================================
-- 6. CREATE HELPER FUNCTIONS
-- ============================================================================

\echo ''
\echo '6. Creating helper functions...'

-- Get all people at a place with verification status
CREATE OR REPLACE FUNCTION sot.get_people_at_place(p_place_id UUID)
RETURNS TABLE(
  person_place_id UUID,
  person_id UUID,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  relationship_type TEXT,
  is_staff_verified BOOLEAN,
  verified_at TIMESTAMPTZ,
  verification_method TEXT,
  financial_commitment TEXT,
  is_primary_contact BOOLEAN,
  cat_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id as person_place_id,
    pp.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    pp.relationship_type,
    pp.is_staff_verified,
    pp.verified_at,
    pp.verification_method,
    ppd.financial_commitment,
    COALESCE(ppd.is_primary_contact, FALSE) as is_primary_contact,
    (SELECT COUNT(*) FROM sot.person_cat_relationships pcr WHERE pcr.person_id = pp.person_id) as cat_count
  FROM sot.person_place pp
  JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
  LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id
  WHERE pp.place_id = p_place_id
  ORDER BY
    COALESCE(ppd.is_primary_contact, FALSE) DESC,
    pp.is_staff_verified DESC,
    pp.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Get all places for a person with verification status
CREATE OR REPLACE FUNCTION sot.get_places_for_person(p_person_id UUID)
RETURNS TABLE(
  person_place_id UUID,
  place_id UUID,
  display_name TEXT,
  formatted_address TEXT,
  relationship_type TEXT,
  is_staff_verified BOOLEAN,
  verified_at TIMESTAMPTZ,
  verification_method TEXT,
  financial_commitment TEXT,
  is_primary_contact BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id as person_place_id,
    pp.place_id,
    pl.display_name,
    pl.formatted_address,
    pp.relationship_type,
    pp.is_staff_verified,
    pp.verified_at,
    pp.verification_method,
    ppd.financial_commitment,
    COALESCE(ppd.is_primary_contact, FALSE) as is_primary_contact
  FROM sot.person_place pp
  JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
  LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id
  WHERE pp.person_id = p_person_id
  ORDER BY
    COALESCE(ppd.is_primary_contact, FALSE) DESC,
    pp.is_staff_verified DESC,
    pp.created_at DESC;
END;
$$ LANGUAGE plpgsql;

\echo '   Helper functions created'

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '7a. person_place columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'person_place'
ORDER BY ordinal_position;

\echo ''
\echo '7b. person_place_details table:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'person_place_details'
ORDER BY ordinal_position;

\echo ''
\echo '7c. Verification queue preview:'
SELECT
  relationship_type,
  is_staff_verified,
  verification_priority,
  COUNT(*) as count
FROM sot.v_person_place_verification_queue
GROUP BY relationship_type, is_staff_verified, verification_priority
ORDER BY verification_priority DESC, count DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2514 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'CREATED:'
\echo '  - Extended relationship_type constraint with TNR taxonomy'
\echo '  - Added verification metadata columns (verified_at, verified_by, verification_method)'
\echo '  - Created sot.person_place_details table for financial commitment tracking'
\echo '  - Created sot.verify_person_place() function'
\echo '  - Created sot.v_person_place_verification_queue view'
\echo '  - Created sot.get_people_at_place() helper function'
\echo '  - Created sot.get_places_for_person() helper function'
\echo ''
\echo 'NEXT: Create API endpoints and UI components for verification workflow.'
\echo ''
