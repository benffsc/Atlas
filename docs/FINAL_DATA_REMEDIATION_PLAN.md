# Final Data Remediation Plan

**Date:** 2026-02-24
**Status:** APPROVED FOR IMPLEMENTATION
**Based On:** Data reliability analysis + industry research

---

## Problem Statement

ClinicHQ person links are only **28% reliable** for determining where a cat lives:

| Category | % | Meaning |
|----------|---|---------|
| Reliable | 28.5% | Person linked = where cat lives |
| Uncertain | 25.0% | Could be either |
| Unreliable | 46.5% | Person brought cat from elsewhere |

**Root cause:** ClinicHQ records "who booked the appointment" not "where the cat lives." Trappers, colony caretakers, and FFSC staff bring cats from colony sites but their contact info gets linked to the cats.

---

## Industry Best Practices Applied

### From Animal Shelter Manager (ASM)
- Separate `BroughtInByOwnerID` from `OriginalOwnerID`
- Track movements separately from ownership
- Use location as primary anchor, not person

### From Cat Stats (Neighborhood Cats)
- Colony-centric model (places are primary entities)
- Separate roles: Caretaker, Trapper, Administrator
- Focus on where cats are, not who "owns" them

### From Shelter Animals Count
- Distinguish "caretaker" from "owner"
- Community cats have caretakers, not owners
- Location is the ground truth

---

## Core Principle

**PLACES are ground truth. PEOPLE are contacts.**

```
┌────────────────────────────────────────────────────────────┐
│                    MAP VISUALIZATION                        │
│                                                             │
│   Show cats at PLACES (from appointment addresses)         │
│   NOT filtered through person→place→cat chains             │
│                                                             │
│   Place = Ground Truth (from Owner Address field)          │
│   Person = Contact Info (for communication only)           │
└────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### Current State (Problematic)

```
appointment
    ├── person_id → people (WHO BOOKED - used for map, ~28% accurate)
    ├── owner_account_id → clinic_accounts (only for pseudo-profiles)
    └── inferred_place_id → places (underutilized)

cats shown on map via: person_id → person_place → places (WRONG)
```

### Target State (Industry-Aligned)

```
appointment
    ├── owner_account_id → clinic_accounts (WHO BOOKED - ALL appointments)
    │       ├── resolved_person_id → people (for contact/communication)
    │       └── resolved_place_id → places (for address-type accounts)
    │
    ├── inferred_place_id → places (WHERE CAT WAS - from Owner Address)
    └── cat_id → cats

cats shown on map via: inferred_place_id (CORRECT - ground truth)
```

### Key Separations

| Entity | Purpose | Source |
|--------|---------|--------|
| `clinic_accounts` | WHO booked the appointment | ClinicHQ Owner Name |
| `places` | WHERE the cat was found/lives | ClinicHQ Owner Address |
| `people` | Contact for communication | Email/phone resolution |
| `cats` | Individual animals | Microchip, procedures |

---

## Implementation Phases

### Phase 1: Classification Fixes (Safe, No Schema Changes)

**Migrations:**
- `MIG_2497` - Add "generation" + ~45 business keywords
- `MIG_2498` - Fix site_name (3+ word) and garbage patterns

**Result:** Correct classification of "Grow Generation" → org, "Keller Estates Vineyard" → site_name, "Rebooking placeholder" → garbage

### Phase 2: Schema Extensions

**Migrations:**
- `MIG_2489` - Extend clinic_accounts for ALL owners
  - Add `merged_into_account_id`, `source_record_id`, `household_id`
  - Add account types: `resident`, `colony_caretaker`, `trapper`
  - Create `sot.households` table

**Result:** clinic_accounts stores ALL ClinicHQ owners, not just pseudo-profiles

### Phase 3: Historical Backfill

**Migrations:**
- `MIG_2490` - Backfill clinic_accounts for all appointments
  - Create accounts from existing appointment owner data
  - Link ALL appointments via `owner_account_id`
  - Detect households from shared email/phone

- `MIG_2491` - Robustness fixes
  - Feature flag for graceful degradation
  - Case-insensitive indexes
  - Atomic upsert (race condition fix)

**Result:** 100% of appointments have `owner_account_id` set

### Phase 4: Place Extraction

**Migrations:**
- `MIG_2496` - Extract places for address-type accounts
  - Update `upsert_clinic_account_for_owner()` to set `resolved_place_id`
  - Backfill existing address/site_name accounts
  - Link appointments to places via clinic_accounts

**Result:** Address-type accounts (1,503) and site_name accounts (1,709) have places

### Phase 5: Entity Linking

**Commands:**
```sql
SELECT sot.run_all_entity_linking();
```

**Result:** Cats linked to places via `inferred_place_id`, visible on map

---

## Migration Execution Order

```bash
# Phase 1: Classification (safe)
psql -f sql/schema/v2/MIG_2497__add_missing_business_keywords.sql
psql -f sql/schema/v2/MIG_2498__fix_classification_edge_cases.sql

# Phase 2: Schema
psql -f sql/schema/v2/MIG_2489__extend_clinic_accounts.sql

