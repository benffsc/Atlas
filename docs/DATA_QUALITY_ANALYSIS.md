# Data Quality Analysis - Root Causes and Solutions

Analysis Date: 2026-01-19
Last Updated: 2026-01-19 (MIG_466 applied)

## Executive Summary

Investigation of data quality findings revealed several systemic issues with the data pipeline:

1. **`is_processed` flag not being updated** - RESOLVED via MIG_466
2. **Duplicate people with shared emails** - Requires duplicate merging (14,684 pending)
3. **Missing microchip data** in source systems (ClinicHQ) - Data entry issue

---

## Issue 1: People Without Email/Phone Identifiers

### Original Analysis
~15,000 people appeared to have `primary_email`/`primary_phone` but no `person_identifiers` record.

### Actual Root Cause (Discovered via MIG_466)
These are **duplicate person records**, not missing identifiers. The emails/phones ARE indexed in `person_identifiers`, but linked to a different person_id (the "canonical" version).

**Breakdown:**
| Category | Count | Description |
|----------|-------|-------------|
| High-similarity duplicates | 2,340 | Same name, same email - TRUE DUPLICATES |
| Medium similarity | 74 | Similar names - likely duplicates |
| Different names | 438 | Households sharing email or data entry errors |

### Status: REQUIRES DUPLICATE MERGING
The fix is NOT to backfill identifiers (which conflicts with UNIQUE constraint), but to **merge duplicate people** in the admin duplicate resolution queue.

**Current queue:** 14,684 pending duplicates in `potential_person_duplicates`

### Next Steps
1. Prioritize duplicate review in admin UI
2. Auto-merge high-confidence duplicates (similarity >= 0.9)
3. Flag low-similarity cases for manual review

---

## Issue 2: Unprocessed Staged Records

### Status: ✅ RESOLVED via MIG_466

**Before MIG_466:**
| Source | Table | Unprocessed |
|--------|-------|-------------|
| clinichq | appointment_info | 38,187 |
| clinichq | cat_info | 38,261 |
| petlink | pets | 8,280 |

**After MIG_466:**
| Source | Table | Processed | Unprocessed | % |
|--------|-------|-----------|-------------|---|
| clinichq | appointment_info | 37,598 | 589 | 98.5% |
| clinichq | cat_info | 33,241 | 5,020 | 86.9% |
| petlink | pets | 8,280 | 0 | 100% |

**Remaining unprocessed records:**
- ClinicHQ appointment_info (589): No matching appointment in sot_appointments
- ClinicHQ cat_info (5,020): No microchip in source data

---

## Issue 3: Appointments Without Cats (4,940)

### Root Cause
All 4,940+ appointments without linked cats have **NO microchip in the source data**. ClinicHQ's `Microchip Number` field is empty for these appointments.

| Service Type | Count |
|--------------|-------|
| Examination, Brief | 1,109 |
| Cat Neuter | 971 |
| Cat Spay | 885 |
| Rabies 3 year vaccine | 201 |
| Advantage (Single Dose) | 171 |
| Exam - Feral | 147 |
| Other | ~1,456 |

Sample data shows microchips sometimes embedded in animal name (e.g., "Fozzie (Guenther) 981020053752169") but not in the dedicated field.

### Status: DATA ENTRY ISSUE
This is an upstream data entry problem at the clinic. Solutions:
1. Extract microchips from animal names (regex pattern)
2. Training for clinic staff on microchip field entry
3. Enhanced cat lookup by owner + name combination

---

## Issue 4: Cats Without Appointments (3,407)

### Status: ✅ NOT AN ISSUE

**Expected behavior.** Cats can exist without FFSC clinic appointments:
- PetLink (1,691): Microchip registrations only
- ShelterLuv (1,586): Historical outcomes/fosters
- ClinicHQ (130): Edge cases

This reflects reality - not all cats were TNR'd through FFSC clinic.

---

## Issue 5: Orphaned Places (1,749)

### Status: LOW PRIORITY

Places created from clinic owner addresses that were never linked to requests/cats.

| Place Kind | Count |
|------------|-------|
| unknown | 1,509 |
| apartment_building | 239 |

### Recommended Action
Mark for review via data_quality flag, but not urgent.

---

## Migration MIG_466 Results

**File:** `sql/schema/sot/MIG_466__backfill_person_identifiers.sql`

### What it did:
1. ✅ Marked 37,598 ClinicHQ appointment_info records as processed
2. ✅ Marked 33,241 ClinicHQ cat_info records as processed
3. ✅ Marked 8,280 PetLink pets records as processed
4. ⚠️ Email/phone backfill skipped due to UNIQUE constraint conflicts (duplicate people)

### Verification Test Results
```
✅ ClinicHQ appointment_info: 98% processed
✅ ClinicHQ cat_info: 87% processed
✅ PetLink pets: 100% processed
✅ Identity resolution works for indexed emails
❌ People with email but no identifier: 2,852 (duplicate people needing merge)
```

---

## Updated Priority Matrix

| Issue | Severity | Status | Next Action |
|-------|----------|--------|-------------|
| is_processed flags | MEDIUM | ✅ RESOLVED | - |
| Duplicate people | HIGH | PENDING | Review 14,684 duplicates |
| Appointments without cats | MEDIUM | PENDING | Extract microchips from names |
| Cats without appointments | N/A | ✅ OK | - |
| Orphaned places | LOW | PENDING | Mark for review |

---

## Verification Queries

### Check is_processed status (should be mostly processed now)
```sql
SELECT
  source_system,
  source_table,
  COUNT(*) FILTER (WHERE is_processed) as processed,
  COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_processed) / NULLIF(COUNT(*), 0), 1) as pct
FROM trapper.staged_records
GROUP BY source_system, source_table
ORDER BY source_system, source_table;
```

### Check duplicate queue
```sql
SELECT COUNT(*) as pending_duplicates
FROM trapper.potential_person_duplicates
WHERE resolved_at IS NULL;
```

### Analyze people without identifiers (duplicate analysis)
```sql
WITH missing AS (
  SELECT p.person_id, p.display_name, LOWER(TRIM(p.primary_email)) as email_norm
  FROM trapper.sot_people p
  WHERE p.primary_email IS NOT NULL
    AND p.merged_into_person_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
    )
)
SELECT
  CASE
    WHEN trapper.name_similarity(m.display_name, p2.display_name) >= 0.8 THEN 'duplicate'
    WHEN trapper.name_similarity(m.display_name, p2.display_name) >= 0.5 THEN 'possible'
    ELSE 'different_people'
  END as category,
  COUNT(*) as count
FROM missing m
JOIN trapper.person_identifiers pi ON pi.id_value_norm = m.email_norm AND pi.id_type = 'email'
JOIN trapper.sot_people p2 ON p2.person_id = pi.person_id
GROUP BY 1;
```

---

## Files Created

| File | Purpose |
|------|---------|
| `sql/schema/sot/MIG_466__backfill_person_identifiers.sql` | Migration to fix is_processed flags |
| `scripts/testing/verify_data_quality_fixes.mjs` | Verification test script |
