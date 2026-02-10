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
