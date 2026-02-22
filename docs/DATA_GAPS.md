# Atlas Data Gaps Tracker

This document tracks all known data quality gaps in Atlas. Each gap represents a systemic issue that needs to be fixed.

## Status Key

| Status | Meaning |
|--------|---------|
| `OPEN` | Issue identified, not yet fixed |
| `IN PROGRESS` | Fix being developed |
| `FIXED` | Migration applied, verified |
| `WONT FIX` | Accepted as-is with explanation |

---

## DATA_GAP_009: FFSC Organizational Email Pollution

**Status:** FIXED (MIG_915, MIG_916)

**Problem:** FFSC staff emails (info@forgottenfelines.com, sandra@forgottenfelines.com) were used in ClinicHQ for community cat appointments. Identity resolution matched these to Sandra Brady/Nicander's person records, linking 2,400+ cats incorrectly.

**Root Cause:** `should_be_person()` only checked name patterns, not email patterns. ClinicHQ processing called `find_or_create_person()` before Data Engine could reject.

**Fix:**
- MIG_915: Added email pattern checking to `should_be_person()`
- MIG_916: Cleaned up Sandra's erroneous cat relationships

---

## DATA_GAP_010: Linda Price / Location-as-Person

**Status:** FIXED (MIG_917)

**Problem:** Location names ("Golden Gate Transit SR", "The Villages") became person records. Linda Price was merged INTO "The Villages" record.

**Root Cause:** ClinicHQ staff entered location names in Owner First Name field.

**Fix:**
- MIG_917: Unmerged Linda Price, reassigned cats, deleted location-as-person records

---

## DATA_GAP_011: Organization-like Names with Cats

**Status:** DETECTION ADDED (MIG_931) - Review pending

**Problem:** 213 people with organization-like or address-like names have cats linked.

**Examples:**
- "Marin Friends Of Ferals" - 55 cats (legitimate rescue?)
- "890 Rockwell Rd." - 51 cats (should be place, not person)
- "Pub Republic Luv Pilates Parking Area" - 39 cats

**Fix Applied (MIG_931):**
1. Created `is_organization_or_address_name()` detector function
2. Created `v_org_person_review` view for staff review
3. Updated `should_be_person()` to reject org/address patterns for new records

**Staff Action Required:**
- Review records in `v_org_person_review` and resolve each:
  - Convert to known_organization if legitimate org
  - Merge cats to actual owner if data entry error
  - Delete if truly invalid record

---

## DATA_GAP_012: Speedy Creek Winery Duplicates

**Status:** FIXED

**Problem:** 95 "Speedy Creek Winery" person records, email typo on canonical.

**Fix:** Consolidated to "Donna Nelson" (the actual trapper contact), fixed email typo.

---

## DATA_GAP_013: Identity Resolution Consolidation

**Status:** FIXED (MIG_918, MIG_919)

**Problem:** Identity validation scattered across multiple entry points, allowing org emails and location names to slip through.

**Fix:**
- MIG_918: Added missing intake form columns
- MIG_919: Added `should_be_person()` gate to Data Engine Phase 0

**Result:** All identity resolution now flows through single consolidated gate.

---

## DATA_GAP_014: Frances Batey / Bettina Kirby Email Mixup

**Status:** FIXED (MIG_921)

**Problem:** Frances Batey's person record has Bettina Kirby's email (`bmkirby@yahoo.com`) incorrectly associated. 22 cats linked to Frances may actually belong to Bettina's trapping work.

**Evidence:**
```sql
-- Frances Batey has Bettina's email
SELECT person_id, display_name, id_value_norm
FROM sot_people p
JOIN person_identifiers pi ON pi.person_id = p.person_id
WHERE p.person_id = 'd8ad9ef4-07ac-44c3-8528-1a1a404ca4fa';
-- Result: bmkirby@yahoo.com (Bettina M Kirby's email)

-- 26 Bettina Kirby duplicates all merged
SELECT COUNT(*) FROM sot_people WHERE display_name = 'Bettina Kirby';
-- Result: 26 (all merged into Frances?)
```

**Root Cause:** Identity resolution matched on email, merged Bettina's records into Frances Batey.

**Proposed Fix:**
1. Remove `bmkirby@yahoo.com` from Frances Batey
2. Create/find canonical Bettina Kirby record
3. Add email to Bettina's record
4. Review 22 cats - which belong to Frances vs Bettina?
5. Mark Bettina as inactive trapper

---

## DATA_GAP_015: Veterinary Clinic Misclassification

**Status:** OPEN

**Problem:** Places are incorrectly marked as "Veterinary Clinic" when they're actually owner home addresses.

**Example:** 8250 Petaluma Hill Road, Penngrove - marked as clinic but is a private residence.

**Root Cause:** MIG_464 infers "clinic" context from places with 5+ spay/neuter appointments. But `sot_appointments.place_id` is the OWNER's address, not the clinic location.

**Proposed Fix:**
1. Update clinic inference to only use actual clinic addresses (845 Todd Road)
2. Remove erroneous clinic tags from owner addresses
3. Consider adding separate "clinic_location" field to appointments

---

## DATA_GAP_016: People Without Contact Info

**Status:** OPEN (low priority)

**Problem:** 999 people have no email or phone in `person_identifiers`.

**Impact:** These records cannot be matched on future encounters, will create duplicates.

**Root Cause:** Historical data imported without contact info.

**Proposed Fix:**
- Low priority - these are mostly inactive/historical
- Future encounters with contact info will create new records
- Could attempt to match by name+address for active requesters

---

## DATA_GAP_017: First-Name-Only Records ("Scas" Duplicates)

**Status:** DETECTION ADDED (MIG_932) - Review pending

**Problem:** 590 person records with first-name-only display names, including 19 "Scas" duplicates.

**Investigation Results (MIG_932):**
- 560 single proper names (e.g., "Tara", "Carol")
- 19 "Scas" pattern (likely SCAS = Sonoma County Animal Services)
- 10 other patterns (e.g., "A433134")
- 1 all caps single

**Root Cause:** ClinicHQ or intake form allowed entries without last names.

**Fix Applied (MIG_932):**
1. Confirmed "Scas" is SCAS organization (19 records from ClinicHQ, no cats linked)
2. Created `v_firstname_only_review` view for staff review
3. Categorized records by pattern type

**Staff Action Required:**
1. Review "scas_pattern" records - link to SCAS partner org if confirmed
2. Try to find full names for other first-name-only records
3. Consider adding intake form validation to require last names

---

## DATA_GAP_018: Organization-Name Person Records

**Status:** DETECTION ADDED (MIG_931) - Review pending

**Problem:** Organizations entered as person records. Example: "L & W Drywall Supply" appears 6 times.

**Root Cause:** ClinicHQ staff entered business names in owner fields.

**Fix Applied (MIG_931):**
1. Created `is_organization_or_address_name()` to detect org patterns
2. Detection categories: business_suffix (17), rescue_org (8), location_keyword (10)
3. Created `v_org_person_review` view for staff review
4. Updated `should_be_person()` to reject org patterns for new records

**Staff Action Required:**
- Review records in `v_org_person_review` and resolve each
- See DATA_GAP_011 for full staff action details (same view)

---

## DATA_GAP_021: Appointments Missing Cat Links

**Status:** INVESTIGATED - EXPECTED BEHAVIOR (2026-02-07)

**Problem:** 3,493 appointments (7.3%) have person and place links but are missing cat links.

**Investigation Results:**

1. **Cat Linking Status Breakdown:**
   - `no_microchip`: 1,815 (50.9%) - Cats without microchips (euthanized, early TNR)
   - `non_tnr_service`: 1,749 (49.1%) - Exams, treatments, not requiring cat identity

2. **For actual Spay/Neuter procedures:**
   - 94.1% (27,098) ARE linked to cats
   - Only 5.9% (1,704) are not linked

3. **Root Cause of Unlinked Spay/Neuter (1,704):**
   | Source | Count | % | Notes |
   |--------|-------|---|-------|
   | FFSC Foster Account | 1,463 | 85.9% | Foster cats with internal IDs like #6795 |
   | Other Community | 170 | 10.0% | Colony caretakers |
   | Beth Kenyon | 49 | 2.9% | High-volume caretaker |
   | Marin Humane | 21 | 1.2% | Partner org |
   | SCAS Transfer | 1 | 0.1% | Shelter transfer |

4. **Animal Names on Unlinked:** Generic names like "Cat 1", "1", "2", "DSH black" - no microchips embedded

