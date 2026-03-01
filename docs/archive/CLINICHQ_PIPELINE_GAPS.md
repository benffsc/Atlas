# ClinicHQ Ingest Pipeline Gaps

**Audit Date:** 2026-02-10
**Auditor:** Claude Code

## Executive Summary

The ClinicHQ ingest pipeline has **critical architectural gaps** that prevent cats from being properly linked to TNR requests. The system processes three separate data exports independently, with joining logic scattered across multiple post-processing steps. This causes silent failures when data dependencies aren't met.

**Impact:** ~33% of appointments have no place inference, ~29% have no person link, and request attribution fails silently.

---

## The Three Ingests

ClinicHQ data comes in three separate exports that MUST be processed in order:

| Order | Export | Creates | Links |
|-------|--------|---------|-------|
| 1 | appointment_info.xlsx | `sot_appointments` | Tries to link to cats (fails if cat_info not yet processed) |
| 2 | owner_info.xlsx | `sot_people`, `places` | Links appointments to people via `appointment_number` |
| 3 | cat_info.xlsx | `sot_cats` | Links orphaned appointments to cats via microchip |

### The Fundamental Problem

Each ingest runs independently. The joining logic assumes data from OTHER ingests already exists:

```
appointment_info runs:
  → Tries to link appointments to cats (cat_identifiers don't exist yet!)
  → Tries to link cats to requests (cat_place_relationships don't exist yet!)
  → Both fail silently, 0 rows affected

owner_info runs:
  → Creates people and places
  → Links appointments to people (WORKS - uses appointment_number)
  → But cat_id is still NULL on appointments

cat_info runs:
  → Creates cats with microchips
  → Links orphaned appointments to cats (WORKS - if microchip matches)
  → But cat-place linking hasn't happened yet

Entity linking (cron):
  → Creates cat_place_relationships
  → But links to PERSON's place, not COLONY SITE
  → Cat-request linking fails because place doesn't match
```

---

## Gap 1: Microchip Validation Not Enforced

**Location:** `/apps/web/src/app/api/ingest/process/[id]/route.ts` lines 729-735

**Problem:** The LEFT JOIN on `cat_identifiers` silently returns NULL if:
- Microchip field is empty
- Microchip is malformed (wrong length, invalid format)
- Microchip in appointment_info differs from cat_info

**Impact:** Appointments stay with `cat_id = NULL` forever, can't link to requests.

**Evidence:** 1 of 120 recent appointments has no cat_id.

### Recommendation

Add microchip format validation before INSERT:
```sql
-- Reject if microchip is present but invalid
WHERE sr.payload->>'Microchip Number' IS NULL
   OR sr.payload->>'Microchip Number' ~ '^[0-9]{9,15}$'
```

Log invalid microchips to a monitoring table for review.

---

## Gap 2: Cat-Place Linking Uses Wrong Place

**Location:** `trapper.link_cats_to_places()` function

**Problem:** Cats are linked to the PERSON's home address, not the COLONY SITE where they were trapped.

