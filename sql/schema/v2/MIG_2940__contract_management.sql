BEGIN;

-- MIG_2940: Contract Management (FFS-569)
-- Adds renewal chain, create function, and expiration checker for ops.trapper_contracts

-- 1. Add renewed_from_contract_id for contract renewal chains
ALTER TABLE ops.trapper_contracts
ADD COLUMN IF NOT EXISTS renewed_from_contract_id UUID REFERENCES ops.trapper_contracts(contract_id);

-- 2. Create function to create a contract and sync trapper_profiles
CREATE OR REPLACE FUNCTION ops.create_trapper_contract(
  p_person_id UUID,
  p_contract_type TEXT,
  p_signed_date DATE DEFAULT CURRENT_DATE,
  p_expiration_date DATE DEFAULT NULL,
  p_service_area_description TEXT DEFAULT NULL,
  p_service_place_ids UUID[] DEFAULT NULL,
  p_contract_notes TEXT DEFAULT NULL,
  p_renewed_from_contract_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_contract_id UUID;
BEGIN
  -- Validate contract type
  IF p_contract_type NOT IN ('ffsc_volunteer', 'community_limited', 'colony_caretaker', 'rescue_partnership') THEN
    RAISE EXCEPTION 'Invalid contract_type: %', p_contract_type;
  END IF;

  -- Insert the contract
  INSERT INTO ops.trapper_contracts (
    person_id, contract_type, signed_date, expiration_date,
    service_area_description, service_place_ids, contract_notes,
    renewed_from_contract_id, status, source_system
  ) VALUES (
    p_person_id, p_contract_type, p_signed_date, p_expiration_date,
    p_service_area_description, p_service_place_ids, p_contract_notes,
    p_renewed_from_contract_id, 'active', 'atlas_ui'
  )
  RETURNING contract_id INTO v_contract_id;

  -- Sync has_signed_contract + contract_signed_date on trapper_profiles
  UPDATE sot.trapper_profiles
  SET has_signed_contract = TRUE,
      contract_signed_date = p_signed_date,
      updated_at = NOW()
  WHERE person_id = p_person_id;

  -- If no trapper_profiles row exists, create one
  IF NOT FOUND THEN
    INSERT INTO sot.trapper_profiles (person_id, has_signed_contract, contract_signed_date, source_system)
    VALUES (p_person_id, TRUE, p_signed_date, 'atlas_ui')
    ON CONFLICT (person_id) DO UPDATE SET
      has_signed_contract = TRUE,
      contract_signed_date = p_signed_date,
      updated_at = NOW();
  END IF;

  RETURN v_contract_id;
END;
$$;

-- 3. Create function to check expiring contracts
CREATE OR REPLACE FUNCTION ops.check_expiring_contracts(
  p_days_ahead INT DEFAULT 30
) RETURNS TABLE (
  contract_id UUID,
  person_id UUID,
  display_name TEXT,
  contract_type TEXT,
  status TEXT,
  signed_date DATE,
  expiration_date DATE,
  days_until_expiry INT,
  is_expired BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT
    tc.contract_id,
    tc.person_id,
    p.display_name,
    tc.contract_type,
    tc.status,
    tc.signed_date,
    tc.expiration_date,
    (tc.expiration_date - CURRENT_DATE)::int AS days_until_expiry,
    tc.expiration_date < CURRENT_DATE AS is_expired
  FROM ops.trapper_contracts tc
  JOIN sot.people p ON p.person_id = tc.person_id
  WHERE tc.status = 'active'
    AND tc.expiration_date IS NOT NULL
    AND tc.expiration_date <= CURRENT_DATE + p_days_ahead
    AND p.merged_into_person_id IS NULL
  ORDER BY tc.expiration_date ASC;
$$;

COMMIT;
