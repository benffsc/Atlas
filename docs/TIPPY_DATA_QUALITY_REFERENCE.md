# Tippy Data Quality Reference

**Purpose:** This document provides Tippy with authoritative information to explain data discrepancies to staff when questions arise about missing or unlinked records.

## Data Source Characteristics

Understanding the strengths and limitations of each data source is critical for accurate interpretation.

### Source Overview

| Source | Reliability | Coverage | Limitations | Best For |
|--------|-------------|----------|-------------|----------|
| **ClinicHQ** | High (ground truth) | Cats at clinic only | Messy historical data, no API for client notes | Alteration verification |
| **Airtable** | Medium | Workflow data | Legacy migration issues, inconsistent entry | Request tracking |
| **Google Maps KMZ** | Variable | 20+ years of notes | Predecessor's notes, inconsistent formatting | Historical context |
| **Web Intake** | High | New submissions only | Self-reported, may exaggerate | Initial triage |
| **VolunteerHub** | High | FFSC volunteers only | Volunteer data only, no cat/request data | Volunteer management, role tracking |
| **Sonoma County (Census)** | High | Demographic only | 5-year lag, zip-level granularity | Socioeconomic context |

---

### ClinicHQ (Clinic Data)

**What it is:** FFSC's veterinary practice management system. Contains appointment records, procedures, microchips, and basic client info.

**Strengths:**
- ✅ **Ground truth for alterations** - If a cat was spayed/neutered at FFSC, it's here
- ✅ **Microchip verification** - Gold standard identifier
- ✅ **Procedure details** - What was actually done
- ✅ **89% of appointments successfully linked** to cat records

**Limitations:**
- ⚠️ **No API for client long notes** - Rich context locked in system (future enhancement)
- ⚠️ **Historical data quality issues** - Pre-2020 records have inconsistent entry
- ⚠️ **Owner info often missing/incorrect** - Many community cats have placeholder owners
- ⚠️ **4% of TNR appointments have no microchip** - Data entry gaps
- ⚠️ **Animal Name field misuse** - Sometimes contains microchip, weight, or notes instead of name

**What Tippy should know:**
> "ClinicHQ is our ground truth for alterations but has historical data quality issues. If a record seems incomplete, check if the appointment predates 2020 when data entry practices were less standardized."

**Keep Separate:** Workflows (Atlas) vs Clinic Operations (ClinicHQ) - don't overwrite clinical records

---

### Airtable (Workflow Data)

**What it is:** Legacy workflow system, being replaced by Atlas. Contains requests, person info, trapper assignments.

**Strengths:**
- ✅ **Rich request history** - Years of intake and assignment data
- ✅ **Person relationships** - Who requested help, who trapped
- ✅ **Trapper notes** - Field observations

**Limitations:**
- ⚠️ **Legacy migration artifacts** - Some records have placeholder IDs
- ⚠️ **Inconsistent data entry** - Different staff, different standards over time
- ⚠️ **Duplicate people** - Same person created multiple times with variations
- ⚠️ **source_system = 'airtable'** covers multiple original sources (staff entries, Project 75, historical imports)
- ⚠️ **Cat counts may be estimates** - `estimated_cat_count` semantics changed over time

**What Tippy should know:**
> "Airtable data predates Atlas and has some inconsistencies. Person records may be duplicated - always check `merged_into_person_id`. Request cat counts may be 'total at location' (old) or 'still needing TNR' (new) based on `cat_count_semantic`."

**Keep Separate:** Use Atlas for current workflows, Airtable for historical context

---

### Google Maps KMZ (Historical Context)

**What it is:** 20+ years of accumulated notes from FFSC's predecessor, imported from Google Maps pins.

**Strengths:**
- ✅ **Institutional memory** - Information nowhere else
- ✅ **Historical disease locations** - FeLV/FIV colonies documented
- ✅ **Volunteer/difficult client flags** - Hard-won knowledge
- ✅ **Geographic coverage** - 5,624 documented locations

**Limitations:**
- ⚠️ **Icon colors are UNRELIABLE** - Predecessor used colors inconsistently
- ⚠️ **Text is source of truth** - Must AI-parse content, not rely on icon
- ⚠️ **Outdated information** - Some notes are 10+ years old
- ⚠️ **No standard format** - Free-form notes, abbreviations, shorthand
- ⚠️ **Location accuracy varies** - Some pins are approximate
- ⚠️ **Linking requires inference** - Phone/name matching to existing entities

**What Tippy should know:**
> "Google Maps notes contain valuable historical context but may be outdated. Always cross-reference with recent clinic activity. The AI classification extracts meaning from TEXT, not icon colors. Conditions marked in Google Maps may be long-resolved."

**Extraction Priority:** Disease mentions > Safety concerns > Colony info

---

### Web Intake (New Submissions)

**What it is:** Public intake form submissions from FFSC's website.

**Strengths:**
- ✅ **Fresh data** - Current information from callers
- ✅ **Structured fields** - Standard questions answered
- ✅ **Contact info** - Email/phone for follow-up
- ✅ **Self-categorization** - Caller indicates relationship to cats

**Limitations:**
- ⚠️ **Self-reported** - May exaggerate counts or urgency
- ⚠️ **Caller perspective only** - May not be the owner
- ⚠️ **Duplicate submissions** - Same person may submit multiple times
- ⚠️ **Location accuracy** - Address may be approximate or wrong
- ⚠️ **Emergency mislabeling** - People click "emergency" for non-emergencies

**What Tippy should know:**
> "Web intake data is self-reported by callers. Treat cat counts as estimates (usually inflated). 'Emergency' designation needs staff verification. Always geocode and validate addresses before creating records."

**Confidence Adjustment:** Apply 0.7x multiplier to self-reported counts

---

### VolunteerHub (Volunteer Data)

**What it is:** FFSC's volunteer management system. Contains all volunteer signups, group memberships, hours, skills, availability, and profile data. Synced via API every 6 hours.

**Strengths:**
- Staff-curated: every volunteer personally signed up and was approved by staff
- 47 user groups with temporal join/leave tracking
- Rich profile data: skills, availability, languages, pronouns, occupation, motivation
- Hours logged and event participation tracked
- Authority for FFSC volunteer/trapper status (VH "Approved Trappers" group = ffsc_trapper)

**Limitations:**
- Volunteer data only — no cat or request data
- Some volunteers have no email/phone in VH (9 of 1346 = 0.7%)
- Historical hours/events not available via API v2 (only v1, which has limited fields)
- Two VH records can represent the same person (duplicate VH accounts)

**Data Quality:**
- `data_quality = 'normal'` for VH people with email/phone (99.3%)
- `data_quality = 'skeleton'` for VH people with name only, no contact info (0.7%)
- Skeleton people are automatically enriched when contact info appears in subsequent syncs
- VH is a "trusted source" — allowed to create name-only skeleton people (unlike ClinicHQ)

**What Tippy should know:**
> "VolunteerHub data is curated — these are real people who signed up as volunteers. If a person record shows data_source='volunteerhub' and data_quality='skeleton', it means they have no email or phone on file yet. Their name is real but we can't verify identity until contact info arrives. When they update their VH profile or visit the clinic, the skeleton record will automatically merge with or promote to a full record."

**Key Tables:**
- `volunteerhub_volunteers` — staging/mirror of VH user data (1346 records)
- `volunteerhub_user_groups` — 47 VH groups with atlas_role mapping
- `volunteerhub_group_memberships` — temporal join/leave tracking
- `trusted_person_sources` — registry controlling which sources allow skeleton creation

---

### Reference Data (Census, Parameters)

**What it is:** External reference data for ecological modeling.

**Tables:**
- `ref_sonoma_geography` - Census demographics by zip code
- `ref_ecological_parameters` - Boone et al. population parameters
- `ref_organizations` - Local shelters and partners

**Strengths:**
- ✅ **Scientifically validated** - Peer-reviewed sources
- ✅ **Consistent methodology** - US Census standards
- ✅ **Useful for predictions** - Socioeconomic factors correlate with TNR needs

**Limitations:**
- ⚠️ **5-year lag** - Census ACS data is years old
- ⚠️ **Zip-level granularity** - Can't distinguish neighborhoods
- ⚠️ **Sonoma-specific caveats** - Some parameters may not apply locally
- ⚠️ **Read-only** - Never modified by AI or staff

**What Tippy should know:**
> "Reference data provides context for predictions but shouldn't override observed reality. If census predicts high TNR need but we have no activity, that's a data gap to investigate, not proof of low need."

---

### Data Source Confidence Hierarchy

When sources conflict, prioritize in this order:

1. **Manual staff entry** (confidence 1.0) - Human verified
2. **ClinicHQ records** (confidence 0.95) - Ground truth for clinic data
3. **Recent Airtable/Atlas** (confidence 0.85) - Workflow data < 2 years old
4. **Web intake** (confidence 0.70) - Self-reported
5. **Google Maps AI-parsed** (confidence 0.65) - Historical, may be outdated
6. **Old Airtable** (confidence 0.60) - > 2 years old
7. **AI inference from notes** (confidence 0.50-0.80) - Depends on explicitness

---

### Future Data Sources

**ClinicHQ API (Client Long Notes)** - When available:
- Will unlock rich historical context from clinic records
- Contains owner communications, behavior observations
- Source: `source_system = 'clinichq_api'`
- Keep extraction approach extensible for this

**ShelterLuv** - Adoption/return data:
- Already imported but underutilized
- Contains adoption outcomes, returns, transfers
- Could enrich person-cat relationships

---

## Appointment-Cat Linking Status

Atlas tracks why appointments may or may not be linked to cat records via the `cat_linking_status` column.

### Current Status Distribution (as of January 2026)

| Status | Count | Percentage | Description |
|--------|-------|------------|-------------|
| `linked` | 42,436 | 89.66% | Successfully linked to a cat record via microchip |
| `non_tnr_service` | 2,428 | 5.13% | Non-spay/neuter services (exams, consultations) - no cat expected |
| `no_microchip` | 1,914 | 4.04% | TNR appointments where no microchip was recorded in source data |
| `linked_via_animal_name_MIG_551` | 262 | 0.55% | Recovered via microchip hidden in Animal Name field |
| `linked_via_person_cat_name` | 240 | 0.51% | Recovered via owner email + cat name matching |
| `linked_via_animal_name_auto` | 40 | 0.08% | Linked via automatic extraction of multi-format microchips (AVID 9-digit, HomeAgain 10-digit, truncated 14-digit) |
| `linked_via_name_extraction` | 11 | 0.02% | Linked via name-based extraction |
| `linked_via_animal_name_manual` | 1 | <0.01% | Manually linked |

