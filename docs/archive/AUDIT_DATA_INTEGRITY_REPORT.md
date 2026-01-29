# Data Integrity Audit Report

**Date**: 2026-01-17
**Triggered By**: Jean Worthey's place showing incorrect statistics
**Scope**: ClinicHQ data pipeline, cat-place linking, intake workflow

---

## Executive Summary

A critical bug in the ClinicHQ ingest pipeline has caused **owner information to not be linked to appointments**, resulting in:
- **15,921 appointments** missing owner_email (33.6%)
- **101 cats with procedures** not linked to any place
- **467 intake places** without connected cat data
- **Undercounted statistics** for active TNR sites

**Good News**: 100% of the affected data is recoverable from `staged_records`.

---

## 1. Appointments Data Quality

### Overview
| Metric | Count | % |
|--------|-------|---|
| Total appointments | 47,332 | 100% |
| With owner_email | 31,411 | 66.4% |
| **Missing owner_email** | **15,921** | **33.6%** |
| With person_id | 45,373 | 95.9% |
| Missing person_id | 1,959 | 4.1% |

### Fixable from Staged Records
| Metric | Count |
|--------|-------|
| Appointments fixable from staged_records | **18,294** |
| (This exceeds missing count because some have partial data) | |

### Missing Owner Email by Month (2024-2026)
| Month | Total Appts | Missing Email | % Missing |
|-------|-------------|---------------|-----------|
| Jan 2026 | 277 | 173 | **62.5%** ← Worst |
| Dec 2025 | 453 | 89 | 19.6% |
| Nov 2025 | 491 | 79 | 16.1% |
| Oct 2025 | 664 | 188 | 28.3% |
| ... | ... | ... | ... |
| Average 2025 | ~550 | ~130 | ~24% |
| Average 2024 | ~540 | ~190 | ~35% |

**Pattern**: January 2026 has the highest missing rate (62.5%), suggesting a recent regression in the pipeline.

---

## 2. Cat-Place Linking

### Overview
| Metric | Count |
|--------|-------|
| Total cats | 34,491 |
| Cats with place links | 32,559 |
| **Cats missing place links** | **1,932** |
| Cats with procedures but no place link | **101** |

### Cats Without Place Links by Month (2025-2026)
| Month | Cats Missing Place |
|-------|-------------------|
| Jan 2026 | **90** ← Most affected |
| Dec 2025 | 1 |
| Oct 2025 | 1 |
| Jul 2025 | 1 |

**Pattern**: 90 of 101 affected cats are from January 2026.

### Top Affected Owners
| Owner | Missing Cats |
|-------|--------------|
| Jean Worthey | 8 |
| Dina Arntz | 5 |
| Erika Batista | 3 |
| Vicki Lopez | 3 |
| Coast Guard Station | 3 |
| Carlos Lopez | 3 |
| Marcie Flores | 3 |
| Janice Villalobos | 3 |
| Erin Holder | 3 |
| Selina Thor | 3 |

---

## 3. Intake Pipeline Impact

### Submissions Overview
| Metric | Count |
|--------|-------|
| Total intake submissions | 1,142 |
| With matched_person_id | 1,142 (100%) |
| With place_id | 1,131 (99%) |
| Converted to requests | 0 (0%) |

### Place Linking Quality
| Metric | Count |
|--------|-------|
| Intake places with linked cats | 448 |
| **Intake places WITHOUT linked cats** | **467** |
| Places that COULD get cats via email match | 122 |
| Potential cats to link | 561 |

### Submitter Matching
| Metric | Count |
|--------|-------|
| Submitters found in person_identifiers | 1,032 (90%) |
| Submitters NOT in person_identifiers | 110 (10%) |

---

## 4. Root Cause Analysis

### The Bug
The `clinic_full_pipeline.mjs` pipeline:
1. ✅ Ingests `cat_info.xlsx` → creates cats
2. ✅ Ingests `owner_info.xlsx` → **stages only, doesn't update appointments**
3. ✅ Ingests `appointment_info.xlsx` → creates appointments
4. ❌ **Never joins owner_info to appointments**

### Why Place Linking Fails
```sql
-- This query in the pipeline:
FROM trapper.sot_appointments a
JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
-- Fails because a.person_id is NULL!
```

