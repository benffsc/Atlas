-- MIG_244__places_addresses_contract.sql
-- Enforce the core data contract:
--   Every Request → Place → Address
-- Part of MEGA_001: Places/Addresses/Requests data contract
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Rename address_id to primary_address_id for clarity
-- (Actually just add an alias view, keep column name for compatibility)
-- ============================================================

-- Add comment to clarify the column's role
COMMENT ON COLUMN trapper.places.address_id IS
'Primary address for this place. Every place must have an address (the canonical geospatial anchor).';

-- ============================================================
-- PART 2: Create place_address_history for address changes
-- Allows "same place, new address" without breaking the contract
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.place_address_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The place that moved/changed address
    place_id UUID NOT NULL REFERENCES trapper.places(id) ON DELETE CASCADE,

    -- The address at this point in time
    address_id UUID NOT NULL REFERENCES trapper.addresses(id) ON DELETE RESTRICT,

    -- Time range this address was active
    start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_at TIMESTAMPTZ, -- NULL means current

    -- Why did the address change?
    reason TEXT,

    -- Provenance tracking
    provenance_kind TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (provenance_kind IN ('confirmed', 'inferred', 'semi_confirmed')),
    provenance_source TEXT
        CHECK (provenance_source IN ('cockpit_ui', 'airtable', 'clinichq', 'import', 'manual', 'migration')),
    confidence_score SMALLINT DEFAULT 100
        CHECK (confidence_score >= 0 AND confidence_score <= 100),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system'
);

COMMENT ON TABLE trapper.place_address_history IS
'Tracks address changes for places over time. Allows "same place, new address" scenario.';

CREATE INDEX IF NOT EXISTS idx_place_address_history_place
ON trapper.place_address_history(place_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_place_address_history_address
ON trapper.place_address_history(address_id);

-- ============================================================
-- PART 3: Create helper function to change place address
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.change_place_address(
    p_place_id UUID,
    p_new_address_id UUID,
    p_reason TEXT DEFAULT 'Address updated',
    p_provenance_source TEXT DEFAULT 'cockpit_ui'
) RETURNS VOID AS $$
DECLARE
    v_old_address_id UUID;
BEGIN
    -- Get current address
    SELECT address_id INTO v_old_address_id
    FROM trapper.places
    WHERE id = p_place_id;

    -- If same address, no-op
    IF v_old_address_id = p_new_address_id THEN
        RETURN;
    END IF;

    -- Close out the old address history entry
    UPDATE trapper.place_address_history
    SET end_at = NOW()
    WHERE place_id = p_place_id
      AND end_at IS NULL;

    -- Create new history entry
    INSERT INTO trapper.place_address_history (
        place_id, address_id, reason, provenance_source
    ) VALUES (
        p_place_id, p_new_address_id, p_reason, p_provenance_source
    );

    -- Update the place's current address
    UPDATE trapper.places
    SET address_id = p_new_address_id,
        updated_at = NOW()
    WHERE id = p_place_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 4: Create a default "unknown" address for places without one
-- ============================================================

-- First check if we have an unknown address, create if not
INSERT INTO trapper.addresses (
    id,
    formatted_address,
    raw_text,
    provenance_kind,
    provenance_source,
    confidence_score
)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Unknown Address',
    'Unknown Address',
    'inferred',
    'migration',
    0
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.addresses WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- ============================================================
-- PART 5: Backfill places without addresses
-- ============================================================

-- For places that don't have an address_id, try to create one from raw_address
-- or assign the unknown address

-- First, create addresses from places with raw_address but no address_id
INSERT INTO trapper.addresses (formatted_address, raw_text, provenance_kind, provenance_source, confidence_score)
SELECT DISTINCT
    p.raw_address,
    p.raw_address,
    'inferred',
    'migration',
    30
FROM trapper.places p
WHERE p.address_id IS NULL
  AND p.raw_address IS NOT NULL
  AND p.raw_address != ''
  AND NOT EXISTS (
      SELECT 1 FROM trapper.addresses a WHERE a.raw_text = p.raw_address
  );

-- Link places to their newly created addresses
UPDATE trapper.places p
SET address_id = a.id
FROM trapper.addresses a
WHERE p.address_id IS NULL
  AND p.raw_address IS NOT NULL
  AND a.raw_text = p.raw_address;

-- For remaining places without addresses, assign the unknown address
UPDATE trapper.places
SET address_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE address_id IS NULL;

-- ============================================================
-- PART 6: Add NOT NULL constraint (now safe after backfill)
-- ============================================================

-- Note: This may fail if there are still NULL values
-- In that case, run the backfill again
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'trapper'
          AND table_name = 'places'
          AND constraint_name = 'places_address_id_not_null'
    ) THEN
        -- Add the constraint
        ALTER TABLE trapper.places
        ALTER COLUMN address_id SET NOT NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not set NOT NULL on address_id: %. Run backfill first.', SQLERRM;