### Query to Check Current Status

```sql
SELECT
  cat_linking_status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM trapper.sot_appointments
GROUP BY cat_linking_status
ORDER BY count DESC;
```

---

## Why Some Data Is Unrecoverable

### 1. No Microchip in Source Data (~1,914 appointments)

These are legitimate TNR appointments (spay/neuter) but ClinicHQ's source data has no microchip recorded. Possible reasons:
- Cat was microchipped but number wasn't entered in ClinicHQ
- Cat wasn't microchipped at that appointment (rare for FFSC)
- Data entry error or system issue at time of appointment

**Impact:** These appointments are counted in overall FFSC statistics but cannot be linked to a specific cat record. The cat may exist in the system under a different appointment.

### 2. Non-TNR Services (~2,428 appointments)

These are non-surgical appointments like:
- Wellness exams
- Consultations
- Vaccinations only
- Follow-up visits

**Impact:** These often don't involve a specific tracked cat and are expected to be unlinked. This is normal and not a data quality issue.

### 3. Unresolvable Records (~13 appointments)

These have some identifying information but it's insufficient or ambiguous:
- Partial microchip numbers (fewer than 9 digits)
- Names only without any identifier
- Conflicting information

**Impact:** Cannot be automatically linked without manual research.

### 4. Shelter IDs (Not Microchips)

Some Animal Name fields contain shelter animal IDs (like `A425849`) instead of microchips. These are internal shelter tracking numbers, not universal identifiers.

**Impact:** Cannot be used to link cats across systems. The cat may be in the system with a proper microchip from a different appointment.

---

## Microchip Format Support

Atlas supports multiple microchip formats:

| Format | Digits | Example | Manufacturer |
|--------|--------|---------|--------------|
| ISO Standard | 15 | `981020053524791` | International (most common) |
| AVID FriendChip | 9 | `086523606` | AVID (encrypted) |
| HomeAgain | 10 | `0A133F4543` | Digital Angel |
| AVID EuroChip | 10 | `4737160067` | AVID |
| Truncated ISO | 14 | `9810200535247` | Data entry error (1 digit missing) |

### Identifier Types in Database

| `id_type` | Description |
|-----------|-------------|
| `microchip` | Standard ISO 15-digit |
| `microchip_avid` | AVID 9-digit encrypted format |
| `microchip_10digit` | HomeAgain/AVID 10-digit |
| `microchip_truncated` | Likely ISO with 1 missing digit |
| `shelter_animal_id` | Shelter internal ID (not a microchip) |
| `clinichq_animal_id` | ClinicHQ internal animal number |

---

## What Tippy Should Tell Staff

### When asked about missing cat links:

> "Some clinic appointments cannot be linked to specific cat records because the source data from ClinicHQ didn't include a microchip number. This affects about 4% of TNR appointments. These are still counted in overall clinic statistics, but we can't attribute them to a specific cat's history."

### When asked about a specific appointment:

> "If you believe an appointment should be linked to a specific cat, please check if:
> 1. The cat's microchip is in our system (search by chip number)
> 2. The appointment date matches expected clinic visits
> 3. The owner information matches
> Then contact an admin to manually link the records."

### When explaining overall data quality:

> "About 90% of all clinic appointments are successfully linked to cat records. Of the remaining 10%, most are non-surgical services that don't require cat tracking, and about 4% are TNR appointments where the microchip wasn't recorded in the source system. This is typical for data imported from external systems."

### When asked about discrepancies between counts:

> "Total appointment counts and linked cat counts will differ because:
> 1. Some appointments are for services that don't involve specific tracked cats (exams, consultations)
> 2. Some appointments have missing microchip data in the source system
> 3. Some cats have multiple appointments, so cat count < appointment count for linked records"

---

## Migrations Reference

| Migration | Purpose |
|-----------|---------|
| MIG_549 | Added `cat_linking_status` column, initial categorization |
| MIG_551 | Fixed microchips hidden in Animal Name field (262 recovered) |
| MIG_552 | Created reusable extraction function |
| MIG_553 | Added multi-format microchip support (9, 10, 14, 15 digit) |
| MIG_554 | Processed existing records with non-standard formats |

---

## Related Documentation

- `CLAUDE.md` - Overall Atlas data model and rules
- `docs/DATA_QUALITY_ANALYSIS.md` - Broader data quality assessment
- `docs/DATA_INGESTION_RULES.md` - How data flows into Atlas

---

## Data Quality Fix Log

This is a running log of data quality fixes and improvements. Add new entries at the top.

### 2026-01-30: Ingestion Pipeline Fix — Four Blocking Bugs (MIG_795)

**Problem:** The ClinicHQ owner_info processing pipeline was completely broken. Every upload attempt failed. Investigation revealed four interconnected bugs:

1. **Missing function:** `update_person_contact_info(uuid, text, text, text)` was called by `data_engine_resolve_identity()` on the auto_match path but never created. Error: function does not exist.
2. **Wrong column name:** `process_next_job()` referenced `next_attempt_at` but the actual column in `processing_jobs` is `next_retry_at`. Error: column does not exist.
3. **Invalid review_status:** `data_engine_resolve_identity()` wrote `review_status = 'needs_review'` but the check constraint only allowed: not_required, pending, approved, rejected, merged, kept_separate, deferred. Error: violates check constraint.
4. **Missing result column:** `process_next_job()` wrote to a `result` JSONB column that was never created on `processing_jobs`. Error: column does not exist.

**Combined impact:** owner_info processing ALWAYS failed. The cron pipeline couldn't claim jobs (Bug 2+4), and inline processing crashed on identity resolution (Bug 1+3). 73 queued jobs accumulated and stalled.

**Investigation:**
- Traced error from file upload → post-processing → `find_or_create_person()` → `data_engine_resolve_identity()` → `update_person_contact_info()` (missing)
- Found Bug 2 in MIG_772 line 88: `next_attempt_at` vs actual column `next_retry_at`
- Found Bug 3 in MIG_573 line 259: writes `'needs_review'` to `data_engine_match_decisions.review_status`
- Found Bug 4: MIG_772's `process_next_job()` references `result` column never created

**Solution:** MIG_795 — Four fixes:
- Bug 1: Created `update_person_contact_info()` function (adds email/phone identifiers, sets primary if null)
- Bug 2: Replaced `process_next_job()` with corrected column name
- Bug 3: Expanded check constraint to accept `'needs_review'` as valid value
- Bug 4: Added `result JSONB` column to `processing_jobs`
- Expired 73 stuck owner_info jobs

**Result:** Full pipeline verified working. `data_engine_resolve_identity()`, `find_or_create_person()`, `update_person_contact_info()`, and `process_next_job()` all pass. Owner_info file uploads should now process successfully.

**What Tippy should know:**
> "The owner_info processing pipeline was broken from January 18-30 due to missing database functions and column mismatches. This has been fixed (MIG_795). If staff see a gap in owner contact info for that period, it's because the pipeline wasn't running. Re-uploading the owner_info file should backfill the missing data."

### 2026-01-30: Cat-Place Linking Pipeline Stall and Validation Gap

**Problem:** Cats from the January 26, 2026 clinic day were not linked to any place. Investigation revealed two issues:

1. **Pipeline stall:** The `process_clinichq_owner_info()` backfill job last ran January 18. All appointments from Jan 19-26 had zero `owner_email`/`owner_phone`, completely blocking the automatic cat→place linking pipeline.

2. **No relationship validation:** `cat_place_relationships` and `person_cat_relationships` accept any INSERT with valid UUIDs — no check that the cat was actually observed at that place. A manual fix initially linked the wrong person's cats to the wrong place because no guardrail flagged the error.

**Investigation:**
- January 2026: 16.3% of appointments missing owner contact info (vs 0.2-1.4% baseline in 2025)
- System-wide: 3,511 cats (9.6%) have no place link at all
- Relationship tables have FK and uniqueness constraints but zero semantic validation
- The entity linking chain (`run_all_entity_linking()`) also has a check constraint bug that prevents it from running

**Solution:**
- Fixed individual data: Joanie Springer's 1 cat linked to her request place, Judy Arnold's 8 cats linked to her own place (898 Butler Ave)
- Fixed bad place merge: "36 Verde Circle" was incorrectly merged into "107 Verde Ct" instead of "36 Rancho Verde Cir"
- Fixed API: Added `merged_into_place_id IS NULL` filter to `/api/people/[id]` associated_places query
- Added North Star rules: INV-8 (merge-aware queries), INV-9 (cat linking requires owner info), INV-10 (relationship tables require centralized functions)
- Pipeline backfill needs to be re-run for Jan 19-26 data

**Result:** Data corrected for Joanie and Judy. Structural fixes (centralized validation functions, pipeline re-run) still needed.

**What Tippy should know:**
> "If cats from a recent clinic day aren't showing on a request, it may be because the owner contact info backfill hasn't run yet. The pipeline needs owner_email or owner_phone to link cats to places. Check if `process_clinichq_owner_info()` has run since the last data ingest."

### 2026-01-29: Fix Duplicate Colony Estimate on Request Completion

**Problem:** When staff completed a request using the CompleteRequestModal with observation data (cats seen, eartips seen), the system created **two** colony estimate records in `place_colony_estimates` from the same observation. The modal sent data to two endpoints sequentially:

1. `POST /api/observations` → created a `site_observations` row → trigger `trg_site_obs_colony_estimate` fired → inserted a `place_colony_estimates` record with the raw count
2. `PATCH /api/requests/{id}` → called `record_completion_observation()` → inserted **another** `place_colony_estimates` record with Chapman estimate + `is_final_observation = TRUE`

The `UNIQUE (source_system, source_record_id)` constraint didn't catch this because Path 1 stored `source_record_id = <observation_id>` while Path 2 left `source_record_id = NULL`, and PostgreSQL treats `NULL != NULL` for unique constraints.

**Investigation:** Full pipeline audit of the request completion → clinic data attribution flow. Traced the dual-write through CompleteRequestModal.tsx (lines 103-139), the observations API POST handler, the site_observations trigger (MIG_454), and `record_completion_observation()` (MIG_563).