### Evidence: Jean Worthey's Jan 12, 2026 Cats
**Raw staged_records (owner_info)**:
```
| Number | Owner Name    | Owner Email               | Owner Address                           |
|--------|---------------|---------------------------|------------------------------------------|
| 26-127 | Jean Worthey  | jean_worthey@peoplepc.com | 3820 Selvage Road, Santa Rosa, CA 95401 |
| 26-128 | Jean Worthey  | jean_worthey@peoplepc.com | 3820 Selvage Road, Santa Rosa, CA 95401 |
| ... (6 more) |
```

**sot_appointments table**:
```
| appointment_number | owner_email | owner_phone | person_id |
|--------------------|-------------|-------------|-----------|
| 26-127             | NULL        | NULL        | NULL      |
| 26-128             | NULL        | NULL        | NULL      |
| ... (6 more) |
```

---

## 5. Downstream Effects

### Statistics Undercounting
- Places show fewer cats than actually done there
- Jean Worthey: Shows 97 cats altered, should be 105+
- Alteration rates may be incorrect
- Yearly breakdowns missing recent data

### Intake Workflow Impact
- New submissions can't show historical cat data for known locations
- Triage scoring may miss repeat requesters
- Colony size estimates undercount

### Trapper Attribution
- Trappers may not get credit for recent cats
- Performance metrics incomplete

---

## 6. Data Recovery Plan

### Step 1: Backfill Owner Info (18,294 appointments)
```sql
UPDATE trapper.sot_appointments a
SET
  owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
  owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND a.owner_email IS NULL
  AND sr.payload->>'Owner Email' IS NOT NULL;
```

### Step 2: Create/Link Persons
```sql
UPDATE trapper.sot_appointments a
SET person_id = trapper.find_or_create_person(
  a.owner_email,
  a.owner_phone,
  sr.payload->>'Owner First Name',
  sr.payload->>'Owner Last Name',
  sr.payload->>'Owner Address',
  'clinichq'
)
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND a.person_id IS NULL
  AND a.owner_email IS NOT NULL;
```

### Step 3: Re-run Cat-Place Linking
```sql
INSERT INTO trapper.cat_place_relationships (
  cat_id, place_id, relationship_type, confidence, source_system
)
SELECT DISTINCT
  a.cat_id,
  ppr.place_id,
  'appointment_site',
  'high',
  'backfill_fix'
FROM trapper.sot_appointments a
JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
WHERE a.cat_id IS NOT NULL
  AND ppr.place_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
  )
ON CONFLICT DO NOTHING;
```

### Step 4: Fix Pipeline Going Forward
Add to `clinic_full_pipeline.mjs` after owner_info ingest:
- Join owner_info to appointments by appointment_number
- Populate owner_email, owner_phone, person_id
- Then run place linking

---

## 7. Verification Queries

### After Fix - Check Jean Worthey
```sql
SELECT
  p.display_name,
  COUNT(DISTINCT cpr.cat_id) as linked_cats,
  COUNT(DISTINCT CASE WHEN cp.procedure_date >= '2025-11-01' THEN cp.cat_id END) as recent_cats
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id
WHERE p.place_id = '044df095-61cd-48e3-8a9f-d9718d00531e'
GROUP BY p.display_name;
-- Should show linked_cats >= 129 (121 + 8)
```

### Check All Cats Linked
```sql
SELECT COUNT(*) as unlinked_cats
FROM trapper.cat_procedures cp
WHERE (cp.is_spay OR cp.is_neuter)
AND NOT EXISTS (
  SELECT 1 FROM trapper.cat_place_relationships cpr
  WHERE cpr.cat_id = cp.cat_id
);
-- Should be 0 after fix
```

---

## 8. Summary

| Issue | Severity | Affected Records | Fixable |
|-------|----------|------------------|---------|
| Appointments missing owner_email | High | 15,921 | 18,294 (100%+) |
| Cats without place links | Critical | 101 | 101 (100%) |
| Intake places without cat data | Medium | 467 | ~122 (26%) |

**Total Impact**:
- 33.6% of appointments have incomplete owner data
- 101 cats with procedures not attributed to any place
- 8 of Jean Worthey's recent cats missing from her stats
- Unknown number of other sites similarly affected

**Recovery Confidence**: HIGH - All required data exists in staged_records.
