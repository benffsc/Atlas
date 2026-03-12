-- MIG_2911: Person Slots Parity for Property Owner & Site Contact
-- FFS-443b: Give property owner and site contact the same person creation
-- pipeline as the requestor (email field, person_id storage, dedup).
--
-- Changes:
--   1a. Add property_owner_person_id FK on ops.requests
--   1b. Add raw site contact fields (matching raw_requester_* pattern)
--   1c. Add raw_property_owner_email (phone already exists)
--   1d. Add 'site_contact' to person_place relationship_type CHECK

BEGIN;

-- 1a. Property owner person_id FK
ALTER TABLE ops.requests
  ADD COLUMN IF NOT EXISTS property_owner_person_id UUID REFERENCES sot.people(person_id);

-- 1b. Raw site contact fields (matches raw_requester_* pattern)
ALTER TABLE ops.requests
  ADD COLUMN IF NOT EXISTS raw_site_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS raw_site_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS raw_site_contact_email TEXT;

-- 1c. Raw property owner email (phone already exists as property_owner_phone)
ALTER TABLE ops.requests
  ADD COLUMN IF NOT EXISTS raw_property_owner_email TEXT;

-- 1d. Add 'site_contact' to person_place CHECK (currently missing, INSERT silently fails)
-- Note: sot.person_place is the base table; sot.person_place_relationships is a view
ALTER TABLE sot.person_place
  DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place
  ADD CONSTRAINT person_place_relationship_type_check
  CHECK (relationship_type IN (
    'resident', 'property_owner', 'landlord', 'property_manager',
    'colony_caretaker', 'colony_supervisor', 'feeder',
    'transporter', 'referrer', 'neighbor', 'site_contact',
    'works_at', 'volunteers_at', 'contact_address',
    'owner', 'manager', 'caretaker', 'requester', 'trapper_at'
  ));

COMMIT;
