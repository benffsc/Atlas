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

*Last updated: 2026-01-29*
