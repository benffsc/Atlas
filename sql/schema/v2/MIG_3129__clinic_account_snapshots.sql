-- MIG_3129: ClinicHQ ownership snapshot tracking (FFS-1464)
-- When clinic account contact info changes between batches, capture the PREVIOUS
-- state before overwriting. Enables Tippy to surface "ownership transferred" context.

CREATE TABLE IF NOT EXISTS ops.clinic_account_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES ops.clinic_accounts(account_id),
  batch_id UUID,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  display_name TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  owner_address TEXT,
  change_detected BOOLEAN DEFAULT FALSE,
  change_fields TEXT[] -- which fields changed from previous snapshot
);

CREATE INDEX IF NOT EXISTS idx_clinic_account_snapshots_account
  ON ops.clinic_account_snapshots (account_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_account_snapshots_changes
  ON ops.clinic_account_snapshots (account_id)
  WHERE change_detected = TRUE;

-- Function to snapshot an account before update, detecting changes
CREATE OR REPLACE FUNCTION ops.snapshot_clinic_account_if_changed(
  p_account_id UUID,
  p_new_first TEXT DEFAULT NULL,
  p_new_last TEXT DEFAULT NULL,
  p_new_email TEXT DEFAULT NULL,
  p_new_phone TEXT DEFAULT NULL,
  p_new_address TEXT DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_current RECORD;
  v_changed_fields TEXT[] := '{}';
  v_any_change BOOLEAN := FALSE;
BEGIN
  SELECT owner_first_name, owner_last_name, owner_email, owner_phone, owner_address
  INTO v_current
  FROM ops.clinic_accounts
  WHERE account_id = p_account_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Compare each field (case-insensitive, null-safe)
  IF LOWER(COALESCE(v_current.owner_first_name, '')) != LOWER(COALESCE(p_new_first, ''))
     AND p_new_first IS NOT NULL THEN
    v_changed_fields := array_append(v_changed_fields, 'first_name');
  END IF;

  IF LOWER(COALESCE(v_current.owner_last_name, '')) != LOWER(COALESCE(p_new_last, ''))
     AND p_new_last IS NOT NULL THEN
    v_changed_fields := array_append(v_changed_fields, 'last_name');
  END IF;

  IF LOWER(COALESCE(v_current.owner_email, '')) != LOWER(COALESCE(p_new_email, ''))
     AND p_new_email IS NOT NULL THEN
    v_changed_fields := array_append(v_changed_fields, 'email');
  END IF;

  IF COALESCE(v_current.owner_phone, '') != COALESCE(p_new_phone, '')
     AND p_new_phone IS NOT NULL THEN
    v_changed_fields := array_append(v_changed_fields, 'phone');
  END IF;

  IF LOWER(COALESCE(v_current.owner_address, '')) != LOWER(COALESCE(p_new_address, ''))
     AND p_new_address IS NOT NULL THEN
    v_changed_fields := array_append(v_changed_fields, 'address');
  END IF;

  v_any_change := array_length(v_changed_fields, 1) > 0;

  -- Only snapshot if something actually changed
  IF v_any_change THEN
    INSERT INTO ops.clinic_account_snapshots (
      account_id, batch_id, display_name,
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      change_detected, change_fields
    ) VALUES (
      p_account_id, p_batch_id,
      TRIM(COALESCE(v_current.owner_first_name, '') || ' ' || COALESCE(v_current.owner_last_name, '')),
      v_current.owner_first_name, v_current.owner_last_name,
      v_current.owner_email, v_current.owner_phone, v_current.owner_address,
      TRUE, v_changed_fields
    );
  END IF;

  RETURN v_any_change;
END;
$$;
