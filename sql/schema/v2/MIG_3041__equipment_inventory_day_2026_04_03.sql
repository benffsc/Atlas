-- MIG_3041: Equipment Inventory Day — Ground Truth Reset (2026-04-03)
--
-- Ben physically audited all equipment. This migration aligns the database
-- with physical reality:
--
-- 1. Any checked-out trap that's actually on the shelf → check_in event
-- 2. Traps confirmed on shelf → verified as available
-- 3. Known checkouts → check_out events with contact info
-- 4. Everything else available but not confirmed → mark missing
--
-- Uses the equipment event trigger for state management.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Check in ALL traps currently marked checked_out that are on the shelf
-- ═══════════════════════════════════════════════════════════════════════════════
-- These 13 barcodes are physically confirmed on the shelf right now.

INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
SELECT equipment_id, 'check_in', 'Inventory Day 2026-04-03: confirmed on shelf', 'atlas_ui'
FROM ops.equipment
WHERE barcode IN ('0205','0218','0224','0178','0146','0157','0207','0200','0144','0221','0164','0155','0152')
  AND custody_status = 'checked_out'
  AND retired_at IS NULL;

-- Also ensure any that are "missing" but actually here get found
INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
SELECT equipment_id, 'found', 'Inventory Day 2026-04-03: found on shelf', 'atlas_ui'
FROM ops.equipment
WHERE barcode IN ('0205','0218','0224','0178','0146','0157','0207','0200','0144','0221','0164','0155','0152')
  AND custody_status = 'missing'
  AND retired_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Create/find people for known checkouts, then record checkout events
-- ═══════════════════════════════════════════════════════════════════════════════

