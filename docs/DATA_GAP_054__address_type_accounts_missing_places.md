# DATA_GAP_054: Address-Type Clinic Accounts Missing Place Extraction

**Status:** FIX READY - MIG_2496, MIG_2497 created
**Severity:** HIGH
**Reported:** 2026-02-24
**Reporter:** User investigating "Old Stony Pt Rd" colony cats not appearing
**Root Cause:** V1 MIG_909 place extraction logic not ported to V2

---

## Architectural Context (CRITICAL)

**ClinicHQ provides CATS + PLACES as ground truth. Person links are inferred and ~30% unreliable.**

This is a fundamental principle of Atlas data architecture:
- **Ground Truth:** Cats (microchips, procedures) and Places (addresses) from ClinicHQ
- **Inferred:** Person links via email/phone are often wrong because:
  - Trappers bring colony cats (their contact info ≠ where cat lives)
  - Shared household phones (Cell Phone field used by multiple family members)
  - Family members use one email for all bookings
  - Org emails used for individual bookings

**Implication:** The MAP should show cats at PLACES, not filtered through person links. If we only show cats via person→place→cat, we miss ~30% of cats.

---

## Problem Statement

Cats booked under address-like names in ClinicHQ (e.g., "Old Stony Pt Rd", "5403 San Antonio Road") are not appearing in place-based views or map visualizations because:

1. The name is correctly classified as `'address'` by `classify_owner_name()`
2. A `clinic_account` is created with `account_type = 'address'`
3. **BUT no place is extracted** from the address-like name
4. Therefore `appointment.inferred_place_id` stays NULL
5. Therefore `sot.link_cats_to_appointment_places()` cannot link cats to places

## Root Cause

V1 had `MIG_909__extract_places_from_owner_names.sql` which extracted places from address-type clinic accounts:

```sql
-- V1 Logic (from MIG_909):
IF v_classification = 'address' THEN
  SELECT trapper.find_or_create_place_deduped(
    p_formatted_address := v_stripped_name,  -- "Old Stony Pt Rd"
    p_display_name := NULL,
    p_lat := NULL,
    p_lng := NULL,
    p_source_system := 'clinichq'
  ) INTO v_place_id;

  UPDATE trapper.clinic_owner_accounts
  SET linked_place_id = v_place_id
  WHERE account_id = v_account_id;
END IF;
```

V2 `ops.upsert_clinic_account_for_owner()` (from MIG_2489) does NOT include this logic.

## Evidence

**Example: Old Stony Pt Rd Colony**

ClinicHQ booking:
- `Owner First Name`: "Old Stony Pt Rd" (site name used as owner name)
- `Owner Last Name`: empty
- `Owner Email`: empty
- `Owner Phone`: empty
- `Owner Address`: May be empty or contain partial data

Processing result:
- `classify_owner_name('Old Stony Pt Rd', '')` → `'address'`
- `should_be_person()` → FALSE (no identifiers)
- `clinic_account` created with `account_type = 'address'`, `resolved_place_id = NULL`
- Appointment has `inferred_place_id = NULL`
- Cat has no `cat_place` relationship

## Scope of Impact

This affects ALL clinic_accounts where:
- `account_type = 'address'` (or classified as address)
- `resolved_place_id IS NULL`
- The appointment `inferred_place_id IS NULL`

Potential patterns:
- Street addresses: "5403 San Antonio Road", "123 Main St Petaluma"
- Site names with road: "Old Stony Pt Rd", "Silveira Ranch Rd"
- Any address-like text in Owner First Name

## Solution

### Phase 1: Update `ops.upsert_clinic_account_for_owner()`

Add place extraction for address-type accounts (port V1 MIG_909 logic):

```sql
-- After classification, if account_type = 'address':
IF v_account_type = 'address' THEN
  -- Extract place from the address-like name
  v_place_id := sot.find_or_create_place_deduped(
    p_formatted_address := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')),
    p_source_system := 'clinichq'
  );

  -- Set resolved_place_id on the account
  IF v_place_id IS NOT NULL THEN
    UPDATE ops.clinic_accounts
    SET resolved_place_id = v_place_id
    WHERE account_id = v_account_id;
  END IF;
END IF;
```

### Phase 2: Backfill Existing Address-Type Accounts

Create migration to:
1. Find all `clinic_accounts` with `account_type = 'address'` and `resolved_place_id IS NULL`
2. Extract places from `display_name`
3. Set `resolved_place_id`
4. Update appointment `inferred_place_id` for affected appointments
5. Re-run `sot.link_cats_to_appointment_places()`

### Phase 3: Also Handle Site Names

Site names like "Silveira Ranch" may also need place extraction if they have an associated address.

## Verification Query

```sql
-- Find address-type accounts without places
SELECT
  ca.account_id,
  ca.display_name,
  ca.account_type,
  ca.resolved_place_id,
  ca.appointment_count,
  ca.cat_count
FROM ops.clinic_accounts ca
WHERE ca.account_type = 'address'
  AND ca.resolved_place_id IS NULL
  AND ca.merged_into_account_id IS NULL
ORDER BY ca.appointment_count DESC
LIMIT 20;

-- Find cats affected (linked to these accounts but no place link)
SELECT
  c.cat_id,
  c.name,
  ca.display_name as booked_under,
  a.appointment_date
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
WHERE ca.account_type = 'address'
  AND ca.resolved_place_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
  )
ORDER BY a.appointment_date DESC;
```

## Related

- MIG_909 (V1): Original place extraction logic
- MIG_2489: Extended clinic_accounts for all owners
- MIG_2490: Backfilled clinic_accounts
- DATA_GAP_053: Original client names lost during identity resolution
- INV-18: ClinicHQ pseudo-profiles are not people

## Fix Files

- `sql/schema/v2/MIG_2496__address_type_place_extraction.sql` - Place extraction for address-type accounts
- `sql/schema/v2/MIG_2497__add_missing_business_keywords.sql` - Add missing keywords (generation, grow)
- `sql/queries/QRY_054__data_quality_audit.sql` - Comprehensive audit query

## Migration Order

1. **Run audit first:** `psql -f sql/queries/QRY_054__data_quality_audit.sql`
2. **Apply MIG_2497** - Prevents new misclassifications (Grow Generation → organization)
3. **Apply MIG_2496** - Extracts places for existing address-type accounts
4. **Run entity linking:** `SELECT sot.run_all_entity_linking();`
5. **Verify:** Re-run audit to confirm improvements

## Related Invariant

**CLAUDE.md Invariant 11:** ClinicHQ Ground Truth Is CATS + PLACES, Not People

This gap exists because the original V2 ingest pipeline assumed:
- Places come from `Owner Address` field
- Names are just for person creation

But in practice, FFSC booking practices often put the address IN the name field:
- `Owner First Name` = "Old Stony Pt Rd" (the location)
- `Owner Last Name` = "" or actual person name
- `Owner Address` = empty or partial

MIG_2496 fixes this by extracting places from address-type account names.