**Conclusion:** This is NOT a data quality issue. These are legitimate TNR procedures on community cats without individual identifiers. The 306 cats with Foster IDs (#6795, etc.) could potentially be matched to ShelterLuv records - see DATA_GAP_023.

---

## DATA_GAP_022: Migrations Not Applied

**Status:** FIXED (2026-02-07)

**Problem:** Critical field-level source tracking migrations had not been applied.

**Fix Applied:**
- `MIG_620` - cat_field_sources table created, v_cat_field_conflicts view created
- `MIG_922` - person_field_sources table created, v_person_field_conflicts view created
- `MIG_923` - Unified orchestrator functions created (run_full_orchestrator, phase config)
- `MIG_924` - survivorship_priority updated with source authority rules for:
  - Cat fields: ClinicHQ wins for medical data
  - Person fields: VolunteerHub wins for volunteers
  - Roles: VolunteerHub for foster/trapper, ShelterLuv for adopter
  - Relationships: ShelterLuv for foster cat links, ClinicHQ for owner links

**Additional Fixes:**
- Fixed `run_all_entity_linking()` function (column name mismatches)
- Created missing `link_appointments_to_partner_orgs()` alias function
- Created stub for `fix_address_account_place_overrides()`
- Fixed `/api/ingest/process` to actually process on GET (Vercel cron sends GET, not POST)

**Note:** The `/api/ingest/process` endpoint now processes jobs when called from Vercel Cron (GET request). Previously it only returned status on GET and required POST to process.

---

## DATA_GAP_023: FFSC Foster & SCAS Cat Matching Opportunity

**Status:** FIXED (MIG_560-570)

**Problem:** 306+ FFSC Foster appointments have internal Foster IDs and foster parent names embedded in the Animal Name field that could be used to link cats to both cat records and foster people.

**Evidence:**
```sql
-- Foster IDs and names in Animal Name field
SELECT payload->>'Animal Name' as animal_name
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'appointment_info'
  AND payload->>'Animal Name' ~ '#[0-9]+'
LIMIT 5;
-- Examples:
-- "#6795/Roger (Thumhart)" - Foster ID #6795, Cat name Roger, Foster parent Thumhart
-- "#6207/ (Charleston)" - Foster ID #6207, Foster parent Charleston
-- "#6427/Jazzy (Canepa)" - Foster ID #6427, Cat name Jazzy, Foster parent Canepa
```

**Data Patterns Identified:**

1. **Foster IDs:** Internal FFSC tracking numbers like `#6795`, `#6207`
2. **Foster Parent Names:** Last name in parentheses like `(Canepa)`, `(Thumhart)`, `(Adams/Stroud)`
3. **SCAS Cats:** IDs like `A439019` are Sonoma County Animal Services transfers - can match to ShelterLuv

**Potential Matching Strategies:**

1. **Foster Parent Linking:**
   - Extract last name from parentheses: `(Canepa)` → search sot_people for "Canepa"
   - Match to person with foster role in person_roles
   - Create person_cat_relationship with role='foster'

2. **SCAS Cat Linking:**
   - Extract ShelterLuv-style IDs: `A439019`, `A429869`
   - Match to cat_identifiers.shelterluv_id
   - Link appointment to existing cat record

3. **Cat Name Deduplication:**
   - Use cat name + foster parent to find duplicate cats
   - Example: "Jazzy" under "(Canepa)" is unique identifier

**Impact:** Medium - would improve:
- Foster parent statistics (cats fostered)
- Cat lifecycle tracking (clinic → foster → adoption)
- Historical data completeness

**Notes:**
- Foster parent names can be used to link PEOPLE even if we can't link the cat
- This builds the foster relationship even without microchip data

**Fix Applied (MIG_560-570):**
1. Added `appointment_source_category` column to sot_appointments
2. Created `classify_appointment_source()` function with detection for:
   - `foster_program`: ownership_type = 'Foster' or "Forgotten Felines Foster" owner
   - `county_scas`: Owner like "A439019 SCAS"
   - `lmfm`: ALL CAPS owner name or $LMFM marker in notes
   - `other_internal`: Internal FFSC accounts
3. Backfilled via `clinichq_visits` (MIG_569)
4. Created auto-classification triggers for stability (MIG_570)
5. Created statistics views:
   - `v_foster_program_stats`, `v_foster_program_ytd`
   - `v_county_cat_stats`, `v_county_cat_ytd`
   - `v_appointment_source_breakdown`, `v_program_comparison_ytd`
6. Added 10 views to Tippy catalog (MIG_568)

**Results:**
- 1,317 foster_program appointments categorized
- 143 county_scas appointments categorized
- 361 lmfm appointments categorized
- 1,185 other_internal appointments categorized
- Tippy can now answer "How many fosters did we fix this year?"

---

## DATA_GAP_019: Clinic Place Misclassification (Confirmed)

**Status:** FIXED (MIG_930)

**Problem:** 1,431 place_contexts incorrectly marked with context_type = 'clinic' and 1 place with place_kind = 'clinic'. These were residential addresses where cat owners live, not veterinary clinics.

**Root Cause:** MIG_464 or similar inferred "clinic" from appointment context, but appointments are linked to owner addresses, not clinic location.

**Fix Applied (MIG_930):**
1. Created `known_clinic_addresses` whitelist table
2. Cleared `place_kind = 'clinic'` from non-whitelisted places (1 fixed)
3. Ended 1,431 erroneous clinic contexts with `valid_to = NOW()`
4. Created `v_clinic_places` verification view

**Results:**
- Places with place_kind = clinic: 0 (was 1)
- Active clinic contexts: 0 (was 1,431)
- Known clinic addresses table created for future reference

---

## Comprehensive Data Audit (2026-02-06)

### Overall Data Quality Score: **96.7%**

This score is a weighted average giving higher importance to entity linking (critical for attribution) and microchip tracking (essential for TNR).

### Summary by Entity Type

| Entity | Total | Quality Metric | Score | Notes |
|--------|-------|----------------|-------|-------|
| **People** | 13,537 | With contact info | 92.6% | 999 without email/phone |
| **Cats** | 36,825 | With microchip | 95.6% | 1,621 without (expected for euthanized) |
| **Places** | 15,077 | Geocoded | 99.4% | 92 ungeocoded |
| **Appointments** | 47,676 | Linked to cats | 92.5% | 3,565 missing cat link |
| **Appointments** | 47,676 | Linked to people | 98.0% | 964 missing person link |
| **Appointments** | 47,676 | Linked to places | 99.9% | 26 missing place link |
| **Requests** | 289 | With place | 100% | All complete |
| **Requests** | 289 | With requester | 99.7% | 1 missing |

### People Audit Results
| Category | Count | Priority | Status |
|----------|-------|----------|--------|
| Total unmerged | 13,537 | - | OK |
| With contact (email/phone) | 12,538 (92.6%) | - | OK |
| Skeleton records | 9 | Low | Expected (DATA_GAP_016) |
| FFSC org emails | 0 | - | FIXED |
| Organization-like names | 86 | Medium | DATA_GAP_018 |
| Location-like names | 329 | High | DATA_GAP_011 |
| First-name-only | 590 | Medium | DATA_GAP_017 |
| Potential name duplicates | 397 | Low | Expected (different people) |

### Cats Audit Results
| Category | Count | Priority | Status |
|----------|-------|----------|--------|
| Total unmerged | 36,825 | - | OK |
| With microchip | 35,204 (95.6%) | - | OK |
| Missing microchip | 1,621 (4.4%) | Low | Expected (euthanized before chip) |
| "Unknown" name | 11,749 (31.9%) | None | **Expected** - community cats from ClinicHQ |
| "Unknown + suffix" names | 79 | None | Expected |
| Potential name duplicates | 1,725 | Low | Expected (common cat names) |

### Places Audit Results
| Category | Count | Priority | Status |
|----------|-------|----------|--------|
| Total unmerged | 15,077 | - | OK |
| Geocoded | 14,985 (99.4%) | - | OK |
| Ungeocoded | 92 | Low | Need geocoding retry |
| Clinic misclassification | 1,431 | **HIGH** | DATA_GAP_019 |
| Kind = "unknown" | 14,378 (95.4%) | Low | Expected (most are residential) |

### Appointment Linking Results
| Category | Count | Pct | Status |
|----------|-------|-----|--------|
| Total appointments | 47,676 | - | OK |
| Linked to cat | 44,111 | 92.5% | OK |
| Linked to person | 46,712 | 98.0% | OK |
| Linked to place | 47,650 | 99.9% | OK |
| Missing cat only | 3,493 | 7.3% | Need investigation |
| Orphan (no links) | 0 | 0% | OK |

### Relationship Stats
| Relationship Type | Count | Notes |
|-------------------|-------|-------|
| Cat-Place links | 54,754 | 1.5 per cat avg |
| Person-Cat links | 33,177 | Foster/adopter/owner |
| Person-Place links | 19,460 | Residences |

### Staged Records (Unprocessed)
| Source | Table | Unprocessed | Notes |
|--------|-------|-------------|-------|
| ClinicHQ | appointment_info | 215 | Queue for processing |
| ClinicHQ | cat_info | 205 | Queue for processing |
| ClinicHQ | owner_info | 42 | Queue for processing |
| ShelterLuv | animals | 1,330 | Queue for processing |
| ShelterLuv | events | 11 | Queue for processing |
| ShelterLuv | people | 8 | Queue for processing |
| VolunteerHub | users | 23 | Queue for processing |

### Missing Infrastructure
| Component | Status | Impact |
|-----------|--------|--------|
| `cat_field_sources` table | **NOT APPLIED** (MIG_620) | No cross-source cat conflict detection |
| `person_field_sources` table | **NOT APPLIED** (MIG_922) | No cross-source person conflict detection |
| Unified orchestrator | **NOT APPLIED** (MIG_923) | No automated pipeline |
| Data Engine reviews | 0 pending | Identity resolution working |

### Detail Page Review (2026-02-06)
| Entity | Badges/Indicators | Status |
|--------|------------------|--------|
| Person | EntityTypeBadge (site/business/unknown), DataSourceBadge, VolunteerBadge, TrapperBadge, VerificationBadge, skeleton record warning | ✅ Good |
| Place | PlaceKind badge, Context badges (colony_site, foster_home, clinic), Partner org badges, DiseaseStatus, Verification | ⚠️ Need clinic misclassification warning |
| Cat | DECEASED, NO MICROCHIP, DataSourceBadge, OwnershipType, Multi-Source Data, FeLV/FIV status, Procedure badges | ✅ Good |

---

## DATA_GAP_020: Unified Data Cleaning Pipeline

**Status:** IN PROGRESS (MIG_922, MIG_923, MIG_924)

**Problem:** Each data source (ClinicHQ, VolunteerHub, ShelterLuv) has its own processing pipeline running independently. This causes:
1. **No unified orchestration** - No single system ensures correct processing order
2. **No person field tracking** - Cats have `cat_field_sources` but people don't
3. **No cross-source conflict visibility** - Staff can't see when sources disagree
4. **Unclear source authority** - Which source wins for which field type?

**Source Authority Map (Confirmed):**
| Data Type | Authority | Notes |
|-----------|-----------|-------|
| Cat medical data | ClinicHQ | Spay/neuter, procedures, vaccines |
| Cat identity (microchip) | ClinicHQ | Microchip is gold standard |
| Cat origin location | ClinicHQ | Appointment address = where cat came from |
| Cat current location | ShelterLuv | Outcome address = where cat is now |
| Cat outcomes | ShelterLuv | Adoption, foster, death, transfer |
| People (volunteers) | VolunteerHub | Roles, groups, hours, status |
| People (fosters) | VolunteerHub | "Approved Foster Parent" group is authority |
| People (adopters) | ShelterLuv | From adoption outcome events |
| People (clinic clients) | ClinicHQ | From appointment owner info |
| Trapper roles | VolunteerHub | Except community trappers from Airtable |
| Foster relationships | ShelterLuv reinforces VH | Cat→foster links from outcome events |

**Fix:**
- MIG_922: Added `person_field_sources` table (mirrors `cat_field_sources`)
- MIG_923: Added unified orchestrator functions and phase config
- MIG_924: Updated `survivorship_priority` with confirmed source authority
- API: `/api/cron/orchestrator-run` - Single entry point for pipeline

**Remaining Work:**
1. Create `/admin/data-conflicts` dashboard for staff resolution
2. Wire up ingest functions to call `record_person_field_source()`
3. Test full orchestrator run

---

## How to Add a New Data Gap

1. Add entry to this file with:
   - Unique ID (DATA_GAP_XXX)
   - Status
   - Problem description
   - Evidence (SQL queries)
   - Root cause
   - Proposed fix

2. Create migration file:
   - `sql/schema/sot/MIG_XXX__description.sql`

3. Update TASK_LEDGER.md with full details

4. After fix is verified, update status to FIXED

---

## DATA_GAP_024: SCAS Hyphenated ID Pattern

**Status:** OPEN (Low priority)

**Problem:** SCAS animal IDs with hyphens (e.g., "A-416620") are not being classified as `county_scas`. They're categorized as `other_internal` instead.

**Evidence:**
```sql
-- Confirmed: 1 appointment with hyphenated SCAS ID miscategorized
SELECT cv.client_first_name, cv.client_last_name, a.appointment_source_category
FROM trapper.clinichq_visits cv
JOIN trapper.sot_appointments a ON a.appointment_number = cv.appointment_number
WHERE cv.client_first_name LIKE 'A-%' AND UPPER(cv.client_last_name) = 'SCAS';
-- Result: A-416620 | SCAS | other_internal
```

**Root Cause:** The `is_scas_appointment()` function uses pattern `^A[0-9]+$` which requires the ID to be `A` followed immediately by digits. The hyphen breaks this pattern.

**Proposed Fix:**
```sql
-- Update pattern to allow optional hyphen
-- Change: p_owner_first_name ~ '^A[0-9]+$'
-- To: p_owner_first_name ~ '^A-?[0-9]+$'
```

**Impact:** Low - Only 1 appointment affected currently, but pattern may occur in future SCAS data.

---

## DATA_GAP_025: Quarterly Aggregation Not Native to Views

**Status:** OPEN (Enhancement)

**Problem:** Staff frequently ask quarterly questions like "Compare Q1 vs Q3 2025 foster program" but the views only support monthly granularity. Tippy must manually aggregate months 1-3, 4-6, 7-9, 10-12 for each query.

**Current State:**
- `v_foster_program_stats` has `year` and `month` columns
- `v_county_cat_stats` has `year` and `month` columns
- No native `quarter` column exists

**Proposed Enhancement:**
```sql
-- Add computed quarter column to statistics views
ALTER VIEW trapper.v_foster_program_stats AS
SELECT
  ...,
  EXTRACT(QUARTER FROM appointment_date)::INT as quarter,
  ...
```

Or create dedicated quarterly views:
```sql
CREATE VIEW trapper.v_foster_program_quarterly AS
SELECT
  year,
  quarter,
  SUM(unique_cats) as total_cats,
  SUM(alterations) as total_alterations,
  ...
FROM trapper.v_foster_program_stats
GROUP BY year, quarter;
```

**Impact:** Medium - Would improve Tippy's ability to answer quarterly questions directly.

---

## DATA_GAP_026: LMFM Hyphenated Name Detection Gap

**Status:** OPEN (Low priority)

**Problem:** The LMFM ALL CAPS detection pattern `[A-Z ]+` excludes hyphenated names. Names like "MARY-JANE SMITH" would not be detected as LMFM even though they're in ALL CAPS.

**Evidence:**
```sql
-- Check for hyphenated ALL CAPS names
SELECT cv.client_first_name, cv.client_last_name, a.appointment_source_category
FROM trapper.clinichq_visits cv
JOIN trapper.sot_appointments a ON a.appointment_number = cv.appointment_number
WHERE cv.client_first_name = UPPER(cv.client_first_name)
  AND cv.client_last_name = UPPER(cv.client_last_name)
  AND LENGTH(cv.client_first_name) > 1
  AND LENGTH(cv.client_last_name) > 1
  AND (cv.client_first_name LIKE '%-%' OR cv.client_last_name LIKE '%-%');
-- Result: A-416620 | SCAS (this is actually SCAS, not LMFM)
```

**Root Cause:** The `is_lmfm_appointment()` function checks `v_full_name ~ '^[A-Z ]+$'` which excludes hyphens.

**Current Impact:** Low - No confirmed LMFM participants with hyphenated names found in current data. The $LMFM marker in notes is the more reliable signal.

**Proposed Fix:**
```sql
-- Update pattern to allow hyphens
-- Change: v_full_name ~ '^[A-Z ]+$'
-- To: v_full_name ~ '^[A-Z -]+$'
```

---

## DATA_GAP_027: Missing API Endpoints for E2E Testing

**Status:** OPEN (Enhancement)

**Problem:** Several API endpoints needed for comprehensive e2e testing do not exist:

| Missing Endpoint | Purpose |
|-----------------|---------|
| `/api/health/categorization-gaps` | Report SCAS/LMFM/Foster pattern misses |
| `/api/health/lmfm-marker-audit` | Check $LMFM markers vs categories |
| `/api/health/appointment-link-breakdown` | Detailed link status counts |
| `/api/health/category-distribution` | Category percentages |
| `/api/health/trigger-status` | Verify triggers are enabled |
| `/api/admin/query` | Generic view query endpoint for testing |

**Impact:** E2E tests skip many validations due to missing endpoints.

**Proposed Fix:** Create health check API routes that expose data quality metrics.

---

## DATA_GAP_028: Appointment Owner Fields Not Populated During Ingest

**Status:** FIXED (MIG_974, ingest route update)

**Problem:** ClinicHQ appointments were created without `client_name`, `owner_email`, and `owner_phone` fields populated. This caused appointment detail modals to show "No person linked" even when owner data existed in staged_records.

**Evidence:**
```sql
-- 1,722 appointments had NULL client_name despite owner_info existing
SELECT COUNT(*) FROM trapper.sot_appointments
WHERE client_name IS NULL AND appointment_number IN (
  SELECT payload->>'Number' FROM trapper.staged_records
  WHERE source_table = 'owner_info'
);
```

**Root Cause:**
1. The appointment INSERT statement in `/apps/web/src/app/api/ingest/process/[id]/route.ts` didn't include `client_name`, `owner_email`, or `owner_phone`
2. `owner_info` processing linked appointments to people (Step 4) but never backfilled these display fields

**Fix:**
- MIG_974: One-time backfill of client_name for 1,722 appointments
- Ingest route: Added Step 4c to backfill `client_name`, `owner_email`, `owner_phone` from owner_info during every upload

**Related:**
- RISK_005 (work address pollution - same investigation)
- INV-22 (TS upload route must mirror SQL processor)

---

## DATA_GAP_029: Real Person Appointments Unlinked (Org Email Quota Issue)

**Status:** FIXED (MIG_974)

**Problem:** `link_appointments_to_owners()` uses `LIMIT 2000` per batch. Org emails (info@forgottenfelines.com) get processed first because of appointment_id ordering. These are correctly rejected by `should_be_person()`, but they consume the LIMIT quota before real person appointments get processed.

**Evidence:**
```sql
-- 30+ appointments with real person emails were unlinked
-- while org email appointments were processed (and rejected) first
SELECT owner_email, COUNT(*) FROM trapper.sot_appointments
WHERE person_id IS NULL AND owner_email IS NOT NULL
  AND owner_email NOT LIKE '%forgottenfelines%'
GROUP BY owner_email;
```

**Root Cause:** Processing order (by appointment_id) plus LIMIT meant older appointments with org emails consumed the quota before newer real person appointments.

**Fix:**
- MIG_974: Process appointments that DON'T have org emails first
- Filter: `AND a.owner_email NOT LIKE '%forgottenfelines%'`
- Result: 180+ appointments linked, 86+ person-cat relationships created

---

---

## E2E Test Coverage Added (2026-02-07)

New test files created for program statistics and data quality:

| Test File | Purpose |
|-----------|---------|
| `program-stats-accuracy.spec.ts` | Validate foster/county/LMFM view accuracy |
| `tippy-complex-queries.spec.ts` | Test complex Tippy questions (Q1 vs Q3, etc.) |
| `categorization-gaps.spec.ts` | Detect SCAS/LMFM/Foster pattern misses |
| `data-quality-comprehensive.spec.ts` | Overall data quality validation |
| `tippy-staff-workflows.spec.ts` | Real staff question testing |
| `fixtures/staff-program-questions.ts` | 20+ staff question fixtures |

These tests use real data queries and validate Tippy's accuracy against database views.

---

## DATA_GAP_031: Pseudo-Profile Pollution from ClinicHQ Bulk Import

**Status:** FIXED (MIG_2337)

**Problem:** During V2 ClinicHQ bulk import (direct-import.cjs), pseudo-profiles were created in sot.people that should have been routed to ops.clinic_accounts:

| Record | Issue | Cat Count |
|--------|-------|-----------|
| Rebooking placeholder | ClinicHQ system account with fake identifiers | 2,381 |
| Speedy Creek Winery | Organization name, not person | 116 |
| Petaluma Poultry | Organization name, not person | 91 |
| Keller Estates Vineyards | Organization name, not person | 64 |
| Petaluma Livestock Auction | Organization name, not person | 31 |

**Evidence:**
```sql
-- High cat counts with suspicious names
SELECT person_id, first_name, last_name,
       (SELECT COUNT(*) FROM sot.person_cat WHERE person_id = p.person_id) as cat_count
FROM sot.people p
WHERE first_name ILIKE '%rebooking%' OR last_name ILIKE '%placeholder%'
   OR first_name ILIKE '%speedy creek%' OR first_name ILIKE '%petaluma%'
   OR first_name ILIKE '%keller%';
-- Result: 5 pseudo-profiles with 2,683 total cats

-- Entity linking propagated cats to placeholder's address
SELECT COUNT(*) FROM sot.cat_place_relationships
WHERE place_id IN (
  SELECT place_id FROM sot.person_place
  WHERE person_id = 'a12eaac7-edfe-48c1-88c6-53576be12afb'  -- Rebooking placeholder
);
-- Result: 5,553 polluted relationships (35,243 cleaned before MIG_2337)
```

**Root Cause:**
1. `should_be_person()` passed because contact info existed (fake @noemail.com domain, FFSC phone)
2. ClinicHQ uses "Owner First Name" for site names / org names as booking practice
3. Entity linking (`link_cats_to_places()`) propagated cats to these records' places
4. No detection for placeholder names or organization keywords

**Fix Applied (MIG_2337):**
1. Archived polluted people to `ops.archived_people` (preserve audit trail)
2. Moved to `ops.clinic_accounts` (preserve raw data for reference)
3. Deleted relationships (person_cat, person_place, identifiers)
4. Marked people with `merged_into_person_id = self` (archived indicator)
5. Updated `should_be_person()` to reject:
   - Fake email domains (@noemail.com, @petestablished.com, @example.com)
   - Placeholder names (rebooking, placeholder, unknown, test)
   - Organization keywords (winery, poultry, ranch, farm, vineyard, auction, estates)
   - FFSC phone (7075767999) with no real email
6. Created `ops.v_suspicious_people` monitoring view for ongoing detection
7. Added entries to `sot.soft_blacklist` for fake domains/phones

**Verification:**
```sql
-- Confirm should_be_person() rejects fake patterns
SELECT sot.should_be_person('Rebooking', 'placeholder', 'test@noemail.com', '7075767999');
-- Should return FALSE

-- Check monitoring view for new issues
SELECT * FROM ops.v_suspicious_people;
-- Review regularly for new pollution
```

**Related Invariants:**
- INV-25: ClinicHQ Pseudo-Profiles Are NOT People
- INV-29: Data Engine Rejects No-Identifier Cases
- CLAUDE.md: sot_people contains ONLY real people

---

## DATA_GAP_030: V2 Database Migration - UUID and Location Loss

**Status:** CRITICAL - IN PROGRESS

**Problem:** The V1→V2 database migration created NEW UUIDs for all entities instead of preserving the original `place_id`, `person_id`, `cat_id` values. Additionally, the `location` column (PostGIS geography with geocoded coordinates) was not copied. Result:

1. **13,933 places with coordinates in V1** → **0 places with coordinates in V2**
2. **No UUID overlap** between V1 and V2 entities
3. **Map completely broken** — `v_map_atlas_pins` returns 0 rows
4. **All foreign key relationships broken** — relationships can't match entities

**Evidence:**
```sql
-- V1: 13,933 places have geocoded locations
SELECT COUNT(*) FROM trapper.places WHERE location IS NOT NULL;
-- Result: 13,933

-- V2: 0 places have geocoded locations
SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL;
-- Result: 0

-- UUID match attempt: 0 matches
SELECT COUNT(*)
FROM v1.places v1
JOIN v2.sot.places v2 ON v1.place_id = v2.place_id;
-- Result: 0
```

**Root Cause:** Migration scripts used patterns that created new entities instead of preserving existing ones:
1. Used `INSERT ... DEFAULT` instead of `INSERT ... SELECT place_id, ...`
2. Relied on `find_or_create_place_deduped()` which creates new UUIDs when no match found
3. Skipped `location` column during entity copy
4. No verification step to confirm UUID preservation

**Impact:**
- Map doesn't load (0 pins)
- Entity relationships broken
- Audit trails disconnected
- Merge chains broken
- Months of geocoding work lost

**Correct Migration Pattern:**
```sql
-- CORRECT: Preserve UUIDs explicitly
INSERT INTO v2.sot.places (
  place_id,           -- EXPLICIT UUID preservation
  display_name,
  formatted_address,
  location,           -- DON'T skip location!
  service_zone,
  merged_into_place_id,
  source_system,
  created_at,
  updated_at
)
SELECT
  place_id,           -- Same UUID as V1
  display_name,
  formatted_address,
  location,           -- Copy the geography
  service_zone,
  merged_into_place_id,
  source_system,
  created_at,
  updated_at
FROM v1.trapper.places;
```

**Fix Required:**
1. Create cross-database migration script that:
   - Matches V2 places to V1 by `normalized_address` or `formatted_address`
   - Copies `location` from matched V1 record
   - For unmatched records, re-queue for geocoding
2. Add migration verification queries to all future migrations
3. Document UUID preservation as invariant (added to CLAUDE.md #36-38)

**Lessons Learned:**
1. **Never use "simple fix" migrations** for schema changes
2. **Always verify UUID counts** before and after migration
3. **All columns must be accounted for** — missing columns = broken features
4. **Test migrations on staging** before production
5. **Add invariant checks to CI** — UUID counts should match

**Related Invariants:**
- CLAUDE.md #36: Database Migrations MUST Preserve Entity UUIDs
- CLAUDE.md #37: Database Migrations MUST Include All Columns
- CLAUDE.md #38: No "Simple Fixes" for Schema Migrations

---

## DATA_GAP_032: Cat Entity Deduplication System

**Status:** FIXED (MIG_2340, MIG_2341)

**Problem:** Three duplicate cat scenarios were causing data integrity issues:

| Scenario | Example | Root Cause |
|----------|---------|------------|
| **Microchip backfill** | Cat "Chip" visited without chip, returned with chip | Cat created on first visit, new cat created on chipped return |
| **Different ClinicHQ IDs** | "Pixie" had two records (26-386 and 26-616) | Staff created new Animal record in ClinicHQ instead of finding existing |
| **Microchip typos** | Chips differ by 1-2 characters | Data entry errors during microchip scanning |

**Evidence (before fix):**
```sql
-- Pixie: Same name, same owner (John Reiche), different cat_ids
-- One record had no chip, other had chip 981020053843999
SELECT cat_id, name, microchip, clinichq_animal_id
FROM sot.cats WHERE name ILIKE 'pixie%'
AND merged_into_cat_id IS NULL;
-- Result: 2 different cat_ids for same physical cat
```

**Fix Applied:**

### MIG_2340: Import-Time Backfill
- `find_or_create_cat_by_microchip()` now checks `clinichq_animal_id` as fallback
- If found by ID, adds microchip to existing cat instead of creating duplicate
- Created `ops.v_cats_awaiting_microchip` monitoring view

### MIG_2341: Batch Detection & Resolution
1. **Confidence column** added to `sot.cat_identifiers` (1.0 = gold standard microchip)

2. **Common name blocking** via `ops.common_cat_names`:
   - 292 names tracked (>5 occurrences)
   - 16 names blocked (>50 occurrences, e.g., "Shadow", "Tiger")
   - "Unknown" explicitly excluded from all name-based matching

3. **Three detection views** (split for performance):
   | View | Detects | Current Count |
   |------|---------|---------------|
   | `ops.v_cat_dedup_same_owner` | Same name + same owner + one chipped | 8 |
   | `ops.v_cat_dedup_chip_typos` | Microchip edit distance 1-2 | 606 |
   | `ops.v_cat_dedup_duplicate_ids` | Same microchip or clinichq_id | 0 |

4. **Merge function** `sot.merge_cats(loser_id, winner_id, reason, changed_by)`:
   - Reassigns appointments
   - Moves all identifiers, relationships
   - Logs to `entity_edits` for audit trail
   - Marks loser with `merged_into_cat_id`

5. **Weekly scan function** `ops.run_cat_dedup_scan()`:
   - Refreshes common names table
   - Returns candidate counts by category

**False Positive Prevention:**
| Safeguard | Implementation |
|-----------|---------------|
| No name-only matching | Requires same owner OR microchip similarity |
| Common name blocking | >50 occurrences = blocked from name matching |
| Sex/color blocking | Only compare cats with same sex OR color |
| Sequential chip exclusion | Chips within 5 of each other numerically are excluded (legitimate batch) |
| "Unknown" exclusion | 11,749 "Unknown" cats never matched by name |

**Confidence Scoring:**
| Match Type | Confidence | Action |
|------------|------------|--------|
| Exact microchip | 1.0 | Auto-merge (data integrity issue) |
| Same clinichq_animal_id | 0.95 | Auto-merge (data integrity issue) |
| Same name + owner + one chipped | 0.85 | Review queue |
| Microchip edit distance = 1 | 0.80 | Review queue |
| Microchip edit distance = 2 | 0.65 | Review queue |

**Manual Merges Completed (2026-02-18):**
- Pixie (John Reiche) - 26-386 → 26-616
- Mordecai - duplicate merged
- Cali - duplicate merged
- Zepher - duplicate merged

**Ongoing Monitoring:**
```sql
-- Weekly scan
SELECT * FROM ops.run_cat_dedup_scan();

-- Review high-confidence same-owner candidates (likely duplicates)
SELECT * FROM ops.v_cat_dedup_same_owner;

-- Review chip typos (verify before merge)
SELECT * FROM ops.v_cat_dedup_chip_typos LIMIT 20;

-- Check for data integrity issues (should be 0)
SELECT * FROM ops.v_cat_dedup_duplicate_ids;
```

**Future Enhancement:** Staff review UI at `/admin/cat-dedup` for processing the queue.

**Related Invariants:**
- CLAUDE.md: Never match cats by name alone
- CLAUDE.md: Microchip is gold standard identifier

---

## DATA_GAP_033: Business Names Not Classified as Organizations

**Status:** FIXED (MIG_2373 - 2026-02-19)

**Problem:** `classify_owner_name()` function returned "likely_person" for business names that didn't match existing hardcoded patterns.

**Root Cause:** The function used hardcoded regex patterns which:
1. Missed business service words like "Carpets", "Surgery", "Market"
2. Couldn't detect "World Of X" naming pattern
3. Falsely classified occupation surnames (Carpenter, Baker) as businesses

**Fix Applied (MIG_2373):**

1. **Reference Data Integration:**
   - US Census surnames (162,254 records) → `ref.census_surnames`
   - SSA baby names (104,819 records) → `ref.first_names`
   - Business keywords (136 curated) → `ref.business_keywords`

2. **Updated `sot.classify_owner_name()`:**
   - Now uses gazetteer lookups instead of hardcoded regex
   - Business score calculation from `ref.get_business_score()`
   - First name + census surname validation for person detection
   - FFSC site patterns (Ranch, Farm, Winery) prioritized before business score

3. **Helper Functions Added:**
   - `ref.is_common_first_name(name, threshold)` - SSA validation
   - `ref.is_census_surname(name)` - Census validation
   - `ref.get_business_score(name)` - Business keyword scoring
   - `ref.is_occupation_surname(name)` - Occupation surname safelist
   - `sot.explain_name_classification(name)` - Debug helper

**Verification:**
```sql
-- All tests now pass
SELECT sot.classify_owner_name('John Carpenter');     -- likely_person ✓
SELECT sot.classify_owner_name('Atlas Tree Surgery'); -- organization ✓
SELECT sot.classify_owner_name('World Of Carpets');   -- organization ✓
SELECT sot.classify_owner_name('Silveira Ranch');     -- site_name ✓
SELECT sot.classify_owner_name('Bob''s Plumbing');    -- organization ✓
```

**Related:** INV-43, INV-44, INV-45 in CLAUDE.md

---

## DATA_GAP_034: World Of Carpets Place Missing from Atlas

**Status:** OPEN (Investigation Complete)

**Problem:** Keri Howard traps cats at "World Of Carpets" (3023 Santa Rosa Ave, Santa Rosa, CA 95407), but this address doesn't exist in sot.places.

**Evidence:**
```sql
-- Raw ClinicHQ data shows 2 records for this address:
SELECT payload->>'Owner Address', payload->>'Owner First Name', payload->>'Owner Last Name'
FROM source.clinichq_raw
WHERE payload->>'Owner Address' ILIKE '%3023%santa%rosa%';
-- Result: "World Of Carpets Santa Rosa" / "FFSC" at 3023 Santa Rosa Ave

-- But place doesn't exist:
SELECT * FROM sot.places
WHERE formatted_address ILIKE '%3023%santa%rosa%';
-- (0 rows)
```

**Root Cause Analysis:**

1. **Booking Account Structure:** The "World Of Carpets" records have NO appointment data:
   - Empty appointment number
   - Empty microchip
   - Empty cat name
   - Empty animal ID

   These are ClinicHQ "booking accounts" (contact records), not actual appointments.

2. **Why Place Wasn't Created:** The ingest pipeline only creates places from records with actual appointment data. Since these records have no appointments, no place was created.

3. **Where Did the Cat Go?** The one cat from this location (appt 24-3232) got linked to:
   - Person: "Atlas Tree Surgery" (WRONG - should be World Of Carpets or the trapper)
   - Place: "1544 Ludwig Ave, Santa Rosa, CA 95407" (WRONG address)

   This suggests the appointment data had different owner info than the booking account.

**Impact:**
- World Of Carpets site has cats but no Atlas place record
- Beacon won't show this colony location
- Colony estimates won't include this site

**Proposed Fix:**

1. **Manual place creation** (if cats will continue coming from this location):
```sql
SELECT sot.find_or_create_place_deduped(
  '3023 Santa Rosa Ave, Santa Rosa, CA 95407',
  'World Of Carpets',
  NULL, NULL,
  'atlas_ui'
);
```

2. **Re-link cats** to the correct place after verifying which cats actually came from there.

3. **Long-term:** Add a pattern to detect when ClinicHQ booking accounts exist but aren't creating places, and flag them for manual review.

**Related:** DATA_GAP_033 (business name classification)

---

## DATA_GAP_035: Request Edge Cases (4 Records)

**Status:** KNOWN LIMITATION

**Problem:** 4 airtable requests cannot have requester_person_id linked due to edge cases:
- Organization names used as requester
- Soft-blacklisted emails (org emails)
- "Dr." prefix edge cases

**Impact:** 1.8% of requests (4/291) without requester link. Acceptable.

---

## DATA_GAP_036: Ear Tip Recording Rate Declining (Historical)

**Status:** MONITORING ADDED (2026-02-20)

**Discovered:** 2026-02-19
**Monitoring Added:** 2026-02-20

**Problem:** Ear tip recording rates for community cats have declined from 80% to 53% between 2019-2025, even before the Jan 2026 export issue.

**Monitoring Added:**
- `ops.appointments.has_ear_tip` column added (MIG_2412)
- `ops.v_ear_tip_rate_by_year` view tracks annual trends
- `ops.v_ear_tip_rate_by_period` view tracks monthly trends
- `ops.v_ear_tip_rate_recent` view for dashboard (30/90 day, YTD)

**Evidence:**
| Year | Community Cat Surgeries | Ear Tips Recorded | Rate |
|------|------------------------|-------------------|------|
| 2019 | 785 | 633 | 80.6% |
| 2020 | 1,486 | 935 | 62.9% |
| 2021 | 2,112 | 1,611 | 76.3% |
| 2022 | 2,444 | 1,735 | 71.0% |
| 2023 | 2,687 | 1,483 | 55.2% |
| 2024 | 3,175 | 1,723 | 54.3% |
| 2025 | 3,022 | 1,607 | 53.2% |

**Possible Root Causes:**
1. More cats returning already ear-tipped (previous TNR)
2. Staff not consistently adding "Ear Tip" service to appointments
3. Some cats genuinely not ear-tipped (medical reasons, owned cats)
4. Different data entry practices over time

**Required Analysis:**
1. Check if cats without ear tip service had previous appointments with ear tip
2. Review whether "already ear tipped" is recorded anywhere in ClinicHQ
3. Staff training on consistent ear tip service recording
4. Consider adding "Already Ear Tipped" checkbox to ClinicHQ workflow

**Impact:** Medium - Cannot accurately report on new vs returning TNR cats.

---

## DATA_GAP_037: ClinicHQ Service Lines Missing Since Jan 12, 2026

**Status:** FIXED (2026-02-20)

**Discovered:** 2026-02-19
**Fixed:** 2026-02-20

**Problem:** Starting January 12, 2026, ClinicHQ exports dropped from ~13 service lines per appointment to ~5. Only primary procedures (Cat Spay/Neuter) are being exported. All ancillary services are missing.

**Fix Applied:**
1. FFSC provided corrected export files (report_813a*.xlsx, report_0812c*.xlsx, report_6607b*.xlsx)
2. Ingested 11,738 rows (9,430 service lines + 1,154 cat + 1,154 owner records)
3. Created `ops.v_clinichq_export_health` monitoring view (MIG_2410)
4. Added `has_ear_tip` column to appointments (MIG_2412)
5. Created ear tip rate monitoring views (MIG_2413)

**Results After Fix:**
- Services per appointment: 8.7 (was 4.8)
- Ear tips recovered: 434 (was 5-7)
- Microchips recovered: 943 (was 0)
- Revolution recovered: 990 (was 0)

**Ongoing Monitoring:**
- `ops.v_clinichq_export_health` shows health status per week
- `ops.check_clinichq_export_health()` returns current health status
- Alert if services_per_appt < 6 or microchips = 0

**Evidence:**
```sql
-- Service lines per appointment by week
Week        | Avg Services | Appointments
2026-01-05  | 12.5         | 115 (normal)
2026-01-12  | 4.8          | 114 (BROKEN - 62% DROP)
2026-01-19  | 5.0          | 129 (still broken)
2026-02-09  | 5.1          | 91  (still broken)
```

**Missing Services Comparison (Jan 5-11 vs Jan 12+):**
| Service | Jan 5-11 | Jan 12+ | Drop |
|---------|----------|---------|------|
| Microchip | 91 | 0 | 100% |
| Revolution | 102 | 0 | 100% |
| Subcutaneous Fluids | 101 | 0 | 100% |
| FVRCP vaccine | 102 | 9 | 91% |
| TTD | 100 | 6 | 94% |
| Ear Tip | 41 | 5 | 88% |
| Buprenorphine | 96 | 6 | 94% |

**Root Cause:** ClinicHQ export configuration changed on or around January 12, 2026. The export is no longer including the full service/subsidy breakdown.

**Required Fix:**
1. **FFSC Staff Action:** Check ClinicHQ export settings - ensure "Service / Subsidy" includes ALL service lines, not just primary procedure
2. **Re-export:** Re-export all appointments from Jan 12, 2026 to present with full service data
3. **Re-ingest:** Process the corrected export through Atlas ingest pipeline
4. **Verification:** Confirm avg services/appointment returns to ~13

**Affected Records:** ~500+ appointments (Jan 12, 2026 - present)

**Impact:**
- Ear tip rate shows 10% when it should be ~50%
- Microchip data missing for 500+ cats
- Vaccine records incomplete
- Medication records incomplete
- Cannot report on ancillary services

**Workaround:** Until fixed, cannot accurately report on ear tips, microchips, vaccines, or medication usage for appointments after Jan 12, 2026.

---

## DATA_GAP_038: ClinicHQ Billing Data Never Exported

**Status:** CRITICAL - HISTORICAL

**Discovered:** 2026-02-19

**Problem:** The `Total Invoiced` and `Sub Value` fields in ClinicHQ exports have NEVER contained actual billing data. All values are either 0 or NULL across all 400k+ records since 2013.

**Evidence:**
```sql
-- Non-zero invoices by year (out of 400k+ records)
Year | Total Rows | Has Non-Zero Invoice
2013 |     10     | 0
2014 | 10,053     | 0
...
2019 | 37,759     | 73 (only year with any data!)
2020 | 22,774     | 91 (only year with any data!)
2021 | 43,047     | 0
...
2026 |  4,324     | 0
```

Only 164 records out of 400k+ have ever had non-zero invoice data (all in 2019-2020).

**Root Cause Options:**
1. ClinicHQ export has never been configured to include billing data
2. Billing is tracked in a separate system (QuickBooks, Square, etc.)
3. FFSC uses a different ClinicHQ module for billing that isn't in the export

**Required Fix:**
1. **FFSC Staff Action:** Determine where billing data lives:
   - Is it in ClinicHQ? If so, configure export to include it
   - Is it in QuickBooks/Square/other? Create integration
2. **Schema:** May need new `ops.appointment_billing` table for financial data
3. **Backfill:** If historical billing data exists elsewhere, import it

**Impact:**
- Cannot calculate revenue per appointment
- Cannot report on subsidy utilization
- Cannot distinguish paid vs subsidized services
- Cannot calculate cost per cat fixed
- Cannot answer "How much did we charge for community cats?"

**Workaround:** None - billing data must come from wherever FFSC tracks it.

---

## DATA_GAP_039: Mega-Place - Invalid V2 Migration cat_place Links

**Status:** FIXED (MIG_2419)

**Discovered:** 2026-02-21

**Problem:** 217 Healdsburg Ave (Healdsburg Chamber of Commerce) had 2,387 cats linked via `evidence_type = 'person_relationship'`, but only 7 cats were actually booked there. 2,347 of these cat_place relationships had NO backing person_cat relationships.

**Root Cause:** V2 migration from V1 incorrectly created cat_place relationships with `evidence_type = 'person_relationship'` for cats that had no actual person_cat relationships. This was orphaned/garbage data from the migration.

**Evidence:**
```sql
-- Before fix: 217 Healdsburg Ave
relationship_type | evidence_type       | source_system  | cnt
home              | person_relationship | entity_linking | 2375
appointment_site  | appointment         | atlas          | 6
home              | appointment         | atlas          | 6

-- 2,346 of 2,375 had NO person_cat backing:
SELECT COUNT(*) FROM sot.cat_place cp
WHERE cp.place_id = '9420ddb8-...'
AND cp.evidence_type = 'person_relationship'
AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = cp.cat_id);
-- Result: 2346
```

**Fix Applied (MIG_2419):**
1. Archived 2,347 invalid cat_place relationships to `ops.archived_invalid_cat_place`
2. Deleted the invalid relationships
3. Blacklisted Healdsburg Chamber of Commerce as non-residential trapping site
4. Updated place_kind to 'business'

**Result After Fix:**
- Cat count: 2,387 → 35 (legitimate links only)
- All remaining links have valid backing (person_cat or appointment)
- Place correctly classified and blacklisted

**Prevention:** Added audit query to detect places with invalid person_relationship links (no backing person_cat). Run periodically:
```sql
SELECT p.place_id, p.display_name, COUNT(*)
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE cp.evidence_type = 'person_relationship'
AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = cp.cat_id)
GROUP BY p.place_id, p.display_name
HAVING COUNT(*) > 10;
```

**Verified:** No other mega-places found with this issue.

---

## DATA_GAP_040: Entity Linking Function Fragility

**Status:** OPEN (Audit Complete - Fortification Needed)

**Discovered:** 2026-02-21

**Problem:** Several entity linking functions have fragile patterns that can cause silent data loss or incorrect links. Identified through comprehensive code audit.

### Critical Fragility (Risk Level: CRITICAL/HIGH)

| Function | Risk | Fragile Pattern | Impact |
|----------|------|-----------------|--------|
| `sot.link_appointments_to_places()` | CRITICAL | Subquery may return NULL silently | Appointments get `place_id = NULL` if subquery fails |
| `sot.link_cats_to_appointment_places()` | HIGH | `COALESCE(a.inferred_place_id, a.place_id)` fallback | Falls back to clinic address when `inferred_place_id` is NULL |
| `sot.link_cats_to_places()` | HIGH | LATERAL join with NULL returns | Creates incomplete relationships when person_place not found |
| `sot.run_all_entity_linking()` | HIGH | Order-dependent execution without validation | Later steps may run on incomplete data from failed earlier steps |
| `sot.link_cat_to_place()` | MEDIUM | String comparison of confidence values | `'high' > 'medium'` works but is fragile; use CASE WHEN |

### Detailed Analysis

**1. `link_appointments_to_places()` - Silent NULL Updates**
```sql
-- FRAGILE: If subquery returns NULL, appointment gets NULL place_id
UPDATE ops.appointments a
SET place_id = (
    SELECT p.place_id
    FROM sot.places p
    WHERE normalize_address(p.formatted_address) = normalize_address(...)
    LIMIT 1
)
WHERE a.place_id IS NULL;

-- SAFER: Use explicit join with validation
WITH matched AS (
    SELECT a.appointment_id, p.place_id
    FROM ops.appointments a
    JOIN sot.places p ON normalize_address(p.formatted_address) = ...
    WHERE a.place_id IS NULL
)
UPDATE ops.appointments a
SET place_id = m.place_id
FROM matched m
WHERE a.appointment_id = m.appointment_id;
```

**2. `link_cats_to_appointment_places()` - Clinic Fallback**
```sql
-- CURRENT (MIG_2010:410): Falls back to clinic when inferred_place_id NULL
INSERT INTO sot.cat_place (cat_id, place_id, ...)
SELECT DISTINCT ON (a.cat_id)
    a.cat_id,
    COALESCE(a.inferred_place_id, a.place_id),  -- <-- Fallback to clinic
    ...
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL;

-- ISSUE: If inferred_place_id is NULL, cat gets linked to clinic (845 Todd, 1814/1820 Empire Industrial)
```

**Evidence of Clinic Leakage:**
- `QRY_050__cat_place_audit.sql` Section 5 checks for cats linked to clinic addresses
- Places with `place_kind = 'clinic'` or address matching clinic should NOT have residential cat links

**3. `run_all_entity_linking()` - Order Dependency**
```sql
-- CURRENT (MIG_2010): Steps run sequentially with no validation
PERFORM sot.link_appointments_to_places();      -- Step 1
PERFORM sot.link_cats_to_appointment_places();  -- Step 2 (depends on Step 1)
PERFORM sot.link_cats_to_places();              -- Step 3 (depends on person_cat)
-- No verification between steps!
```

**Proposed Fortifications:**

1. **Add step validation in orchestrator:**
```sql
CREATE OR REPLACE FUNCTION sot.run_all_entity_linking() RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_step1_success INT;
    v_step2_success INT;
BEGIN
    -- Step 1 with validation
    PERFORM sot.link_appointments_to_places();
    SELECT COUNT(*) INTO v_step1_success
    FROM ops.appointments WHERE place_id IS NOT NULL;
    v_result := v_result || jsonb_build_object('step1_places', v_step1_success);

    IF v_step1_success = 0 THEN
        RAISE WARNING 'Step 1 produced no results - aborting';
        RETURN v_result || '{"status": "aborted", "reason": "step1_failed"}'::jsonb;
    END IF;

    -- Continue with remaining steps...
    RETURN v_result || '{"status": "completed"}'::jsonb;
END;
$$ LANGUAGE plpgsql;
```

2. **Replace COALESCE fallback with explicit NULL filtering:**
```sql
-- Only process appointments with valid inferred_place_id
WHERE a.cat_id IS NOT NULL
  AND a.inferred_place_id IS NOT NULL  -- Don't fallback!
```

3. **Add confidence filter validation:**
```sql
-- Add to sot.cat_place table constraint
ALTER TABLE sot.cat_place ADD CONSTRAINT valid_confidence
CHECK (confidence IN ('high', 'medium', 'low') OR confidence IS NULL);
```

### Audit Query Created

`/sql/queries/QRY_050__cat_place_audit.sql` - Comprehensive audit that checks:
1. Overview statistics (cats with appointments vs place links)
2. Relationship type distribution
3. Cats with appointments but no place link (breakdown by reason)
4. COALESCE fallback audit (where `inferred_place_id` was NULL)
5. Clinic place leakage check
6. Appointment vs cat_place consistency
7. Person-chain vs appointment link conflicts
8. Fragile function indicators (NULL checks)

**Proposed Fix Priority:**
1. HIGH: Remove COALESCE fallback to clinic in `link_cats_to_appointment_places()`
2. HIGH: Add validation between steps in `run_all_entity_linking()`
3. MEDIUM: Convert string confidence to enum/numeric in `cat_place`
4. LOW: Refactor subqueries to explicit JOINs

**Related:**
- MIG_2010: Original entity linking functions
- MIG_2305: Fixed 'appointment_site' → 'home' relationship type
- MIG_889: Added LIMIT 1 + staff exclusion to `link_cats_to_places()`
- INV-26, INV-28: Cat-place linking invariants

---

## DATA_GAP_041: MIG_2421 Confidence Helper Function Adoption

**Status:** OPEN (Migration Created)

**Discovered:** 2026-02-21

**Problem:** Confidence filter (`>= 0.5`) for `person_identifiers` is duplicated in 50+ places across views and routes. PetLink emails are fabricated and have low confidence (0.1-0.2). Per INV-19/INV-21, all queries must filter these out.

**Current State:**
- Filter duplicated as inline `AND confidence >= 0.5` in:
  - Multiple API routes (`/api/people/search`, `/api/requests/[id]`, `/api/cats/[id]`, etc.)
  - Views (`v_person_list_v3`, etc.)
  - SQL functions (`data_engine_score_candidates()`)

**Fix Created:**
`MIG_2421__confidence_helper_function.sql` - Creates centralized helper functions:

| Function | Purpose |
|----------|---------|
| `sot.get_high_confidence_identifier(person_id, id_type, min_confidence)` | Get best identifier of type |
| `sot.get_email(person_id)` | Convenience for email (default 0.5) |
| `sot.get_phone(person_id)` | Convenience for phone (default 0.5) |
| `sot.has_high_confidence_identifier(person_id, id_type, min_confidence)` | Boolean check |
| `sot.get_all_identifiers(person_id, min_confidence)` | JSONB array for API responses |

**Adoption Required:**
1. Apply MIG_2421 to create functions
2. Update views to use `sot.get_email(person_id)` instead of inline subqueries
3. Update API routes to use helper functions
4. Remove duplicated confidence filter logic

**Example Refactor:**
```sql
-- BEFORE (duplicated in 50+ places):
(SELECT pi.id_value_norm FROM sot.person_identifiers pi
 WHERE pi.person_id = r.requester_person_id
   AND pi.id_type = 'email'
   AND pi.confidence >= 0.5
 ORDER BY pi.confidence DESC LIMIT 1) AS requester_email

-- AFTER (single source of truth):
sot.get_email(r.requester_person_id) AS requester_email
```

**Impact:** Medium - improves maintainability and reduces risk of missing confidence filter.

**Related:**
- INV-19: PetLink Emails Are Fabricated
- INV-21: Confidence >= 0.5 Filter Must Be Consistent
- MIG_887: Original PetLink email classification

---

## DATA_GAP_042: System Cohesiveness Gaps

**Status:** IN PROGRESS (Critical bugs fixed)

**Discovered:** 2026-02-21

**Problem:** Comprehensive audit of automated systems revealed several cohesiveness gaps preventing automatic processing.

### Critical Bugs Found (FIXED)

**1. Entity Linking Cron Return Type Mismatch**

MIG_2432 changed `sot.run_all_entity_linking()` to return JSONB, but the cron expected `TABLE(operation, count)`.

**Fix:** Updated `/api/cron/entity-linking/route.ts` to parse JSONB response.

**2. VolunteerHub Cron Not Configured**

The route `/api/cron/volunteerhub-sync` existed but was NOT in `vercel.json`.

**Fix:** Added to vercel.json: `{ "path": "/api/cron/volunteerhub-sync", "schedule": "0 7 * * *" }`

### Pending Record Types Explained

| Record Type | Count | Why Pending | Automatic? |
|-------------|-------|-------------|------------|
| Places without geocode | 623 | Queue processes 50/30min (2,400/day). Clears in ~6h. Some have permanent failures. | ✅ YES (rate-limited) |
| Suspicious people | 79 | Conflicting identifiers require manual review via `/admin/person-dedup` | ❌ Manual REQUIRED |
| Cats without appointments | 5,624 | PetLink-only (956), ShelterLuv unprocessed, ClinicHQ no contact | ⚠️ Structural ceiling |
| Cats without place/person | 9,802 | No identifiers to link | ⚠️ Structural ceiling |

### Automated Systems Audit

| System | Schedule | Purpose | Status |
|--------|----------|---------|--------|
| Geocoding | Every 30 min | Address → coordinates | ✅ Running |
| Entity Linking | Every 15 min | Link cats/people/places | ✅ Fixed (MIG_2432 compat) |
| Process Uploads | Every 10 min | ClinicHQ/SL file processing | ✅ Running |
| ShelterLuv Sync | Every 6 hours | Animals, people, events | ✅ Running |
| Airtable Sync | Daily 6 AM | Intake submissions | ✅ Running |
| VolunteerHub Sync | Daily 7 AM | Volunteers, roles | ✅ Fixed (added to vercel.json) |
| Data Quality Check | Every 6 hours | Monitoring metrics | ✅ Running |

### New Monitoring Added

**MIG_2440:** Created `ops.check_system_cohesiveness()` function that checks:
- Geocoding queue size and failures
- Entity linking run frequency
- Staged records backlog
- Stuck file uploads
- Data engine review queue
- Source sync freshness
- Overall cat-place coverage

**Usage:**
```sql
-- Show all issues
SELECT * FROM ops.check_system_cohesiveness() WHERE status != 'OK';

-- Summary by system
SELECT * FROM ops.v_system_health_summary;
```

### Action Items

1. **Manual Review Required:** 79 people flagged for identity conflicts → `/admin/person-dedup`
2. **Apply MIG_2440:** For comprehensive monitoring
3. **Deploy vercel.json:** To enable VolunteerHub sync
4. **Deploy entity-linking route fix:** For JSONB compatibility

**Related:**
- DATA_GAP_040: Entity Linking Function Fragility
- MIG_2432: Orchestrator Validation
- MIG_2440: System Cohesiveness Check

---

## DATA_GAP_043: V1→V2 Function Migration Gap (CRITICAL)

**Status:** IN PROGRESS (Core functions created)

**Discovered:** 2026-02-21

**Problem:** Multiple critical processing functions were never migrated from V1 (`trapper.*`) to V2 (`ops.*`/`sot.*`). The entity-linking cron calls these functions but they don't exist, causing silent failures.

### Missing Functions Found

| V1 Function | V2 Function | Status | Impact |
|-------------|-------------|--------|--------|
| `trapper.process_clinichq_unchipped_cats` | `ops.process_clinichq_unchipped_cats` | ✅ CREATED | Cats without microchips not being processed |
| `trapper.process_clinichq_cat_info` | `ops.process_clinichq_cat_info` | ✅ CREATED | Cat catch-up processing broken |
| `trapper.process_clinichq_owner_info` | `ops.process_clinichq_owner_info` | ✅ CREATED | Owner catch-up processing broken |
| `trapper.process_clinic_euthanasia` (MIG_892) | `ops.process_clinic_euthanasia` | ⚠️ STUB | Euthanized cats not being marked |
| `trapper.process_embedded_microchips_in_animal_names` (MIG_911) | `ops.process_embedded_microchips_in_animal_names` | ⚠️ STUB | Microchips in names not extracted |
| `trapper.retry_unmatched_master_list_entries` (MIG_900) | `ops.retry_unmatched_master_list_entries` | ⚠️ STUB | Master list matching not retrying |

### Root Cause

The V2 database migration copied table data but didn't migrate all SQL functions. The entity-linking cron (`/api/cron/entity-linking/route.ts`) was updated to call `ops.*` functions, but the functions were never created.

### Why This Caused 9,800+ Unlinked Cats

1. **Unchipped cats dropped silently**: `process_clinichq_unchipped_cats` creates cats from Animal ID when no microchip exists
2. **No catch-up processing**: When appointments are uploaded before cats, the catch-up functions link them later
3. **Appointments orphaned**: Without cat records, appointments have `cat_id = NULL` permanently

### Fix Applied (MIG_2441)

1. Created `ops.process_clinichq_unchipped_cats()` - Full implementation
2. Created `ops.process_clinichq_cat_info()` - Full implementation
3. Created `ops.process_clinichq_owner_info()` - Full implementation
4. Created stub functions for others to prevent cron crash
5. Linked orphaned appointments by microchip and clinichq_animal_id

### Verification

After applying MIG_2441:
```sql
-- Check appointment linking
SELECT
    EXTRACT(YEAR FROM appointment_date) as year,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as no_cat,
    ROUND(100.0 * COUNT(*) FILTER (WHERE cat_id IS NULL) / COUNT(*), 1) as pct_no_cat
FROM ops.appointments
GROUP BY 1
ORDER BY 1 DESC;

-- Test unchipped cat processing
SELECT * FROM ops.process_clinichq_unchipped_cats(1000);
```

### TODO

1. Fully migrate `ops.process_clinic_euthanasia` from V1 MIG_892
2. Fully migrate `ops.process_embedded_microchips_in_animal_names` from V1 MIG_911
3. Fully migrate `ops.retry_unmatched_master_list_entries` from V1 MIG_900

**Related:**
- MIG_891: Original V1 unchipped cat processing
- MIG_892: Original V1 euthanasia processing
- MIG_911: Original V1 embedded microchip extraction
- MIG_900: Original V1 master list retry

---

## DATA_GAP_044: ClinicHQ Place Creation Skipped for Non-Person Addresses

**Status:** FIXED (MIG_2443)

**Discovered:** 2026-02-21

**Problem:** `process_clinichq_owner_info()` only creates places inside the person-creation loop. When `should_be_person()` returns FALSE (orgs, address-as-names, etc.), the address is skipped and NO PLACE is created.

### Evidence

```sql
-- 319 addresses in ClinicHQ with no corresponding place
SELECT COUNT(DISTINCT TRIM(sr.payload->>'Owner Address')) as addresses_no_place
FROM ops.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM sot.places p
      WHERE p.normalized_address = sot.normalize_address(TRIM(sr.payload->>'Owner Address'))
  );
```

### Root Cause

The TS ingest route (`/api/ingest/process/[id]/route.ts`) correctly creates places for ALL addresses in Step 2. But the SQL processor (`process_clinichq_owner_info`) used by the entity-linking cron catch-up only creates places when creating people.

### Fix Applied (MIG_2443)

Created `ops.process_clinichq_addresses()` function that:
1. Creates places for ALL owner_info addresses regardless of `should_be_person()`
2. Links appointments to newly created places
3. Is called by entity-linking cron after `process_clinichq_owner_info()`

### Result

- 319 places created
- 1,593 appointments linked to places

---

## DATA_GAP_045: ShelterLuv Data Engine Does NOT Create Places

**Status:** FIXED (MIG_2444)

**Discovered:** 2026-02-21

**Problem:** ShelterLuv processing uses the Data Engine (`data_engine_resolve_identity`) which creates/matches PEOPLE but does NOT create PLACES. This leaves:
- 2,540 ShelterLuv people with addresses but NO place link (97.8% coverage gap)
- 3,875 ShelterLuv cats with NO person link
- 1,985 animals with AssociatedPerson (foster) data not being used

### Evidence

```sql
-- ShelterLuv people have addresses but no places
SELECT 
    COUNT(*) as total_with_address,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.person_id = sr.resulting_entity_id
    )) as has_place_link
FROM ops.staged_records sr
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'people'
  AND sr.payload->>'Street' IS NOT NULL
  AND sr.resulting_entity_id IS NOT NULL;
-- Result: 2,597 with address, only 57 with place link!

-- ShelterLuv cats have AssociatedPerson data not being used
SELECT COUNT(*) FROM ops.staged_records sr
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'animals'
  AND sr.payload->'AssociatedPerson'->>'FirstName' IS NOT NULL;
-- Result: 1,985 records with foster relationships
```

### Root Cause

The ShelterLuv ingest creates people via the Data Engine but:
1. Data Engine only handles identity (person matching/creation)
2. Data Engine does NOT create places from person addresses
3. ShelterLuv cat import doesn't link cats to their AssociatedPerson (foster/adopter)

### Fix Applied (MIG_2444)

1. Create places from ShelterLuv person addresses using `find_or_create_place_deduped()`
2. Link ShelterLuv people to their places via `person_place`
3. Link ShelterLuv cats to their associated persons (foster/adopter/caretaker) via `person_cat`
4. Run entity linking to propagate cat-place links

### Key Field Mappings

- Cats: `shelterluv_animal_id` matches staged_records `payload->>'Internal-ID'`
- People: Match by `FirstName`/`LastName` (capital N in ShelterLuv)
- Addresses: `Street`, `City`, `State`, `Zip` in staged_records payload

### Result

- 3,177 places created
- 2,710 person-place links created
- 435 person-cat links created (foster/adopter relationships)
- 358 cat-place links propagated via entity linking
- ShelterLuv people coverage: 2.2% → 99.5%
- Overall cat-place coverage: 80.0% → 80.8%

### Remaining Gaps (Historical)

- 478 ShelterLuv cats have `FFSC-A-XXXX` ID format that doesn't match numeric IDs in staged_records
- These are from earlier imports with different ID format - not a current pipeline issue

---

## DATA_GAP_046: PetLink Cats Have No Address Data

**Status:** WONT FIX

**Discovered:** 2026-02-21

**Problem:** 1,691 PetLink cats have no place links.

### Root Cause

PetLink cats were bulk imported via microchip registry data. The import contains ONLY microchip information - no addresses or owner contacts. These cats exist in the microchip registry but were never seen at FFSC clinic or ShelterLuv.

### Why WONT FIX

This is not a bug or pipeline issue. PetLink is an external microchip registry that only contains:
- Microchip number
- Cat name
- Sometimes owner name (but no address)

There is no source address data to create places from. If these cats ever show up at FFSC clinic or ShelterLuv, they will be linked via microchip matching.

### Verification

```sql
-- No staged_records for PetLink
SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'petlink';
-- Result: 0 (cats were bulk imported, not via staged_records)
```