-- First, check in any of these traps if they're currently checked out to someone else
-- (stale checkout from before — we're reassigning to the actual current holder)
INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
SELECT equipment_id, 'check_in', 'Inventory Day 2026-04-03: clearing stale checkout before reassignment', 'atlas_ui'
FROM ops.equipment
WHERE barcode IN ('0176','0208','0203','0121','0216','0192')
  AND custody_status = 'checked_out'
  AND retired_at IS NULL;

-- Also handle if any are missing
INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
SELECT equipment_id, 'found', 'Inventory Day 2026-04-03: found — being checked out to current holder', 'atlas_ui'
FROM ops.equipment
WHERE barcode IN ('0176','0208','0203','0121','0216','0192')
  AND custody_status = 'missing'
  AND retired_at IS NULL;

-- ── Rebecca Sarino → trap 0176 ──────────────────────────────────────────────
-- Phone: 707-892-3215, Email: rebeccasatthewell@gmail.com
-- Address: 2173 Bohemian Hwy, Occidental, CA 95465

DO $$
DECLARE
  v_person_id UUID;
  v_equip_id UUID;
BEGIN
  -- Find or create person
  v_person_id := sot.find_or_create_person(
    p_email := 'rebeccasatthewell@gmail.com',
    p_phone := '7078923215',
    p_first_name := 'Rebecca',
    p_last_name := 'Sarino',
    p_source_system := 'atlas_ui'
  );

  SELECT equipment_id INTO v_equip_id FROM ops.equipment WHERE barcode = '0176' AND retired_at IS NULL;

  IF v_equip_id IS NOT NULL THEN
    INSERT INTO ops.equipment_events (
      equipment_id, event_type, custodian_person_id, custodian_name,
      checkout_type, notes, source_system
    ) VALUES (
      v_equip_id, 'check_out', v_person_id, 'Rebecca Sarino',
      'public', 'Inventory Day 2026-04-03: confirmed checkout', 'atlas_ui'
    );
  END IF;
END $$;

-- ── Deborah Delew → trap 0208 ───────────────────────────────────────────────
-- Phone: 707-569-4341, Email: magnolia59@outlook.com
-- Address: 768 Carlita Cir, Rohnert Park, CA 94928

DO $$
DECLARE
  v_person_id UUID;
  v_equip_id UUID;
BEGIN
  v_person_id := sot.find_or_create_person(
    p_email := 'magnolia59@outlook.com',
    p_phone := '7075694341',
    p_first_name := 'Deborah',
    p_last_name := 'Delew',
    p_source_system := 'atlas_ui'
  );

  SELECT equipment_id INTO v_equip_id FROM ops.equipment WHERE barcode = '0208' AND retired_at IS NULL;

  IF v_equip_id IS NOT NULL THEN
    INSERT INTO ops.equipment_events (
      equipment_id, event_type, custodian_person_id, custodian_name,
      checkout_type, notes, source_system
    ) VALUES (
      v_equip_id, 'check_out', v_person_id, 'Deborah Delew',
      'public', 'Inventory Day 2026-04-03: confirmed checkout', 'atlas_ui'
    );
  END IF;
END $$;

-- ── Anne Condon → trap 0203 ─────────────────────────────────────────────────
-- Phone: 707-508-9929, Email: amc22@sonic.net
-- Address: 1351 Sylvan Ct, Healdsburg, CA 95448

DO $$
DECLARE
  v_person_id UUID;
  v_equip_id UUID;
BEGIN
  v_person_id := sot.find_or_create_person(
    p_email := 'amc22@sonic.net',
    p_phone := '7075089929',
    p_first_name := 'Anne',
    p_last_name := 'Condon',
    p_source_system := 'atlas_ui'
  );

  SELECT equipment_id INTO v_equip_id FROM ops.equipment WHERE barcode = '0203' AND retired_at IS NULL;

  IF v_equip_id IS NOT NULL THEN
    INSERT INTO ops.equipment_events (
      equipment_id, event_type, custodian_person_id, custodian_name,
      checkout_type, notes, source_system
    ) VALUES (
      v_equip_id, 'check_out', v_person_id, 'Anne Condon',
      'public', 'Inventory Day 2026-04-03: confirmed checkout', 'atlas_ui'
    );
  END IF;
END $$;

-- ── Laura Schermeister → traps 0121 and 0216 ────────────────────────────────
-- No contact info provided

DO $$
DECLARE
  v_equip_id UUID;
BEGIN
  FOR v_equip_id IN
    SELECT equipment_id FROM ops.equipment
    WHERE barcode IN ('0121', '0216') AND retired_at IS NULL
  LOOP
    INSERT INTO ops.equipment_events (
      equipment_id, event_type, custodian_name,
      checkout_type, notes, source_system
    ) VALUES (
      v_equip_id, 'check_out', 'Laura Schermeister',
      'public', 'Inventory Day 2026-04-03: confirmed checkout (no contact info on file)', 'atlas_ui'
    );
  END LOOP;
END $$;

-- ── Thea Torgerson → trap 0192 ──────────────────────────────────────────────
-- No contact info provided

DO $$
DECLARE
  v_equip_id UUID;
BEGIN
  SELECT equipment_id INTO v_equip_id FROM ops.equipment WHERE barcode = '0192' AND retired_at IS NULL;

  IF v_equip_id IS NOT NULL THEN
    INSERT INTO ops.equipment_events (
      equipment_id, event_type, custodian_name,
      checkout_type, notes, source_system
    ) VALUES (
      v_equip_id, 'check_out', 'Thea Torgerson',
      'public', 'Inventory Day 2026-04-03: confirmed checkout (no contact info on file)', 'atlas_ui'
    );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Flag everything else that claims "available" but wasn't confirmed
-- ═══════════════════════════════════════════════════════════════════════════════
-- Any non-retired equipment that is "available" but NOT in the shelf list
-- and NOT one of the known checkouts = we can't account for it.

-- Only flag large_trap_backdoor (the main trap type audited today).
-- Other equipment types (cages, cameras, accessories, other trap types)
-- were NOT part of this audit and should be left untouched.
INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
SELECT equipment_id, 'reported_missing',
  'Inventory Day 2026-04-03: not found on shelf, not confirmed checked out — flagged for investigation',
  'atlas_ui'
FROM ops.equipment
WHERE custody_status = 'available'
  AND retired_at IS NULL
  AND equipment_type_key = 'large_trap_backdoor'
  AND barcode NOT IN ('0205','0218','0224','0178','0146','0157','0207','0200','0144','0221','0164','0155','0152')
  AND barcode NOT IN ('0176','0208','0203','0121','0216','0192');

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- After this migration (large_trap_backdoor only):
-- SELECT custody_status, count(*) FROM ops.equipment
-- WHERE retired_at IS NULL AND equipment_type_key = 'large_trap_backdoor' GROUP BY 1;
-- Expected:
--   available    = 13 (shelf traps)
--   checked_out  = 6  (Rebecca 0176, Deborah 0208, Anne 0203, Laura 0121+0216, Thea 0192)
--   missing      = any large_trap_backdoor unaccounted for
--   maintenance  = any that were already in maintenance
--
-- Other equipment types (cages, small traps, cameras, accessories) are UNTOUCHED.

COMMIT;