**Example (Nancy Miller case):**
- Nancy Miller has request at 1305 Pepper Rd (colony site)
- Crystal Furtado trapped 3 cats FROM 1305 Pepper Rd
- Crystal's home is 456 Oak Ave
- Cats get linked to 456 Oak Ave (Crystal's home)
- Request at 1305 Pepper Rd gets 0 cats linked

**Root Cause:** `person_place_relationships` only knows where Crystal LIVES, not where she TRAPPED.

### Recommendation

Option A: Use appointment booking_address for place inference (higher priority than person's home)
```sql
-- In infer_appointment_places(), prioritize:
1. booking_address from appointment (if present)
2. client_address from owner_info
3. person_place_relationships (fallback)
```

Option B: Create trapper→site relationship
```sql
-- When trapper brings cats from a site, create relationship:
INSERT INTO person_place_relationships (person_id, place_id, role)
VALUES (crystal_id, place_1305_pepper, 'trapping_site')
```

---

## Gap 3: Entity Linking Happens AFTER Request Attribution

**Location:** `/apps/web/src/app/api/ingest/process/[id]/route.ts` lines 927-961 vs 993-1041

**Problem:** First cat-request link attempt (line 927) happens BEFORE entity linking (line 993). The query requires `cat_place_relationships` which don't exist yet.

**Timeline:**
1. Line 927: `INSERT INTO request_cat_links ... JOIN cat_place_relationships` → 0 rows
2. Line 993: `SELECT * FROM run_cat_place_linking()` → creates cat_place_relationships
3. Line 1041: `SELECT * FROM link_cats_to_requests_safe()` → SHOULD work now

**But:** The second attempt also fails if cats were linked to wrong place (Gap 2).

### Recommendation

Move entity linking to run BEFORE cat-request attribution:
```sql
-- FIRST: Create cat-place relationships
SELECT * FROM run_cat_place_linking();
SELECT * FROM link_cats_to_appointment_places();

-- THEN: Link cats to requests
INSERT INTO request_cat_links ...
```

---

## Gap 4: 60-Day Attribution Window is Too Strict

**Location:** `trapper.link_cats_to_requests_safe()` function (MIG_859)

**Problem:** The function has a 60-day window for appointments and 14-day catch-up for new cat_place_relationships. If processing is delayed:

```sql
WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
  AND (cpr.created_at >= NOW() - INTERVAL '14 days'
       OR a.appointment_date >= CURRENT_DATE - INTERVAL '60 days')
```

If appointment is 70 days old AND cat_place_relationship was created 15 days ago → permanently missed.

### Recommendation

Add a "full backfill" mode that ignores time windows:
```sql
CREATE FUNCTION link_cats_to_requests_backfill(p_request_id UUID DEFAULT NULL)
-- Full backfill with no time restrictions, optional request filter
```

---

## Gap 5: Order Dependency Not Enforced

**Location:** All three ingest scripts

**Problem:** Scripts document "MUST be processed in this order" but nothing enforces it:
- Can run out of order
- Can run in parallel
- Can run with long delays between them

### Recommendation

Option A: Add pre-flight check in each script:
```javascript
// In owner_info ingest:
const appointmentsExist = await db.queryOne(
  `SELECT COUNT(*) FROM staged_records WHERE source_table = 'appointment_info' AND file_upload_id = $1`,
  [relatedUploadId]
);
if (!appointmentsExist) throw new Error('Must process appointment_info first');
```

Option B: Create orchestrator endpoint that processes all three in sequence:
```
POST /api/ingest/clinichq-full
  → Upload all 3 files
  → Process in correct order
  → Run entity linking
  → Return consolidated results
```

---

## Gap 6: No Booking Address Tracking

**Location:** `sot_appointments` table

**Problem:** The table has no column to store the original booking address from ClinicHQ. This makes it impossible to correctly infer where cats were trapped.

**Current columns:**
- `client_name` - who brought the cat
- `client_address` - parsed from owner_info (person's home)
- `inferred_place_id` - derived from person_place_relationships

**Missing:**
- `booking_address` - the address on the ClinicHQ appointment

### Recommendation

Add booking_address column and prioritize it for place inference:
```sql
ALTER TABLE trapper.sot_appointments ADD COLUMN booking_address TEXT;

-- In appointment_info processing:
INSERT INTO sot_appointments (booking_address, ...)
VALUES (sr.payload->>'Client Address', ...);

-- In infer_appointment_places():
-- Priority 1: booking_address
-- Priority 2: client_address from owner_info
-- Priority 3: person_place_relationships
```

---

## Gap 7: Package Line Items Not Exported (CRITICAL)

**Discovery Date:** 2026-02-16
**Impact:** ALL vaccine and treatment data from package bundles is MISSING

**Problem:** ClinicHQ CSV exports only include **ONE row per appointment** - the primary billable service. Package items at $0.00 are NOT exported.

**Example - Appointment 24-85 (microchip 900085001746878):**

| What ClinicHQ Shows | What We Have |
|---------------------|--------------|
| Cat Neuter - $50.00 | ✅ Cat Neuter / |
| Rabies 3 year vaccine - $0.00 | ❌ NOT CAPTURED |
| FVRCP vaccine - 1 year - $0.00 | ❌ NOT CAPTURED |
| Ear Tip - $0.00 | ❌ NOT CAPTURED |
| Buprenorphine - $0.00 | ❌ NOT CAPTURED |
| Microchip (Found Animals) - $0.00 | ❌ NOT CAPTURED |
| Praziquantel - Cats - $0.00 | ❌ NOT CAPTURED |
| Revolution - $0.00 | ❌ NOT CAPTURED |
| FeLV/FIV Test | ✅ Captured as COLUMN (Negative/Positive) |

**What IS captured (as columns, not service rows):**
- FeLV/FIV test results (in `FeLV/FIV (SNAP test, in-house)` column)
- Medical observations (pregnant, lactating, URI, dental disease, etc.)
- Spay/Neuter flags

**What is MISSING:**
- Vaccine services (Rabies, FVRCP) - ~3,800+ affected
- Flea/parasite treatments (Revolution, Activyl) - thousands affected
- Dewormers (Praziquantel) - thousands affected
- Ear tips - thousands affected
- Microchip services - thousands affected

**Evidence:**
```sql
-- Only 3,776 Rabies vaccines exist despite ~27,000 spay/neuter appointments
SELECT COUNT(*) FROM ops.appointments WHERE service_type ILIKE '%rabies%';
-- 3,776

-- These are standalone vaccine appointments, NOT bundled vaccines
SELECT COUNT(*) FROM ops.appointments WHERE service_type ILIKE '%spay%' OR service_type ILIKE '%neuter%';
-- ~27,000
```

**UI Impact:**
- Cat detail shows "No vaccines recorded" even when cat received vaccines
- Treatment history is incomplete
- Cannot track which cats have been ear-tipped
- Cannot track flea treatment coverage

### Fix Options

**Option A: Request Line Item Export from ClinicHQ**
- Work with ClinicHQ to export all service line items, not just primary
- Would require new export format or API integration
- Most complete solution

**Option B: Infer from Packages**
- If "Feral Cat Treatments Package" is primary service, assume standard items included
- Less accurate, doesn't capture variations
- Quick workaround

**Option C: Accept Limitation**
- Document that vaccine/treatment data is incomplete
- FeLV/FIV is still captured (most critical for disease tracking)
- Cat detail page shows accurate message ("No vaccines recorded" = true from our data)

### Recommendation

**Short-term:** Option C - Accept limitation and document. The most critical data (FeLV/FIV, spay/neuter) IS captured.

**Long-term:** Option A - Work with ClinicHQ to export all line items.

---

## Gap 8: Person Linking Fails for 29% of Appointments

**Location:** Owner_info processing

**Problem:** 35 of 120 recent appointments have no `person_id`.

**Possible causes:**
1. Owner email/phone is empty or malformed
2. `appointment_number` mismatch between exports
3. Owner_info not yet processed

### Recommendation

Add monitoring view:
```sql
CREATE VIEW v_appointments_missing_person AS
SELECT appointment_id, appointment_number, client_name, appointment_date
FROM sot_appointments
WHERE person_id IS NULL
  AND appointment_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY appointment_date DESC;
```

Add fallback linking via client_name fuzzy match.

---

## Current Statistics

### February 2026 Appointments
| Metric | Count | Percentage |
|--------|-------|------------|
| Total | 120 | 100% |
| Missing place | 40 | 33% |
| Missing person | 35 | 29% |
| Missing cat | 1 | 1% |

### Request Cat Links
| Metric | Value |
|--------|-------|
| Nancy Miller's request | 0 cats linked |
| Cats at Nancy's place | 10 (from Feb 5) |
| Gap | 10 cats should be linked |

---

## Recommended Fixes (Priority Order)

### P0: Critical (Fix Immediately)

1. **Run entity linking after all three ingests** - Move `run_all_entity_linking()` to run AFTER cat_info processes
2. **Add booking_address column** - Capture where cats were actually trapped
3. **Fix place inference priority** - Use booking_address over person's home

### P1: High (Fix This Week)

4. **Create orchestrator endpoint** - Single upload that processes all three in order
5. **Add microchip validation** - Log invalid/missing microchips
6. **Add monitoring views** - Track linking success rates

### P2: Medium (Fix This Month)

7. **Remove time windows in catch-up** - Allow full backfill
8. **Add trapper→site relationships** - Track where trappers trap (not where they live)
9. **Improve person linking fallbacks** - Fuzzy name match, phone normalization

---

## Immediate Action for Nancy Miller

Run these queries to fix Nancy's specific case:

```sql
-- 1. Find cats that were trapped from Nancy's site
SELECT c.cat_id, c.display_name, a.appointment_date
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
WHERE a.client_address ILIKE '%1305 Pepper%'
   OR a.client_name ILIKE '%nancy%miller%';

-- 2. Link those cats to Nancy's place
INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system, source_table)
SELECT c.cat_id, r.place_id, 'appointment_site', 'manual_fix', 'nancy_miller_fix'
FROM trapper.sot_cats c, trapper.sot_requests r
WHERE r.request_id = '04e4894c-644c-403a-b52c-b725eb6ed59e'  -- Nancy's request
  AND c.cat_id IN (...);  -- cats from step 1

-- 3. Create request_cat_links
INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, created_by)
SELECT '04e4894c-644c-403a-b52c-b725eb6ed59e', cat_id, 'tnr_target', 'Manual fix for Nancy Miller case', 'claude_code'
FROM (...);  -- cats from step 1

-- 4. Update request status
UPDATE trapper.sot_requests
SET cats_trapped = 3  -- or actual count
WHERE request_id = '04e4894c-644c-403a-b52c-b725eb6ed59e';
```

---

## Files Involved

| File | Purpose |
|------|---------|
| `scripts/ingest/clinichq_appointment_info_xlsx.mjs` | Stages appointment data |
| `scripts/ingest/clinichq_owner_info_xlsx.mjs` | Stages owner/address data |
| `scripts/ingest/clinichq_cat_info_xlsx.mjs` | Stages cat/microchip data |
| `/apps/web/src/app/api/ingest/process/[id]/route.ts` | Post-processing for all three |
| `sql/schema/sot/MIG_859__link_cats_to_requests_safe.sql` | Cat-request attribution |
| `sql/schema/sot/MIG_957__permanent_booking_address_priority.sql` | Entity linking pipeline |