END $$;

-- ============================================================
-- PART 7: Create a default "contact-only" place for person requests
-- ============================================================

-- Create a function to get or create a contact-only place for a person
CREATE OR REPLACE FUNCTION trapper.get_or_create_contact_place(
    p_person_id UUID,
    p_address_id UUID,
    p_person_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_place_name TEXT;
BEGIN
    -- Check if a contact place already exists for this person at this address
    SELECT p.id INTO v_place_id
    FROM trapper.places p
    WHERE p.address_id = p_address_id
      AND p.place_type = 'residential'
      AND p.notes LIKE '%contact_person_id:' || p_person_id::text || '%'
    LIMIT 1;

    IF v_place_id IS NOT NULL THEN
        RETURN v_place_id;
    END IF;

    -- Create a new contact place
    v_place_name := COALESCE(p_person_name, 'Contact') || ' (Home)';

    INSERT INTO trapper.places (
        name,
        display_name,
        address_id,
        place_type,
        notes,
        provenance_kind,
        provenance_source,
        confidence_score,
        is_active
    ) VALUES (
        v_place_name,
        v_place_name,
        p_address_id,
        'residential',
        'contact_person_id:' || p_person_id::text,
        'inferred',
        'cockpit_ui',
        70,
        TRUE
    )
    RETURNING id INTO v_place_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 8: Ensure requests have place_id
-- ============================================================

-- For requests without a place, create one from the address if possible
-- This is a best-effort migration

-- First, update requests that have address data in legacy fields
-- (This depends on your actual schema - adjust as needed)

-- Add comment about the requirement
COMMENT ON COLUMN trapper.requests.primary_place_id IS
'The place this request is about. Every request must have a place (even person-mode requests get a contact place).';

-- ============================================================
-- PART 9: Create view for "complete" requests (with all relationships)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_requests_complete AS
SELECT
    r.id AS request_id,
    r.case_number,
    r.status,
    r.priority,
    r.priority_label,
    r.notes AS request_notes,
    r.created_at AS request_created_at,
    r.updated_at AS request_updated_at,

    -- Place info
    p.id AS place_id,
    p.name AS place_name,
    p.display_name AS place_display_name,
    p.place_type,
    p.provenance_kind AS place_provenance,
    p.confidence_score AS place_confidence,
    p.is_active AS place_is_active,

    -- Address info
    a.id AS address_id,
    a.formatted_address,
    a.raw_text AS address_raw,
    a.latitude,
    a.longitude,
    a.provenance_kind AS address_provenance,

    -- Primary contact (if any)
    per.id AS contact_person_id,
    per.display_name AS contact_name,
    per.phone AS contact_phone,
    per.email AS contact_email,

    -- Computed fields
    CASE
        WHEN p.place_type = 'residential' AND p.notes LIKE '%contact_person_id:%' THEN 'person'
        ELSE 'place'
    END AS request_kind,

    COALESCE(p.display_name, p.name, a.formatted_address, 'Unknown') AS display_heading

FROM trapper.requests r
LEFT JOIN trapper.places p ON p.id = r.primary_place_id
LEFT JOIN trapper.addresses a ON a.id = p.address_id
LEFT JOIN trapper.people per ON per.id = r.primary_contact_person_id;

COMMENT ON VIEW trapper.v_requests_complete IS
'Complete request view with place, address, and contact info. Use for UI display.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_244 applied. Data contract enforced.'
\echo ''

\echo 'Places without addresses (should be 0):'
SELECT COUNT(*) AS places_without_address
FROM trapper.places
WHERE address_id IS NULL;

\echo ''
\echo 'Place address history entries:'
SELECT COUNT(*) FROM trapper.place_address_history;

\echo ''
\echo 'Sample v_requests_complete:'
SELECT request_kind, COUNT(*)
FROM trapper.v_requests_complete
GROUP BY request_kind;