# Phase 3: Backfill
psql -f sql/schema/v2/MIG_2490__backfill_clinic_accounts.sql
psql -f sql/schema/v2/MIG_2491__robustness_fixes.sql

# Phase 4: Place Extraction
psql -f sql/schema/v2/MIG_2496__address_type_place_extraction.sql

# Phase 5: Entity Linking
psql -c "SELECT sot.run_all_entity_linking();"

# Verification
psql -f sql/queries/QRY_054__data_quality_audit.sql
```

---

## Expected Outcomes

### Before Migrations

| Metric | Value |
|--------|-------|
| Cats with place links | 34,346 (81%) |
| Address-type accounts with places | 0% |
| Site-name accounts with places | 0% |
| "Old Stony Pt Rd" cats on map | 0 |

### After Migrations

| Metric | Expected |
|--------|----------|
| Cats with place links | ~38,000 (90%+) |
| Address-type accounts with places | 100% |
| Site-name accounts with places | 100% |
| "Old Stony Pt Rd" cats on map | 16 |

---

## UI Implications

### Current UI
- Shows cats via person→place chain (28% reliable)
- "Owner: Michael Togneri" even when Elisha booked

### Target UI
- Shows cats at places directly (ground truth)
- "Booked by: Elisha Togneri"
- "Contact: michaeltogneri@yahoo.com"
- "Trapping location: 2384 Stony Point Rd"

---

## Invariants Established

### INV-11 (Revised)

**ClinicHQ provides CATS + PLACES as ground truth. Person links indicate WHO BOOKED, not WHERE CAT LIVES.**

- **Ground Truth:** Cats (microchips, procedures) and Places (Owner Address field)
- **Contacts Only:** Person links (28% reliable for location, 100% reliable for communication)
- **Map Source:** Use `inferred_place_id`, NOT person→place chain

### INV-46 (New)

**Clinic accounts must be created for ALL ClinicHQ bookings, not just pseudo-profiles.**

- Every appointment has `owner_account_id`
- Account preserves original client name
- `resolved_person_id` links to Data Engine result (may differ from account holder)

### INV-47 (New)

**High-volume users (>10 cats) are likely caretakers/trappers, not pet owners.**

- 43.5% of "resident" appointments are high-volume
- Their person_place relationships do NOT indicate cat locations
- Use `inferred_place_id` from appointments instead

---

## Verification Queries

### After All Migrations

```sql
-- 1. Address/site accounts have places
SELECT
  account_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as with_place,
  ROUND(100.0 * COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) / COUNT(*), 1) as pct
FROM ops.clinic_accounts
WHERE account_type IN ('address', 'site_name')
  AND merged_into_account_id IS NULL
GROUP BY account_type;

-- 2. Cat place coverage improved
SELECT
  'Before' as period, 34346 as cats_with_places, 81.0 as pct
UNION ALL
SELECT
  'After' as period,
  COUNT(DISTINCT c.cat_id) as cats_with_places,
  ROUND(100.0 * COUNT(DISTINCT c.cat_id) / (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 1)
FROM sot.cats c
JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL;

-- 3. Old Stony Pt Rd specifically
SELECT ca.display_name, ca.resolved_place_id IS NOT NULL as has_place
FROM ops.clinic_accounts ca
WHERE ca.display_name ILIKE '%stony%'
  AND ca.account_type = 'address';
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `docs/DATA_RELIABILITY_ANALYSIS.md` | Full analysis with methodology |
| `docs/FINAL_DATA_REMEDIATION_PLAN.md` | This plan |
| `docs/DATA_GAPS.md` | DATA_GAP_053, DATA_GAP_054 entries |
| `sql/queries/QRY_054__data_quality_audit.sql` | Pre/post audit |
| `sql/schema/v2/MIG_2497__*.sql` | Business keywords |
| `sql/schema/v2/MIG_2498__*.sql` | Classification edge cases |
| `sql/schema/v2/MIG_2489__*.sql` | Schema extension |
| `sql/schema/v2/MIG_2490__*.sql` | Backfill |
| `sql/schema/v2/MIG_2491__*.sql` | Robustness |
| `sql/schema/v2/MIG_2496__*.sql` | Place extraction |

---

## Research Sources

- [ASM Database Tables](https://sheltermanager.com/repo/asm3_help/databasetables.html) - Separates BroughtInByOwnerID from OriginalOwnerID
- [Cat Stats](https://www.catstats.org/) - Colony-centric model, Caretaker/Trapper roles
- [Shelter Animals Count](https://www.shelteranimalscount.org/) - Industry data standards
- [ASPCA Community Cats](https://www.aspca.org/helping-people-pets/shelter-intake-and-surrender/closer-look-community-cats) - Caretaker vs owner definitions
- [HumanePro Cat Stats Article](https://humanepro.org/magazine/articles/herding-cat-stats) - TNR database best practices

---

## Approval

This plan is ready for implementation. The migrations are designed to be:
1. **Safe** - Classification changes don't modify data, just improve future processing
2. **Incremental** - Each phase can be verified before proceeding
3. **Reversible** - MIG_2491 includes rollback capability
4. **Industry-aligned** - Based on ASM and Cat Stats patterns