**Solution:** MIG_790 — Modified `record_completion_observation()` to detect a trigger-created colony estimate (matching place, date, and linked site_observation for this request). If found, it UPDATEs that record with enrichment data (is_final_observation, Chapman estimate, accuracy verification) instead of INSERT-ing a duplicate. Backward compatible: if no trigger record exists, it still INSERTs as before.

**Result:** 0 existing duplicates found (bug existed but hadn't been triggered yet). Function replaced, all colony views resolve correctly. Rule INV-7 added to North Star to prevent similar dual-write bugs.

**What Tippy should know:**
> "Colony estimates are now properly deduplicated when requests are completed with observation data. Each completion creates exactly one colony estimate record, enriched with Chapman population estimate and accuracy verification."

### 2026-01-21: Multi-Format Microchip Support

**Problem:** Atlas only extracted 15-digit ISO microchips, missing AVID 9-digit, HomeAgain 10-digit, and truncated 14-digit formats.

**Investigation:** Found 40 unlinked appointments with valid non-standard microchip formats:
- 20 truncated 14-digit (likely data entry errors missing 1 digit)
- 10 AVID 9-digit encrypted format
- 2 HomeAgain 10-digit format
- 8 other non-standard lengths

**Solution:**
- MIG_553: Created `detect_microchip_format()` function to classify chip formats
- MIG_554: Processed existing unlinked records
- Added `format_confidence` tracking (high/medium/low)

**Result:** 36 new cats created, 40 appointments linked

---

### 2026-01-21: Microchip Extraction from Animal Name Field

**Problem:** 263 clinic appointments had microchips hidden in the "Animal Name" field (e.g., "Whiskers 981020053524791") instead of the dedicated microchip field.

**Investigation:** Discovered during analysis of the Heather Singkeo case where cat 981020033918588 showed ownership by Gary but was brought in by Heather.

**Solution:**
- MIG_551: One-time fix to extract and create cats from existing records
- MIG_552: Created reusable `extract_and_link_microchips_from_animal_name()` function for ongoing use

**Result:** 262 appointments linked, ongoing automatic extraction enabled

---

### 2026-01-21: Person-Cat Relationship Tracking (brought_in_by vs owner)

**Problem:** When someone other than the registered owner brings a cat to the clinic, they were incorrectly being recorded as the owner.

**Investigation:** Heather Singkeo brought in cat 981020033918588 (owned by Gary) multiple times. System couldn't distinguish "brought in by" from "owner".

**Solution:**
- MIG_544-547: Created `person_cat_relationships` table with relationship types
- MIG_550: Fixed function to properly track owner vs brought_in_by relationships
- Added `/api/cats/[id]` and `/api/people/[id]/cats` endpoints

**Result:** Staff can now see both "Owner: Gary" and "Brought in by: Heather Singkeo" on cat records

---

### 2026-01-20: Heather Singkeo Duplicate Person Records

**Problem:** 5 duplicate person records existed for Heather Singkeo due to different data sources creating separate records.

**Investigation:** Found records from ClinicHQ, web intake, and Airtable all creating separate Heather records.

**Solution:** MIG_548 (discovered already fixed by MIG_363 via merge_people function)

**Result:** 1 canonical Heather Singkeo record with 4 merged duplicates

---

## Operational vs Ecological Data Layers

Atlas uses a two-layer data model for place information:

### Operational Layer (Current State)

Use for staff workflow questions like "Is there an active request here?"

| View | Purpose |
|------|---------|
| `v_place_operational_state` | Current operational status - active requests, contexts |
| `mv_place_context_summary` | Pre-computed context for fast lookups |
| `v_request_current_trappers` | Active trapper assignments |

### Ecological Layer (Historical Context)

Use for analysis questions like "Was this ever a hoarder site?"

| View | Purpose |
|------|---------|
| `v_place_ecological_context` | Full historical context including resolved conditions |
| `v_place_complete_profile` | Combined operational + ecological with interpretation hints |
| `place_condition_history` | Bitemporal history of conditions |
| `place_colony_timeline` | Colony size estimates over time |

### Key Concepts

**Bitemporal Modeling:**
- `valid_from`/`valid_to`: When condition was TRUE in reality
- `recorded_at`: When we learned about it in the database

**Historical Source:**
A place that was historically significant for cat populations (hoarding, breeding crisis) but may now be resolved. Important for understanding regional cats even when current activity is low.

**Data Gap:**
A geographic zone with sparse data. May indicate lack of activity OR lack of data collection - distinguish carefully.

### Query Examples

```sql
-- Operational: Current state
SELECT * FROM trapper.v_place_operational_state
WHERE has_active_request = true;

-- Ecological: Historical
SELECT * FROM trapper.v_place_ecological_context
WHERE was_significant_source = true;

-- Complete profile with both layers
SELECT * FROM trapper.v_place_complete_profile
WHERE place_id = 'your-uuid';
```

---

## Socioeconomic Data Integration

Atlas includes US Census data for Sonoma County zip codes to help predict areas with higher TNR needs.

### Available Fields

| Field | Description |
|-------|-------------|
| `median_household_income` | From Census ACS 5-year |
| `pct_below_poverty` | Percentage of households below poverty line |
| `pct_renter_occupied` | Percentage of housing units that are renter-occupied |
| `pct_mobile_homes` | Percentage of housing that are mobile homes/trailers |
| `pet_ownership_index` | Computed score (0-100) predicting unaltered pet likelihood |
| `tnr_priority_score` | Computed TNR priority based on socioeconomic + ecological factors |

### Pet Ownership Index Calculation

Higher scores indicate areas more likely to have unaltered pets:
- Lower income (+)
- Higher renter percentage (+)
- Mobile homes (+)
- Poverty rate (+)

### Query Examples

```sql
-- High priority areas
SELECT area_name, tnr_priority_score, pet_ownership_index
FROM trapper.ref_sonoma_geography
WHERE area_type = 'zip'
ORDER BY tnr_priority_score DESC;

-- Correlation with actual activity
SELECT * FROM trapper.v_area_tnr_correlation
WHERE correlation_status = 'underserved';
```

---

## Data Freshness Tracking

Atlas tracks when each data category was last refreshed to prevent stale data.

### View: `v_data_staleness_alerts`

Shows which data needs refreshing:

| Status | Meaning |
|--------|---------|
| `fresh` | Recently refreshed, within threshold |
| `aging` | Approaching staleness threshold (75%+) |
| `stale` | Exceeded staleness threshold |
| `never_refreshed` | No refresh recorded |

### Data Categories

| Category | Threshold | Notes |
|----------|-----------|-------|
| `census_demographics` | 365 days | US Census ACS, updated annually |
| `google_maps_classification` | 30 days | AI classification of Google Maps entries |
| `place_conditions` | 180 days | Historical ecological conditions |
| `zone_data_coverage` | 7 days | Data coverage statistics |
| `colony_estimates` | 90 days | Colony size estimates |

---

## Development Session Log

Brief summaries of development sessions for context on system evolution.

### Session: 2026-01-25 (Part 2) - AI Data Capture System

**Context:** User asked to have AI go through ALL historical data to extract structured, queryable attributes.

**Key Discoveries:**
1. 11 major tables contain unstructured text needing extraction
2. ~87,000 total records across all sources
3. Estimated one-time extraction cost: ~$43 (using Haiku)
4. Priority extraction keywords enable targeted, cost-effective processing

**Changes Made:**
- MIG_710: Entity attributes system (29 attribute definitions, extraction tracking)
- Created attribute-extractor.mjs (shared extraction utility)
- Created extract_clinic_attributes.mjs (cat/place from appointment notes)
- Created extract_request_attributes.mjs (request/place/person from notes)
- Created seed_attributes_from_google_maps.mjs (free - uses existing classifications)
- Added 6 views to Tippy catalog (v_place_attributes, v_person_attributes, etc.)

**Staff Impact:**
- Tippy can now answer "Which places have kitten history?" directly via SQL
- Safety concerns automatically flagged from historical notes
- Disease-risk locations automatically identified
- Colony status inferred from text descriptions

---

### Session: 2026-01-25 (Part 1) - Temporal Data Architecture & Ecological Context

**Context:** Building comprehensive ecological modeling system for Beacon and Tippy.

**Key Discoveries:**
1. Need to separate operational state ("is there an active request?") from ecological context ("was this a hoarder site?")
2. Socioeconomic factors (income, housing type) correlate with unaltered pet populations
3. Historical sources affect regional populations for 10-20 years after intervention

**Changes Made:**
- MIG_720: Bitemporal place history schema (place_condition_history, place_colony_timeline)
- MIG_721: Socioeconomic reference data (ref_sonoma_geography with Census data)
- MIG_722: Tippy ecological documentation (schema docs, view catalog)
- MIG_723: Enhanced get_place_context() with ecological layer
- Updated PlaceContextPanel with ecological sections
- Enhanced Guardian cron with zone coverage and freshness tracking
- Created import_census_demographics.mjs (37 Sonoma County zip codes)
- Created seed_historical_conditions.mjs (500+ conditions from Google Maps)

**Staff Impact:**
- PlaceContextPanel now shows historical conditions and zone demographics
- Tippy can answer "Was this ever a hoarder site?" type questions
- Data staleness alerts prevent outdated information

---

### Session: 2026-01-21 - Cat Migration & Multi-Stakeholder Tracking

**Context:** Staff asked "who is Heather Singkeo and why does she appear on so many cat records?"

**Key Discoveries:**
1. Heather is a community member who frequently brings cats to clinic for neighbors
2. System wasn't distinguishing owner vs person-who-brought-cat
3. Many microchips were hidden in Animal Name field
4. Non-standard microchip formats (AVID, HomeAgain) weren't being recognized

**Changes Made:**
- MIG_544-554: Complete person-cat relationship system
- Multi-format microchip detection
- Automatic extraction from Animal Name field
- Created this documentation for Tippy reference

**Staff Impact:** Can now accurately answer "who owns this cat" vs "who brought this cat to clinic"

---

### Session: 2026-01-17 - Comprehensive Data Audit

**Context:** Pre-launch data quality review

**Key Findings:**
- ~47,000 appointments total
- ~90% successfully linked to cat records
- ~4% TNR appointments missing microchip data (unrecoverable)
- ~5% non-TNR services (expected to be unlinked)

**Documentation:** See `docs/COMPREHENSIVE_DATA_AUDIT_2026_01_17.md`

---

## How to Add to This Log

When making data quality fixes, add an entry with:

```markdown
### YYYY-MM-DD: Brief Title

**Problem:** What was wrong or missing

**Investigation:** How was it discovered, what analysis was done

**Solution:** Which migrations/code changes fixed it

**Result:** Quantified outcome (X records fixed, Y% improvement)
```

For development sessions, add:

```markdown
### Session: YYYY-MM-DD - Topic

**Context:** Why this work was initiated

**Key Discoveries:** What was learned

**Changes Made:** Brief list of migrations/features

**Staff Impact:** How this affects staff workflows
```

---

## Entity Attributes System (AI Data Capture)

Atlas uses an AI-powered attribute extraction system to convert unstructured text into queryable structured data.

### Overview

| Component | Purpose |
|-----------|---------|
| `entity_attribute_definitions` | Registry of 29 extractable attributes |
| `entity_attributes` | Stored extracted values with confidence |
| `attribute_extraction_jobs` | Audit trail of extraction runs |

### Attribute Categories

**Place Attributes (10):**
- `has_kitten_history` - Kittens documented at location
- `has_disease_history` - FeLV/FIV documented at location
- `has_mortality_history` - Deaths documented
- `feeder_present` - Active feeder exists
- `colony_status` - active/managed/resolved/unknown
- `estimated_colony_size` - Cat count estimate
- `property_type` - residential/commercial/farm/etc.
- `access_difficulty` - easy/moderate/difficult
- `has_breeding_activity` - Ongoing reproduction
- `has_relocation_history` - Cats relocated to/from

**Person Attributes (7):**
- `is_volunteer` - Active volunteer
- `is_feeder` - Feeds community cats
- `is_trapper` - Traps cats
- `safety_concern` - Staff safety concern ⚠️
- `communication_preference` - phone/text/email
- `responsiveness` - How responsive to contact
- `provides_barn_homes` - Accepts cats for barn placement

**Cat Attributes (7):**
- `is_feral` - Not socialized
- `is_friendly` - People-friendly
- `has_disease` - FeLV/FIV positive ⚠️
- `disease_type` - felv/fiv/both
- `special_needs` - Medical needs
- `estimated_age` - kitten/young/adult/senior
- `temperament` - friendly/shy/feral/aggressive

**Request Attributes (7):**
- `has_kittens` - Kittens involved
- `has_pregnant` - Pregnant cat involved
- `is_emergency` - Emergency situation ⚠️
- `caller_relationship` - owner/feeder/neighbor
- `urgency_level` - critical/high/medium/low
- `has_hostile_environment` - Safety concern ⚠️
- `involves_hoarding` - Hoarding situation

### Data Sources for Extraction

| Source | Tables | Est. Records |
|--------|--------|--------------|
| Clinic Notes | `sot_appointments` | ~50,000 |
| Request Notes | `sot_requests` | ~15,000 |
| Google Maps | `google_map_entries` | ~5,600 |
| Web Intake | `web_intake_submissions` | ~3,000 |
| Site Observations | `site_observations` | ~2,000 |

### Query Examples for Tippy

```sql
-- Which places have kitten history?
SELECT * FROM trapper.v_place_attributes
WHERE has_kitten_history = true;

-- Show disease-risk locations
SELECT * FROM trapper.v_place_attributes
WHERE has_disease_history = true;

-- Find safety concern clients
SELECT * FROM trapper.v_person_attributes
WHERE safety_concern = true;

-- Emergency requests with kittens
SELECT * FROM trapper.v_request_attributes
WHERE is_emergency = true AND has_kittens = true;

-- Extraction coverage by attribute
SELECT * FROM trapper.v_attribute_coverage;
```

### Confidence Levels

| Level | Range | Meaning |
|-------|-------|---------|
| High | ≥ 0.8 | Explicitly stated in text |
| Medium | 0.5-0.79 | Strongly implied |
| Low | < 0.5 | Weak signal |

### Superseding Logic

When new extractions are run:
- Higher confidence values replace lower ones
- Equal confidence creates new version
- Old values are marked `superseded_at` (audit trail preserved)
- Manual entries (confidence 1.0) are never auto-replaced

### Extraction Scripts

```bash
# Seed from Google Maps (no AI cost)
node scripts/jobs/seed_attributes_from_google_maps.mjs

# Extract from clinic notes (priority attributes first)
node scripts/jobs/extract_clinic_attributes.mjs --priority-only --limit 100

# Extract from request notes
node scripts/jobs/extract_request_attributes.mjs --limit 100
```

### Cost Estimates

| Source | Records | Est. Cost |
|--------|---------|-----------|
| Google Maps seed | ~5,600 | $0 (no AI) |
| Clinic notes | ~50,000 | ~$25 |
| Request notes | ~15,000 | ~$7.50 |
| Web intake | ~3,000 | ~$1.50 |
| **Total one-time** | **~75,000** | **~$34** |

Ongoing: ~$0.50-1/month for new records.

---

## Tippy Feedback Ledger

Running log of staff feedback on Tippy responses, used to identify gaps and improve.

### 2026-01-29: "What is the situation at 816 Santa Barbara Dr in Santa Rosa"

**Staff:** Pip (staff_id: a51bf233)
**Feedback ID:** 21572cb3
**Feedback Type:** incorrect_status
**What happened:** Tippy couldn't pull data for the address. Staff feedback: "didn't pull data"
**Actual data available:**
- 1 completed request (requester: Cathy Gonzalez)
- 10+ cats linked via clinic appointments
- Active colony with AI-extracted attributes (colony_size 5-7, disease history, feeder present)
- colony_site context assigned
**Root cause:** Tippy view catalog may be missing address-lookup views or the query failed to match the address format.
**Action needed:** Verify Tippy can query `v_place_complete_profile` or `v_place_operational_state` by formatted_address. Check if address matching uses ILIKE or exact match.

---

### 2026-01-20: "How many staff do we have?"

**Staff:** (staff_id from feedback)
**Feedback ID:** 88216de3
**Feedback Type:** incorrect (correction provided)
**What happened:** Tippy confused staff with trappers. Staff correction: "Staff aren't trappers. The only one that blurs that line is Crystal Furtado."
**Root cause:** Tippy doesn't distinguish FFSC staff from trappers. The `person_roles` table has role types (coordinator, head_trapper, ffsc_trapper, community_trapper) but no explicit "staff" role.
**Action needed:** Add guidance to Tippy's system prompt or view catalog explaining:
- Staff = FFSC employees (coordinators, admins)
- Trappers = volunteers/community members who trap
- Crystal Furtado is both staff and active trapper (exception)
- Query staff via `person_roles WHERE role_type IN ('coordinator', 'head_trapper')` not all trappers

---

## Development Session Log (continued)

### Session: 2026-01-28/29 - AI Extraction Engine & Classification Bridge

**Context:** Connecting the AI extraction pipeline end-to-end: triggers → queue → extraction → classification.

**Key Discoveries:**
1. Extraction scripts were operating independently from the database extraction_queue — queue items piled up unprocessed
2. extract_request_attributes.mjs was using `entity_attributes` (only records WITH extractions) instead of `extraction_status` for skip tracking, causing re-processing
3. 1,081 places had AI-extracted colony attributes but no classification context assigned
4. `data_engine_score_candidates()` was missing `score_breakdown` and `rules_applied` columns
5. Trigger functions could insert NULL entity_id into extraction_queue when cat_id/place_id was NULL

**Changes Made:**
- MIG_758: AI Extraction Engine (triggers, rules, queue, status tracking)
- MIG_759: Fixed score_breakdown column and NUMERIC casting in data_engine_score_candidates
- Fixed all 3 extraction scripts to mark queue items completed
- Fixed extract_request_attributes.mjs to use extraction_status instead of entity_attributes
- Created process_extraction_queue.mjs (unified queue processor)
- Created classify_place_from_extractions() bridge function
- Backfilled 1,342 colony_site contexts from existing AI extractions
- Fixed trigger null guards (cat_id IS NOT NULL, place_id IS NOT NULL)

**Staff Impact:**
- New/updated records automatically queued for AI extraction via triggers
- Extracted attributes now automatically drive place classification (colony_site context)
- Sync errors resolved (null entity_id, missing score_breakdown, NUMERIC type mismatch)

---

### Session: 2026-01-30 - Structural Guardrails (INV-10, Pipeline Docs)

**Context:** Review of multiple sessions' changes revealed three structural gaps: INV-10 centralized linking functions were documented in North Star but never built, pipeline backfill process was undocumented, and duplicate migration numbers existed.

**Key Discoveries:**
1. 5+ different code paths INSERT directly into `cat_place_relationships` and `person_cat_relationships` with inconsistent source attribution and zero evidence validation
2. A manual SQL fix had linked the wrong person's cats to the wrong place — the system accepted it silently (no semantic validation)
3. MIG_790 and MIG_791 each had duplicate numbers from separate sessions
4. MIG_795 (pipeline fix) had a dead Step 4 that would fail on fresh run (wrong return type)

**Changes Made:**
- MIG_797: Created `link_cat_to_place()` and `link_person_to_cat()` centralized functions with merged-entity validation, evidence_type enforcement, confidence upgrading, and audit logging
- Migrated 3 SQL callers: `link_cats_to_places()`, `link_appointment_cats_to_places()`, `link_appointment_to_person_cat()`
- Updated ownership transfer API (`entities/[type]/[id]/edit`) to use `link_person_to_cat()`
- Renamed duplicate migrations: MIG_791→MIG_795 (pipeline fix), MIG_790→MIG_796 (tippy signals)
- Fixed dead Step 4 in MIG_795 (deferred to Step 7)
- Added Pipeline Operations section to CLAUDE.md with backfill documentation
- Updated North Star: INV-10 marked as IMPLEMENTED, Known Debt updated

**Staff Impact:**
- Relationship tables now reject invalid links (merged entities, missing evidence)
- Staff can follow documented backfill process when pipeline stalls
- Pipeline fix (MIG_795) is operational — re-upload owner_info to backfill Jan 19-30 gap

### Session: 2026-01-30 - Place Deduplication Audit & Data Quality Review

**Context:** Staff reported seeing duplicate place cards on person profiles (same address listed twice with slight formatting differences). Full database audit revealed systemic place deduplication failure.

**Key Discoveries:**
1. **3,317 duplicate place pairs** exist — same physical location stored as separate `places` records due to formatting differences in `formatted_address`
2. **4,019 distinct places** are involved (roughly 36% of all non-merged places)
3. **Root cause**: `normalize_address()` function only handles 6 street suffix abbreviations and basic whitespace. It misses: ", USA" suffix (415 pairs), trailing whitespace before commas (156 pairs), and 2,829 structural format differences between Google geocoder, Airtable, and ClinicHQ output
4. **398 people** linked to definite duplicate places — shows as two identical-looking place cards in Connections tab
5. **704 cats** linked to duplicate places — inflates place-level cat counts and fragments colony data
6. **9,584 relationships** need relinking from duplicate to canonical places
7. MIG_793 (`v_orphan_places`) and MIG_794 (`relink_person_primary_address`) were written in prior sessions but never applied to the database

**Three Duplication Patterns:**
- ", USA" suffix: Google adds it, other sources don't (`"123 Main St, Santa Rosa, CA 95401"` vs `"...95401, USA"`)
- Trailing whitespace: `"200 Cranbrook Way , Santa Rosa"` vs `"200 Cranbrook Way, Santa Rosa"`
- Case/punctuation: `"75 Hillview Dr."` vs `"75 Hillview Dr"`, `"1523 RAEGAN WAY"` vs `"1523 Raegan Way"`

**Remediation COMPLETED (2026-01-30):**
- DH_E005: Applied MIG_793 (`v_orphan_places`) + MIG_794 (`relink_person_primary_address`). 0 orphan places found.
- DH_E001: MIG_799 hardened `normalize_address()` with 11 new normalizations (USA suffix, em-dash placeholders, periods, comma-before-zip, apartment spelling, 7 street suffixes, 8 directionals). All 11,191 active places re-normalized.
- DH_E002+E003: MIG_800 merged **188 exact duplicate pairs** across 3 passes. Created `merge_place_into()` function for atomic merges with full FK relinking. `extract_house_number()` + `address_safe_to_merge()` guard functions prevent false positive merges.
- DH_E004: **~307 fuzzy pairs remain** for admin review — inverted addresses, missing commas, unit variants. Planned for admin UI.

**Results:**
- 11,191 active places (down from 11,379)
- 4,635 total merged places (up from 4,447)
- 0 exact normalized duplicates
- 0 uppercase in normalized addresses
- House number guard verified against known false positives (6000 vs 6030 Blank Rd correctly rejected)

**Staff Impact:**
- Most duplicate place cards on person profiles are now RESOLVED — the 188 merged pairs covered the most visible cases
- If staff still sees two place cards for similar addresses, ~307 known fuzzy pairs exist that need manual review via admin UI (coming soon)
- Place-level cat counts should now be more accurate as fragmented records have been consolidated
- Colony estimates on places may improve as data is no longer split across duplicates
- New places created going forward will not create duplicates for the same patterns (normalize_address prevents it)

---

### Session: 2026-01-30 - Unified PlaceResolver System

**Context:** Following the place deduplication audit, a deeper analysis revealed that 7+ frontend forms handled place/address input with inconsistent capabilities. The public intake form only searched Google and never checked Atlas, creating new duplicate places every time an address was submitted that already existed. The backend was already unified through `find_or_create_place_deduped()`, but the frontend was entirely fragmented.

**Key Discoveries:**
1. **AddressAutocomplete** (Google-only) was the root cause of continued duplicate place creation from intake forms
2. `requests/new` had the best pattern (600+ lines of inline dual Atlas+Google search with duplicate detection) but it was completely non-reusable
3. All other forms (intake, admin intake, queue, people profiles, handoff modal, colony management) only had Google search — no Atlas lookup, no duplicate detection

**Changes Made:**
- Created `usePlaceResolver` hook (~290 lines) — extracts reusable search + resolve logic
- Created `PlaceResolver` component (~430 lines) — unified address input with Atlas search, Google search, duplicate detection, place kind selection, unit creation, describe location
- Migrated 9 forms to PlaceResolver:
  - `people/[id]` — person address changes
  - `admin/intake/call` — staff phone intake
  - `intake/queue/new` — staff request creation from queue
  - `intake` — public intake form (both cat address and requester address)
  - `places/new` — simplified from 416 → 155 lines
  - `requests/new` — biggest cleanup, removed ~400 lines of inline code
  - `HandoffRequestModal` — request handoff
  - `intake/queue` — intake queue address editing
  - `admin/colonies/[id]` — colony place addition
- `AddressAutocomplete` retained only for `places/[id]` address correction flow (fundamentally different use case)

**Staff Impact:**
- **All address input forms now search Atlas first** — if an address already exists, staff will see it and can select it directly instead of accidentally creating a duplicate
- **Duplicate detection on all forms** — selecting a Google address that already exists shows a modal with options to use existing or add unit
- **Unit/apartment support everywhere** — all forms can now create units at existing addresses
- **No workflow changes** — forms look and behave the same, just with more capabilities
- Public intake submissions will no longer create duplicate places for known addresses

*Last updated: 2026-01-30 (after PlaceResolver system)*

### Session: 2026-01-30 - Person Deduplication Audit System

**Context:** The task ledger reported ~14,536 exact-name duplicate people in `sot_people`. The existing dedup system only catches duplicates during new record ingestion (via `find_or_create_person()` and the Data Engine). It had never proactively scanned the full person table. Many duplicates were created before the Data Engine was operational.

**Key Discoveries:**
1. **Existing infrastructure was solid but unused at scale** — `merge_people()` (MIG_260), `merge_email_duplicates()` / `merge_phone_duplicates()` (MIG_575) existed but had never been run against the full dataset
2. **Multiple detection signals needed layering** — email match alone misses phone-only duplicates; phone match alone can't distinguish household members from duplicates; name match alone has high false positive rate
3. **Five confidence tiers emerged** from analysis:
   - Tier 1: Same email (highest confidence, safe to auto-merge)
   - Tier 2: Same phone + similar name (safe to auto-merge)
   - Tier 3: Same phone + different name (likely household — needs review)
   - Tier 4: Identical name + shared place (moderate confidence)
   - Tier 5: Identical name only (lowest confidence)

**Changes Made:**
- MIG_801: Created `v_person_dedup_candidates` (5-tier comprehensive duplicate detection), `v_person_dedup_summary` (dashboard counts), `person_safe_to_merge()` (safety guard function), supporting indexes
- MIG_802: Safe batch auto-merges for tiers 1-2, queues tiers 3-5 into `potential_person_duplicates` for staff review
- `/admin/person-dedup` page: New admin UI with tier filter tabs, side-by-side comparison cards, batch actions (merge all, keep separate all, dismiss all), pagination
- `/api/admin/person-dedup` endpoint: GET (paginated candidates with stats) + POST (single or batch resolve)

**Staff Impact:**
- **New admin page at `/admin/person-dedup`** for reviewing duplicate candidates by confidence tier
- Tier 1-2 pairs are auto-merged by MIG_802 — staff only sees remaining ambiguous cases
- Each candidate card shows both people side-by-side with identifier counts, place counts, cat counts, request counts, and shared place count
- Staff can merge, keep separate, or skip individual pairs or batch-select multiple
- Merged records retain all relationships — nothing is lost, the duplicate just gets absorbed into the canonical record
- The existing `/admin/duplicates` page continues to handle ingestion-time flags independently

*Last updated: 2026-01-30 (after person dedup audit system)*

### Session: 2026-01-30 - Place Deduplication Audit System

**Context:** With person dedup handled, the task ledger flagged DH_E004 (place dedup) as the next priority. Atlas has ~11K active places with geocoded locations. Many were created from different sources (Airtable, web intake, ClinicHQ) for the same physical address, leading to duplicate place records with split data.

**Key Discoveries:**
1. **View-based approach too slow** — An initial attempt using `CREATE VIEW` with PostGIS `ST_DWithin` cross-joins timed out on 11K+ places. Switched to materialized table approach with on-demand refresh function.
2. **Three confidence tiers emerged** from geographic + address analysis:
   - Tier 1: Within 30m + address similarity >= 0.6 (753 pairs — almost certainly same place)
   - Tier 2: Within 30m + low address similarity (691 pairs — same spot, different text, possibly unit vs parent)
   - Tier 3: 30-100m + address similarity >= 0.7 (2,409 pairs — possible mis-geocode)
3. **3,853 total place duplicate candidates** detected across all tiers.
4. **Safety guards needed** — FFSC facilities, parent-child relationships, and already-merged places must be blocked from merge.

**Changes Made:**
- MIG_803: Created `place_dedup_candidates` table, `refresh_place_dedup_candidates()` function, `place_safe_to_merge()` safety guard, PostGIS + trigram indexes
- `/admin/place-dedup` page: Admin UI with tier filter tabs, side-by-side place comparison (address, name, kind, request/cat/child unit counts), distance + similarity indicators, batch actions
- `/api/admin/place-dedup` endpoint: GET (paginated candidates from table) + POST (merge via `merge_place_into()`, keep_separate, dismiss)

**Staff Impact:**
- **New admin page at `/admin/place-dedup`** for reviewing place duplicate candidates by confidence tier
- Each card shows both places side-by-side with address, display name, place kind, distance apart, address similarity percentage, request count, cat count, and child unit count
- Staff can merge, keep separate, or skip individual pairs or batch-select multiple
- Merging uses `merge_place_into()` which atomically relinks all 23+ FK references
- `place_safe_to_merge()` blocks merges of FFSC facilities, parent-child pairs, and already-merged places
- Run `SELECT * FROM trapper.refresh_place_dedup_candidates();` to re-scan after significant data changes

### Session: 2026-01-31 - Map Improvements (MAP_002-007)

**Context:** Staff reported confusion about map pin colors, cluster contamination from single disease pins, system account names appearing on map popups, and search bar blocking the navigation marker.

**Key Discoveries:**
- **Root cause of Sandra Nicander pollution:** `process_clinichq_owner_info()` (MIG_574) resolved person identity via email/phone, then unconditionally created `person_place_relationships` with `role='resident'` for anyone on a ClinicHQ appointment. When FFSC staff were listed as contacts on appointments for colony cats, they got linked to every address they handled — hundreds of spurious "resident" links polluting map popups and search results.
- `v_map_atlas_pins` people subquery also had no filtering for `is_system_account` or organization names
- The `active` pin_style covered both places with verified cats AND places with only requests/intakes, making them visually indistinguishable
- Cluster `iconCreateFunction` used `markers.some()`, causing a single disease pin to turn an entire cluster of 50+ pins orange
- `organization_place_mappings.org_display_name` existed but wasn't used in the map view

**Changes Made:**
- MIG_806: Filtered `is_system_account` and `is_organization_name()` from people subquery, added org display name fallback via `organization_place_mappings`
- MIG_807: Split `active` pin_style into `active` (verified cats, green with count badge) and `active_requests` (requests/intakes only, teal with clipboard icon)
- MIG_808: **Root-cause fix** — 5 steps:
  1. Created `should_link_person_to_place(person_id)` reusable guard function (blocks system accounts, org names, FFSC emails, coordinator/head_trapper roles; auto-flags newly-discovered system accounts)
  2. Patched `process_clinichq_owner_info()` to call guard before creating place links (appointment linking preserved — we still track who handled the cat)
  3. Flagged all `@forgottenfelines` email people and org-name people as `is_system_account = TRUE`
  4. Cleaned ALL existing spurious place links for system accounts (not just >5)
  5. Cleaned clinichq-sourced links for active coordinator/head_trapper staff
- Cluster threshold: majority-wins (>50% = colored, minority = blue cluster + count badge)
- Nearby people: navigated-location popup now shows people from nearby pins within ~200m
- Street View fullscreen + mini map with nearby colored dots
- Search bar minimizes to pill during Street View, nav marker z-index raised

**Staff Impact:**
- 605 Rohnert Park Expressway now shows "Food Maxx RP" instead of "Sandra Nicander"
- Sandra Nicander and other FFSC staff are no longer linked as "residents" of client addresses — the root cause in the ingestion pipeline is fixed, so future ClinicHQ imports won't recreate the problem
- The `should_link_person_to_place()` guard function is reusable and can be added to other ingestion paths
- Map pins are now distinguishable: green = verified cats, teal = requests only
- Collapsible legend at bottom-left explains all pin types
- Clusters no longer turn orange from a single disease pin — blue clusters show small orange badge with count
- Searching an address shows nearby people in the popup
- Street View has fullscreen mode with mini map showing surrounding pins
- Search bar no longer blocks the blue navigated-location marker

*Last updated: 2026-01-31 (after MAP_002-007 map improvements)*

### Session: 2026-01-31 - VolunteerHub API Integration (VOL_001)

**Context:** Staff needed volunteer data pulled from VolunteerHub API instead of manual XLSX exports. Trapper/volunteer management was split between Airtable and VolunteerHub with no reconciliation. System accounts (staff) were appearing at client addresses on the map.

**North Star Alignment:**
- **L1 (RAW):** Raw VH API payloads staged in `staged_records` via `stage_volunteerhub_raw()`
- **L2 (IDENTITY):** Identity resolution via `match_volunteerhub_volunteer()` → `find_or_create_person()` (INV-3, INV-5)
- **L3 (ENRICHMENT):** Phone/place enrichment via `enrich_from_volunteerhub()`
- **L4 (CLASSIFICATION):** VH group memberships → `person_roles` via `process_volunteerhub_group_roles()` (INV-2: preserves manual head_trapper/coordinator designations)
- **L5 (SOT):** `person_roles`, `person_place_relationships` via centralized functions (INV-10)
- **L6 (WORKFLOWS):** Cron endpoint for automated sync, health endpoint for monitoring
- **L7 (BEACON):** Map displays role badges in popups, volunteer star overlay on pins
- **INV-1:** Temporal membership tracking (left_at instead of deletion)
- **INV-4:** All records carry `source_system='volunteerhub'` (approved in North Star INV-4)
- **INV-8:** MIG_811 view filters `merged_into_person_id IS NULL`

**Key Design Decisions:**
- Atlas (via VH) becomes source of truth for volunteer/trapper management; Airtable is reference only
- Only 2 source-derived trapper types: `ffsc_trapper` (VH "Approved Trappers"), `community_trapper` (Airtable/JotForm)
- `head_trapper`/`coordinator` are Atlas-only manual designations (Crystal is the only head_trapper)
- Staff shown on map only at VH-sourced addresses (real home), not client addresses (MIG_808 guard + MIG_811 filter)

**Changes Made:**
- MIG_809: `volunteerhub_user_groups`, `volunteerhub_group_memberships` (temporal), 17 new columns on `volunteerhub_volunteers`, `sync_volunteer_group_memberships()`, `v_volunteer_roster`
- MIG_810: `process_volunteerhub_group_roles()`, `cross_reference_vh_trappers_with_airtable()`
- MIG_811: Revised `v_map_atlas_pins` — people as `{name, roles[], is_staff}` JSONB objects, system accounts at VH addresses only
- `scripts/ingest/volunteerhub_api_sync.mjs`: Full API sync (52 fields, FormAnswer decoding, incremental)
- `VolunteerBadge` component, `/api/people/[id]/roles` endpoint, person profile volunteer section
- Cron (`/api/cron/volunteerhub-sync`), health (`/api/health/volunteerhub`)

**Staff Impact:**
- Volunteers visible on map with role badges (Staff, Trapper, Foster, Caretaker, Volunteer)
- Purple star badge on pins where staff/volunteers live
- Person profiles show full volunteer info: groups, hours, skills, availability, notes
- Automated sync every 6 hours — no more manual XLSX exports
- Group join/leave history tracked for volunteer lifecycle management

### Session: 2026-01-31 — VolunteerHub Sync Execution + Robustness Fixes

**Context:** First full VH API sync run. Multiple bugs discovered and fixed during execution. User requested infrastructure for future recurring syncs and handling of VH volunteers with no contact info.

**Key Discoveries:**
- `match_volunteerhub_volunteer()` used wrong column name (`role_type` instead of `role`) — never ran successfully before
- `person_roles` CHECK constraint was missing `caretaker` role (needed for VH "Approved Colony Caretakers" group)
- `enrich_from_volunteerhub()` had mismatched payload keys (single vs double space around hyphens in VH field names like "Name - FirstName" vs "Name -  FirstName")
- `entity_edits` table had CHECK constraints that didn't include `volunteerhub_sync` as edit_source or `link`/`unlink` as edit_type
- `internal_account_types` had a "POTL" contains pattern that false-positived on the surname "Spotleson" (real volunteer Oceana Spotleson)
- 9 VH volunteers have NO email or phone — data engine correctly rejects them (no identifiers), but these are real people who signed up on VolunteerHub
- `sot_people.data_source` is an enum, not text — required explicit cast

**Bugs Fixed (MIG_812 + MIG_813):**
1. `match_volunteerhub_volunteer()`: `role_type` → `role` column
2. `person_roles` CHECK: added `caretaker`
3. `enrich_from_volunteerhub()`: COALESCE for both key spacings, added `is_processed = FALSE` filter, `ended_at` → `valid_to`
4. `entity_edits` edit_source CHECK: added `volunteerhub_sync`
5. `sync_volunteer_group_memberships()`: edit_type `update` → `link`/`unlink`
6. `internal_account_types`: POTL pattern `contains` → `starts_with`
7. `volunteerhub_volunteers.email`: dropped NOT NULL
8. `create_skeleton_person()`: added `::trapper.data_source` cast

**New Infrastructure (MIG_813):**
- `trusted_person_sources` table: registry of sources allowed to create skeleton people (VH + ShelterLuv = yes, ClinicHQ = no)
- `create_skeleton_person()`: creates `sot_people` with `data_quality = 'skeleton'`, `is_canonical = false` from trusted sources
- Enhanced `match_volunteerhub_volunteer()`: 5 strategies (email → phone → data_engine → staff_name → skeleton)
- `enrich_skeleton_people()`: periodic function that merges skeletons INTO existing people when contact info arrives, or promotes them to normal quality
- Integrated into sync script as Step 5 (runs every sync)

**Sync Results:**
- 1346 VH volunteers, 1346 matched to sot_people (100%)
- 47 user groups, 1876 active memberships
- 537 roles: 1299 volunteer, 95 foster, 23 ffsc_trapper, 15 caretaker, 13 staff
- 837 new sot_people from VH, 782 places created
- 9 skeleton people (name only, awaiting enrichment)

**Staff Impact:**
- VH data now fully integrated. Every sync automatically: upserts volunteers, tracks group joins/leaves, assigns roles, creates/enriches places, handles skeleton people.
- If a skeleton person (no email) later updates their VH profile with email, the next sync automatically merges them into existing records or promotes them to full quality.
- Staff name matching ensures VH records for known staff (e.g., Jennifer Cochran) auto-link to existing staff accounts even without email in VH.

---

### Session: 2026-01-31 - Disease Tracking System (DIS_001) & Data Audit

**Context:** Built per-disease tracking at place level (MIG_814). During activation, discovered the compute function wasn't matching any data — fixed mapping and matching logic. Then audited Google Maps entries for disease mentions to assess data completeness.

**Key Discoveries:**

**Bug in MIG_814 compute function (fixed):**
- `test_type_disease_mapping` patterns didn't match actual data format. FeLV/FIV combo tests store result_detail as `"Negative/Positive"` (FeLV result/FIV result), not `"FIV+"` or `"FeLV+"`
- LIKE (case-sensitive) didn't match `"Positive"` against pattern `"positive"` — needed ILIKE
- `WHERE ctr.result = 'positive'` excluded ALL FIV+ combo tests because the result enum was `'negative'` (since FeLV was negative in the combo)
- After fix: 87 disease statuses computed (was 0 before)

**Disease data reality (from `cat_test_results`):**

| Disease | Active Places | Historical Places | Positive Cats |
|---------|--------------|------------------|---------------|
| FIV | 69 | 4 | 93 |
| Ringworm | 0 | 14 (decayed, 12-month window) | 21 |
| FeLV | 0 | 0 | 0 |
| Heartworm | 0 | 0 | 0 |
| Panleukopenia | 0 | 0 | 0 |

**Google Maps disease gap (qualitative data not in clinic tests):**
- **78 Google Maps entries** mention disease at linked places
- **44 FeLV+ mentions** across 44 places — ZERO FeLV positives in clinic test data
- **19 FIV+ mentions** across 19 places — only 2 already tracked from clinic tests
- **15 ringworm mentions** across 15 places — only 1 already tracked from clinic tests
- **9 of these places have clinic test data** — ALL test results are negative (the disease events described in Google Maps are from different cats or different time periods)
- **~66 places have no clinic test data at all** — the disease mentions are purely from historical staff notes (some dating to 2012)

**Why the gap exists:**
Google Maps KMZ notes are the predecessor's 20+ years of informal case notes. They describe events like "FeLV positive cat euthanized" or "ringworm colony" — but these cats were often euthanized before structured testing was implemented, or the positive results were recorded informally and never entered the clinic's structured test system. The structured `cat_test_results` table only covers cats tested at the FFSC clinic from ~2021 onward.

**What Tippy should know:**
> "Disease tracking now combines three data sources: structured clinic test results, AI extraction from medical notes, and AI extraction from Google Maps historical notes. 168 disease flags exist across 161 unique places. 69 places have confirmed active FIV from clinic tests. FeLV data comes exclusively from Google Maps historical notes — there are zero FeLV positives in structured clinic test data (see DIS_003 below for why)."

**Staff Impact:**
- Map now shows disease badges on 69 FIV-active pins (was showing 0)
- Ringworm places exist but are all historical (last positive: Oct 2024, 12-month decay)
- FeLV data backfilled from Google Maps (29 historical, 6 suspected, 3 from medical notes)
- Staff can manually override disease status at `/admin/disease-types` if they know of current cases not in the data

### Session: 2026-01-31 - Google Maps Disease Extraction (DIS_002)

**Context:** Following DIS_001 audit that found ~66 places with disease mentions in Google Maps but zero structured data, built and ran an AI extraction pipeline to parse disease polarity from historical notes.

**Key Discoveries:**
1. **Polarity detection is critical** — majority of disease keyword matches are NEGATIVE results ("FeLV neg", "SNAP negative"). Only ~18% of entries contain actual positives.
2. **Initial parser bug:** Greedy regex `/\[[\s\S]*\]/` captured trailing text when Sonnet appended explanations after the JSON array. Bracket-counting parser fixed this (0 parse errors vs 10 previously).
3. **Duplicate entries across runs:** Same Google Maps entry can match multiple disease keywords (e.g., "FeLV neg, FIV pos" → 2 extractions). `extraction_status` table prevents re-processing.
4. **CLI parsing:** `--limit 400` (space-separated) doesn't work; must use `--limit=400` (equals sign).

**Changes Made:**
- `scripts/jobs/extract_google_map_disease.mjs`: New extraction script
  - Uses Sonnet for ALL entries (polarity accuracy critical)
  - Custom prompt emphasizing negative vs positive indicators
  - Bracket-counting JSON parser (replaces greedy regex)
  - Calls `process_disease_extraction_for_place()` for each positive
  - CLI: `--dry-run`, `--limit=N`
- `sql/schema/sot/MIG_818__tiered_pin_system.sql`: Contains `process_disease_extraction_for_place()` function

**Extraction Results (3 runs, ~400 entries):**

| Run | Entries | Positives | Parse Errors | Cost |
|-----|---------|-----------|--------------|------|
| Dry run | 200 | 36 | 3 | $0.89 |
| Live run 1 | 200 | 36 | 0 | $0.90 |
| Live run 2 (rerun after fix) | 200 | 8 | 0 | $0.56 |
| Live run 3 | 199 | 32 | 0 | $0.79 |

**Disease flags from Google Maps (63 total):**

| Disease | Suspected | Historical | Total |
|---------|-----------|------------|-------|
| FeLV | 6 | 29 | 35 |
| FIV | 2 | 4 | 6 |
| Ringworm | 1 | 17 | 18 |
| Panleukopenia | 0 | 3 | 3 |
| Heartworm | 0 | 1 | 1 |

**What Tippy should know:**
> "Google Maps disease extraction has been completed. 63 disease flags were extracted from historical notes using AI. Most FeLV data in the system comes from these historical notes — the predecessor documented FeLV colonies extensively. Status is auto-determined: entries with dates beyond the decay window (36 months for FeLV, 24 for FIV, 12 for ringworm) are marked 'historical'; recent ones are 'suspected'. Staff can upgrade or clear any flag at `/admin/disease-types`."

**Staff Impact:**
- 63 new disease flags from Google Maps backfill
- FeLV now visible on map for first time (35 places, mostly historical)
- 4 remaining Google Maps entries were false-positive keyword matches (harmless, marked as processed)

---

### 2026-01-31: FIV Combo Test Parsing Bug & Medical Notes Extraction (DIS_003)

**Problem:** Two issues discovered during disease data audit:
1. **Combo test parsing bug (MIG_164):** The FeLV/FIV SNAP combo test stores results as `"Negative/Positive"` (FeLV result/FIV result). The original CASE statement checked `ILIKE '%negative%'` BEFORE `ILIKE '%positive%'`, so `"Negative/Positive"` (meaning FeLV neg, FIV pos) matched the negative branch first. **286 FIV-positive cats were classified as negative.**
2. **Zero FeLV in structured data:** Investigation confirmed this is genuine — zero `"Positive/Negative"` or `"Positive/Positive"` combo test results exist in raw staged data. All FeLV positives in the system are from Google Maps historical notes or medical notes.

**Investigation:**
- `cat_test_results` table had 1,735 FeLV/FIV combo test results, ALL marked `result = 'negative'`
- `result_detail` breakdown: 1,449 `"Negative/Negative"` + 286 `"Negative/Positive"`
- The 286 `"Negative/Positive"` entries are FIV-positive cats wrongly classified as negative
- Raw `staged_records` payload confirmed: zero `"Positive/Negative"` or `"Positive/Positive"` entries exist
- Medical notes (2 appointments) mention FeLV explicitly; 55 appointments mention FIV

**Solution:**
1. **Fixed 286 combo test records:** `UPDATE cat_test_results SET result = 'positive' WHERE result_detail = 'Negative/Positive'`
2. **Fixed MIG_164 parsing order:** Swapped CASE to check `ILIKE '%positive%'` FIRST
3. **Extracted disease from medical notes:** AI parsed 57 appointments mentioning FeLV/FIV → 3 FeLV places + 15 FIV places flagged (via `process_disease_extraction_for_place()` with `evidence_source = 'computed'`)

**Result:**
- 286 FIV-positive cats now correctly classified
- 18 new disease flags from medical notes (3 FeLV + 15 FIV)
- Total disease flags in system: **168 across 161 unique places**

**Current disease status (all sources combined):**

| Disease | Confirmed Active | Suspected | Historical | Total |
|---------|-----------------|-----------|------------|-------|
| FIV | 69 (test_result) | 17 (computed + google_maps) | 8 | 94 |
| FeLV | 0 | 9 (computed + google_maps) | 29 | 38 |
| Ringworm | 0 | 1 | 31 | 32 |
| Panleukopenia | 0 | 0 | 3 | 3 |
| Heartworm | 0 | 0 | 1 | 1 |
| **Total** | **69** | **27** | **72** | **168** |

**Three evidence sources feed disease data:**

| Source | Description | Count |
|--------|-------------|-------|
| `test_result` | Structured FeLV/FIV combo tests from ClinicHQ | 87 |
| `google_maps` | AI extraction from historical notes (DIS_002) | 63 |
| `computed` | AI extraction from medical appointment notes | 18 |

**What Tippy should know:**
> "FIV data is the most reliable — 69 confirmed-active places from structured clinic combo tests. FeLV has zero positives in structured tests (genuinely none in the raw data), so all FeLV flags come from historical Google Maps notes or medical note mentions. If staff asks 'why no FeLV?', the answer is: the FeLV/FIV SNAP combo test at FFSC has never returned a FeLV-positive result in the structured data. FeLV-positive cats documented in Google Maps were likely tested elsewhere or euthanized before FFSC's current testing system."

**Staff Impact:**
- 286 cats that were FIV-positive but mislabeled as negative are now corrected
- Disease flags now come from 3 complementary sources covering both structured and unstructured data
- Future ClinicHQ imports will correctly parse combo test polarity (positive checked before negative)

---

## Ingestion Pipeline: Auto-Triggers & Data Freshness

Understanding how data flows through Atlas and what triggers automatically vs manually is important for explaining why data may appear stale or incomplete.

### Automatic Triggers (no manual intervention needed)

| Trigger | What It Does | Frequency |
|---------|-------------|-----------|
| `/api/cron/ingest-process` | Runs `process_next_job()` for queued processing jobs | Every 10 min (cron) |
| `/api/cron/entity-linking` | Runs `run_all_entity_linking()` (cat→place, appointment→trapper) | Every 30 min (cron) |
| `/api/cron/geocode-pending` | Geocodes new places via Google Places API | Every 30 min (cron) |
| `/api/cron/beacon-enrich` | Colony estimate refresh, extraction queue, data staleness | Daily 10 AM PT |
| `/api/cron/volunteerhub-sync` | Full VH API sync (volunteers, groups, memberships, roles) | Every 6 hours |
| `trg_queue_appointment_extraction` | Queues new appointments for AI attribute extraction | On INSERT to `sot_appointments` |
| `trg_queue_intake_extraction` | Queues new intake submissions for extraction | On INSERT to `web_intake_submissions` |
| `trg_queue_request_extraction` | Queues new requests for extraction | On INSERT to `sot_requests` |
| `trg_site_obs_colony_estimate` | Creates colony estimate from site observations | On INSERT to `site_observations` |

### Semi-Automatic (triggered by staff action)

| Action | What Triggers | What Happens |
|--------|--------------|--------------|
| ClinicHQ CSV upload | File upload via `/api/ingest/clinichq` | Stages records → queues processing jobs |
| Owner info upload | File upload via `/api/ingest/clinichq` | Queues `owner_info` processing → identity resolution |
| Airtable sync | Manual or cron `/api/cron/airtable-sync` | Stages records → processes requests/people |
| Web intake submission | Public form submission | Creates request → triggers extraction queue |

### Manual Only (requires explicit script run)

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `extract_clinic_attributes.mjs` | AI extracts structured attributes from appointment notes | After significant new appointment data |
| `extract_request_attributes.mjs` | AI extracts attributes from request notes | After Airtable sync with new requests |
| `extract_google_map_disease.mjs` | AI extracts disease polarity from Google Maps notes | One-time backfill (completed) |
| `process_extraction_queue.mjs` | Unified queue processor for all extraction types | When extraction_queue has pending items |

### Known Gap: `needs_reextraction` Not Auto-Triggered

The `extraction_status` table has a `needs_reextraction` column, but it is **never automatically set to true** when source data changes. This means:
- If an appointment note is updated in ClinicHQ and re-uploaded, the old extraction is kept
- If a request note is edited in Atlas, the old attributes are not re-extracted

**Current workaround:** Delete the extraction_status row for the source record and re-run the extraction script. This is a known technical debt item.

### Map Data Freshness

`v_map_atlas_pins` is a **VIEW** (not materialized) — it reflects current database state on every query. No refresh needed. Changes to:
- Person roles → immediately reflected in pin popups
- Disease status → immediately reflected in pin badges
- Place contexts → immediately reflected in pin style
- Request status → immediately reflected in pin tier

---

## Overlapping Export & Updated Row Handling

When ClinicHQ CSV exports overlap (e.g., staff exports Jan 1-31 then Jan 15-Feb 15), Atlas handles the duplicate rows gracefully.

### How Deduplication Works

**Stage 1: `staged_records` table**
```
UNIQUE (source_system, source_table, row_hash)
```
- Each row is hashed (`row_hash = md5(payload::text)`)
- On conflict (same source + table + hash): `DO UPDATE SET updated_at = NOW()`
- Effect: Identical rows from overlapping exports are **silently deduplicated** — no duplicate processing

**Stage 2: Entity Resolution Functions**
```
find_or_create_person(email, phone, first, last, ...)
find_or_create_cat_by_microchip(chip, name, ...)
find_or_create_request(source, record_id, ...)
find_or_create_place_deduped(address, name, ...)
```
- Each function checks for existing records before creating new ones
- Uses email/phone for people, microchip for cats, source_record_id for requests, normalized address for places
- If record exists: returns existing ID, may update metadata
- If new: creates and returns new ID

**Stage 3: Updated Rows (Same Record, Changed Data)**

If a row in ClinicHQ changes (e.g., staff corrects a note), the new export will have a **different `row_hash`**. This means:
- The staging step treats it as a new record (different hash)
- Processing re-runs entity resolution, which finds the existing entity by source_record_id
- The entity is updated with the new data
- `extraction_status.needs_reextraction` is NOT auto-set (known gap)

**What Tippy should know:**
> "Staff can safely re-upload overlapping ClinicHQ exports without creating duplicates. Identical rows are silently skipped. Changed rows will update the existing records. However, if a note was corrected and AI extraction needs to re-run, that requires manual re-extraction (delete the extraction_status row and re-run the script)."

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Same row, same data, different export | Deduplicated via row_hash — no processing |
| Same row, corrected data | New row_hash → re-processed → entity updated |
| Same person, different email | Data Engine creates new entity, flags for review |
| Same address, different formatting | `normalize_address()` catches most variants; `find_or_create_place_deduped` handles the rest |
| Deleted row in source | Atlas retains the record — no deletion propagation |

### Session: 2026-01-31 - Unified Map Pins & Reverse Geocoding (MAP_011)

**Context:** Map had three pin types (active, reference, historical dots) causing confusion. ~2,466 Google Maps entries were unlinked "floating" historical dots. Staff reported overlapping pins, broken popups, and confusing "Minimal Data" labels.

**Key Discoveries:**
- Google Maps KML pins placed at approximate coordinates, not exact addresses
- `acos()` floating-point bug in `try_match_google_map_entries_to_place()` caused trigger failures
- `place_origin` check constraint rejected 'google_maps' value
- `chk_address_backed_has_address` requires `sot_address_id` when `is_address_backed = TRUE`
- `<br>` tags from KML import rendered as literal text in notes display

**Changes Made:**
- **MIG_820**: Auto-linked 876 GM entries within 50m to nearest Atlas place; filtered empty apartment_building overlapping pins from `v_map_atlas_pins`
- **MIG_821**: Created 1,590 coordinate-only places from GM coordinates; built reverse geocoding pipeline (`create_place_from_coordinates`, `get_reverse_geocoding_queue`, `record_reverse_geocoding_result`); fixed acos bug with PostGIS `ST_Distance`/`ST_DWithin`; added 'google_maps' to `place_origin` constraint
- **Reverse geocoding batch**: 1,392 places upgraded with real addresses, 172 merged into existing places, 0 failed
- **Frontend**: Removed `historical_pins` layer entirely; fixed reference pin popups to use drawer instead of new tab; fixed `<br>` tag rendering in notes
- **Geocoding cron** (`/api/cron/geocode`): Extended with Phase 2 reverse geocoding using remaining budget

**Staff Impact:**
- Map now shows only two pin types: **active** (full teardrop) and **reference** (small muted)
- No more grey historical dots — all Google Maps data appears on proper Atlas pins
- Reference pin popups now show data summary and open the detail drawer (not a new tab)
- Google Maps notes display with proper line breaks instead of raw `<br>` tags
- 172 coordinate-only locations were automatically identified as duplicates and merged

**What Tippy should know:**
> "All Google Maps historical data is now integrated into Atlas pins. The old grey dots are gone. If a staff member asks about a location that used to show as a grey dot, it's now either a reference pin (small blue) or has been merged into an existing address pin. Reference pins have a 'Details' button that opens the full detail drawer."

> "Some coordinate-only places may still show with their Google Maps name (like 'Oliver's Market') instead of a street address — these have been reverse-geocoded and most now show the real address. A small number (~83) couldn't be resolved and remain as coordinate-only reference pins."

### Session: 2026-02-01 - Structural Place Family System (MIG_822)

**Context:** After MAP_011 (MIG_820-821), staff reported Google Maps notes invisible at some locations (1080 Jennings Ave). Investigation revealed multi-unit buildings had overlapping pins and notes only showed on the specific place they were linked to — not across related places (parent building, sibling units). Initial fix used 15m proximity radius which was rejected as a bandaid.

**Key Discoveries:**
- ~809 groups of places share exact coordinates but lack structural `parent_place_id` links
- `google-map-context` endpoint only queried `place_id`, completely missed `linked_place_id` (root cause bug)
- 15m `ST_DWithin` proximity for cross-place data was arbitrary and could match different buildings
- `backfill_apartment_hierarchy()` catches units with indicators (#, Apt, Unit) but many co-located places predate this system
- `find_or_create_place_deduped()` already handles unit detection for new data (MIG_246)

**Changes Made:**
- **MIG_822**: Created `get_place_family(place_id)` function — returns structurally related place IDs via parent/child/sibling relationships AND co-located detection (1m = same geocoded point)
- **MIG_822**: Re-ran `backfill_apartment_hierarchy()` to classify unlinked units
- **MIG_822**: Updated `v_map_atlas_pins` to filter empty unclassified co-located places (eliminates overlapping empty pins)
- **API fix**: Both `map-details` and `google-map-context` endpoints now use `get_place_family()` instead of 15m proximity
- **Root cause fix**: `google-map-context` now queries both `place_id` AND `linked_place_id`

**Staff Impact:**
- Google Maps notes now visible from ANY related place — clicking a unit shows building-level notes and sibling notes
- Empty overlapping pins at same coordinates are hidden (data-rich pin still shows)
- Apartment units properly linked to parent buildings where detectable
- No more invisible notes for places like 1080 Jennings Ave

**What Tippy should know:**
> "Google Maps notes are now aggregated across related places using `get_place_family()`. If a note was written about a building, it's visible from any unit at that address. If staff can't find a note they know exists, check if it's linked to a different unit or the parent building — the system now handles this automatically."

> "Some places share exact coordinates without being classified as apartment buildings. The system detects these as 'co-located' (same physical point within 1 meter) and aggregates their data together. Empty co-located places are hidden from the map to prevent confusing overlapping pins."

### Session: 2026-02-01 - Annotation Journaling, Data Integrity Audit, E2E Test Suite

**Context:** Staff needed to attach journal notes to map annotations (reference pins, colony sightings, hazards). Also needed data integrity verification for recent migrations (MIG_555/556/557) and a comprehensive e2e test suite.

**Key Discoveries:**
1. `journal_entries` used nullable FK columns for polymorphic entity linking — extending to annotations follows the same pattern
2. `v_journal_entries` view required DROP + CREATE (not CREATE OR REPLACE) because adding `primary_annotation_id` changed column order
3. MIG_555 initial run failed due to `source_table NOT NULL` constraint on `cat_place_relationships` — fixed by adding `source_table: 'person_cat_relationships'`
4. `journal_entity_links` CHECK constraint needed expansion to include `'annotation'` as valid entity type

**Changes Made:**
- **MIG_826**: Journal annotation support — `primary_annotation_id UUID` FK on `journal_entries`, partial index, entity type constraint expansion, view rebuild
- **MIG_555 fix**: Added missing `source_table` column to INSERT (1,742 adopted cats linked to places)
- **MIG_556**: Queued 3,050 places for geocoding (882 ClinicHQ, 1,432 ShelterLuv, 736 VolunteerHub)
- **MIG_557**: Backfilled 2,130 people with `primary_address_id`, created auto-set trigger
- **Journal API**: Added `annotation_id` filter/create support to GET/POST `/api/journal`
- **Annotation API**: Added GET handler to `/api/annotations/[id]` returning annotation details + journal entries
- **AnnotationDetailDrawer**: New component for viewing/journaling on annotations from the map
- **AtlasMap**: "Details" button in annotation popups opens the drawer
- **E2e test suite**: 3 new spec files (map-ux-audit, map-journal-writes, migration-data-integrity) + test fixture updates

**Staff Impact:**
- Staff can now click "Details" on any map annotation to view its full detail drawer with journal section
- Adding a note to an annotation creates a journal entry linked to that annotation
- Journal entries on annotations are visible from both the annotation drawer and the journal API
- Map annotations (reference pins, colony sightings, hazards, feeding sites) are now first-class journalable entities

**What Tippy should know:**
> "Map annotations now support journal entries. Staff can attach notes to any annotation on the map (reference pins, colony sightings, hazards, feeding sites) using the annotation detail drawer. These journal entries are filtered by `primary_annotation_id` and are visible via `/api/journal?annotation_id=UUID`. Annotations are lightweight map objects — they are NOT places, but they can hold field notes and observations."

*Last updated: 2026-02-01 (after annotation journaling + e2e test suite)*
