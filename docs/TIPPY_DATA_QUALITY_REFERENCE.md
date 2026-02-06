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
| **ShelterLuv** | High | Program animals | Outcomes/intake only, no clinic/volunteer data | Animal outcomes, foster cats, relo cats, intake |
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
- ⚠️ **Historical data quality issues** - Pre-2024 records have informal/inconsistent entry practices
- ⚠️ **Owner info often missing/incorrect** - Many community cats have placeholder owners or org contact info
- ⚠️ **4% of TNR appointments have no microchip** - Data entry gaps
- ⚠️ **Animal Name field misuse** - Sometimes contains microchip, weight, or notes instead of name
- ⚠️ **Org Contact Proxy pattern** - Staff used partner org emails (e.g., marinferals@yahoo.com) for resident bookings until 2024

**What Tippy should know:**
> "ClinicHQ is our ground truth for alterations but has historical data quality issues. Data entry practices were informal until 2024 when Atlas was implemented. If a record seems to have wrong contact info or cats linked to the wrong person, check if it predates 2024 — staff often used partner org emails instead of actual resident contact info."

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

### ShelterLuv (Program Animals & Outcomes)

**What it is:** FFSC's animal management system for tracking program animals and their outcomes. Contains animals (cats in foster/relo/adoption programs), outcome events (adoption, foster placement, transfer, mortality), and intake events (how animals enter FFSC programs). Synced via API every 6 hours.

**Strengths:**
- Authoritative for program animal outcomes (adoption, foster placement, relocation, transfer, mortality)
- Authoritative for animal intake (how cats enter FFSC programs)
- API provides clean data with numeric Internal-IDs and Microchips JSON arrays
- Covers 11,390+ animals and 8,364+ events going back to July 2022

**Limitations:**
- NOT authoritative for volunteer PEOPLE — "fosters" = VolunteerHub people, "foster cats" = ShelterLuv outcomes
- NOT authoritative for clinic data (TNR, medical records, microchip verification)
- 44% of SL people have no email or phone (skipped by Data Engine)
- Historical XLSX exports had scientific notation corruption (MIG_874 fixed by switching to API)

**Authoritative For:**
- Foster CATS (Outcome.Foster events)
- Adopted CATS (Outcome.Adoption events)
- Relocated CATS (Outcome.Adoption + Subtype=Relocation)
- Animal intake (Intake.FeralWildlife, Intake.OwnerSurrender, Intake.Stray, etc.)
- Animal mortality (Outcome.Euthanasia, Outcome.UnassistedDeathInCustody)
- Transfers (Outcome.Transfer)

**NOT Authoritative For:**
- Foster PEOPLE — these come from VolunteerHub
- Trappers — these come from VolunteerHub
- Clinic volunteers — these come from VolunteerHub
- Medical records — these come from ClinicHQ

**What Tippy should know:**
> "ShelterLuv tracks what happens to program animals. When staff say 'fosters' they mean foster PEOPLE from VolunteerHub. When they say 'foster cats' they mean cats in foster from ShelterLuv. Always check `source_semantic_queries` table to route queries correctly. Intake events show HOW cats entered the program (stray, owner surrender, feral wildlife, etc.)."

**Key Tables:**
- `cat_intake_events` — When animals entered FFSC programs (MIG_879)
- `person_cat_relationships` (where source_system='shelterluv') — Adopter, foster, owner relationships
- `place_contexts` (where assigned_by='shelterluv_events_processor') — Place tags from outcomes

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

### 2026-02-06: DQ_015 — Linda Price / Location-as-Person Cleanup (MIG_917)

**Problem:** Linda Price (a real volunteer/community trapper) was merged INTO "The Villages" — a location name that became a person record. Additionally, "Golden Gate Transit SR" and "So. Co. Bus Transit Yard" were also location-as-person records with complex merge chains.

**Investigation:**
ClinicHQ staff entered trapping site names in the Owner First Name field:
- "Golden Gate Transit SR" → became a person record
- "The Villages" → became a person record (with 16 merged records, including 2 Linda Price records!)
- "So. Co. Bus Transit Yard" → became a person record (with many duplicates)

28 total location-as-person records were discovered with complex FK chains.

**Solution:**
- **MIG_917:**
  - Unmerged Linda Price records from The Villages
  - Consolidated to canonical Linda Price with correct identifiers (forestlvr@sbcglobal.net, 707-490-2735)
  - Cleaned up ALL 28 location-as-person records with comprehensive FK cleanup
  - Created correct person-place relationships for Linda:
    - 100 Winchester Drive (resident - home)
    - 3225 Industrial Drive (contact - Golden Gate Transit trapping site)
    - 2980 Bay Village Circle (contact - The Villages trapping site)

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Location-as-person records | 28 | 0 |
| Linda Price identifiers | None | email + phone |
| Linda Price place relationships | Merged into fake person | 3 correct (1 resident, 2 contact) |

**What Tippy should know:**
> "Linda Price is a volunteer/community trapper who lives at 100 Winchester Drive in Santa Rosa. She traps cats at Golden Gate Transit (3225 Industrial Drive) and The Villages Apts (2980 Bay Village Circle). If staff asks about 'Golden Gate Transit SR' or 'The Villages' as a person, explain those were location names incorrectly entered as people and have been cleaned up. Linda's cats should be linked to her actual locations."

**New Invariant:** INV-18 — Location names must not create person records

### 2026-02-06: DQ_014 — FFSC Organizational Email Pollution Fix (MIG_915, MIG_916)

**Problem:** Sandra Brady had 1,253 cats and Sandra Nicander had 1,171 cats linked as `caretaker` relationships. These were ALL erroneous — created when ClinicHQ appointments used FFSC organizational emails like `info@forgottenfelines.com`.

**Investigation:**
`should_be_person()` only checked NAME patterns, not EMAIL patterns. ClinicHQ processing called `find_or_create_person()` directly, bypassing Data Engine's email rejection logic. Every appointment with `info@forgottenfelines.com` (3,167 total!) linked cats to Sandra Brady's person record.

**Solution:**
- **MIG_915:** Updated `should_be_person()` to reject organizational emails at the routing gate:
  - `@forgottenfelines.com/org` domains → reject
  - Generic prefixes (`info@`, `office@`, `contact@`, `admin@`) → reject
  - High-threshold soft-blacklisted emails → reject
  - Added 10 FFSC organizational emails to `data_engine_soft_blacklist`

- **MIG_916:** Deleted erroneous `caretaker` relationships while preserving legitimate `owner` relationships:
  - Sandra Brady: 1,253 → 1 cat
  - Sandra Nicander: 1,171 → 242 cats

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Sandra Brady cats | 1,253 | 1 |
| Sandra Nicander cats | 1,171 | 242 |
| should_be_person('info@forgottenfelines.com') | TRUE (bug!) | FALSE |
| FFSC emails in soft blacklist | 0 | 10 |

**What Tippy should know:**
> "Sandra Brady and Sandra Nicander are FFSC staff members. Previously, the system incorrectly linked thousands of community cats to them because clinic appointments used organizational emails like info@forgottenfelines.com. This has been fixed. Sandra Brady now has 1 legitimate cat, and Sandra Nicander has 242 remaining cats (mix of legitimate and possibly some historical). If staff asks why Sandra used to have thousands of cats, explain this was a data pollution issue that has been corrected."

**New Invariant:** INV-17 — Organizational emails must not create person records

### 2026-02-06: DQ_013 — Spaletta Cat-Place Pollution Cleanup (MIG_914)

**Problem:** Spaletta's 71 cats were linked to ALL THREE addresses (949 Chileno Valley, 1054 Walker, 1170 Walker). Each cat counted 3x on the map, violating INV-6 (Place Individuality).

**Investigation:**
`link_cats_to_places()` creates links via `person_place → person_cat` chain. Spaletta had `resident` role at all 3 addresses. When linking ran, all 71 cats propagated to all 3 of Spaletta's "resident" addresses.

**Solution:**
- **MIG_914:** Removed Spaletta cats from Walker Rd addresses (142 links deleted = 71 cats × 2 wrong addresses)
- Kept Buddy at 1170 Walker Rd (owned by Tresch, not Spaletta)
- Reclassified Spaletta's Walker Rd roles from `resident` → `contact`
- Deployed MIG_912's `detect_colony_caretakers()` to tag Chileno Valley as `colony_site`

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Spaletta cat locations | 3 addresses (213 total links) | 1 address: 949 Chileno Valley (71 links) |
| Spaletta Walker Rd role | resident (2 addresses) | contact (prevents cat linking) |
| Chileno Valley context | None | colony_site |

**What Tippy should know:**
> "Spaletta is a colony caretaker at 949 Chileno Valley Road with 71 cats. She's listed as 'contact' at 1054 and 1170 Walker Rd (Tresch family ranches) but doesn't live there. The 'contact' role prevents cat-place pollution. If staff asks about cats at Walker Rd, only Buddy (owned by Tresch) should appear there."

**Key Learning:** Large cat counts from one person should trigger colony detection. Person-place roles must distinguish residence from contact.

### 2026-02-06: DQ_012 — Buddy Walker Rd Shared Phone Fix (MIG_913)

**Problem:** Cat "Buddy" (981020053734908) counted twice at 1170 and 1054 Walker Rd, linked to wrong person (Samantha Spaletta instead of Samantha Tresch).

**Investigation:**
Two different people share phone `7072178913`:
- **Samantha Spaletta** — 949 Chileno Valley Rd (2018 ClinicHQ record)
- **Samantha Tresch** — 1170 Walker Rd (2025 Airtable/ClinicHQ, Buddy's actual owner)

When Buddy's appointment came in with phone `7072178913`, identity resolution matched the existing Spaletta record. Additionally, Tresch's record (from Airtable) had **zero identifiers**, so it couldn't claim the appointment.

A `data_fix` migration also incorrectly linked Buddy to 1054 Walker Rd (another Tresch property).

**Solution:**
- **MIG_913:** Removed erroneous cat-place links (1054 Walker, 949 Chileno Valley)
- Updated person-cat relationship from Spaletta → Tresch
- Added phone `7072178913` to `data_engine_soft_blacklist` (requires 70% name similarity to match)
- Added phone identifier to Samantha Tresch record
- Created person-place relationship: Tresch → 1170 Walker Rd

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Buddy place links | 3 (including wrong 1054 Walker, Chileno Valley) | 1 (correct: 1170 Walker Rd) |
| Buddy owner | Samantha Spaletta (wrong) | Samantha Tresch (correct) |
| Phone 7072178913 | Auto-matches any person | Soft-blacklisted, requires name verification |

**What Tippy should know:**
> "Phone `7072178913` is shared between two families (Spaletta at Chileno Valley, Tresch at Walker Rd). It's soft-blacklisted, meaning appointments with this phone won't auto-match - they require name similarity verification. If staff asks about Buddy at Walker Rd, confirm it's Samantha Tresch, not Spaletta."

**Key Learning:** Shared family/business phones cause identity resolution errors. Use `data_engine_soft_blacklist` to flag these.

### 2026-02-06: DQ_011 — Cat-Place Linking Pipeline Improvements (MIG_912)

**Problem:** Cat "Macy" (981020039875779) had 4 place links including wrong address (3537 Coffey Meadow) where owner moved TO, not where cat lives (2001 Piner Rd).

**Investigation:**
Three systemic issues found in cat-place linking pipeline:

1. **Temporal awareness missing:** `link_cats_to_places()` used `ORDER BY created_at DESC`, picking NEWEST address. When person moves, cats got linked to new address instead of old one where cat lives.

2. **Phone-only appointments unlinked:** MIG_902 existed but was never integrated into `run_all_entity_linking()`. 106 phone-only appointments (like Macy's 2026 appointment via Sandra Nicander's phone) were never linked.

3. **Colony site pollution:** 31 cats linked to one caretaker at Apt #256 made that apartment unit look like a colony. No detection/flagging for high cat counts per person-place.

**Solution:**
- **MIG_912:** Updated `link_cats_to_places()` to use `created_at ASC` (prefer OLDER addresses where cat was first seen)
- Added `valid_to` check against cat's first appointment date
- Added `'caretaker'` to `person_place_role` enum, excluded from cat-place linking
- Created `detect_colony_caretakers()` function (flags 15+ cats per person-place as `colony_site`)
- Integrated phone linking (MIG_902) as Step 10 in `run_all_entity_linking()`
- Colony detection as Step 11 in pipeline

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Macy place links | 4 (including wrong Coffey Meadow) | 2 (correct: Piner Rd Apt 186, Piner Rd parent) |
| Phone-only linking | Not in pipeline | Step 10 |
| Colony detection | None | Auto-tags 15+ cats |

**What Tippy should know:**
> "Cats are now linked to addresses where they were FIRST seen, not where owner later moved. If a cat shows at an unexpected address, check `person_place_relationships.created_at` against the cat's first appointment date. Places with 15+ cats from one person are auto-tagged as `colony_site` in `place_contexts`."

**Key Learning:** Address ordering must consider temporal context. Person moves ≠ cat moves.

### 2026-02-06: DQ_010 — Address in Owner Name Field (MIG_909)

**Problem:** Cats 900263005064321 and 981020053841041 had no place link despite address being available in ClinicHQ data.

**Investigation:**
ClinicHQ staff entered address "5403 San Antonio Road Petaluma" in Owner Name fields (no actual owner for community cats). ClinicHQ's autocorrect then corrupted the Owner Address field to "San Antonio Rd Silviera Ranch, Petaluma, CA 94952, Marin".

The `classify_owner_name()` function correctly returned `'address'`, but `find_or_create_clinic_account()` never extracted a place from it. Appointments were linked to corrupted address via `booking_address` source before `clinic_owner_accounts` source could run.

**Solution:**
- **MIG_909:** Updated `find_or_create_clinic_account()` to extract places when `classify_owner_name()` returns `'address'`. Sets `linked_place_id` on the account.
- Backfilled existing `clinic_owner_accounts` where `display_name` is classified as address.
- Manual fix for target cats: merged duplicate place, updated `inferred_place_source = 'owner_account_address'`.
- Fixed pre-existing bug in `process_clinichq_owner_info()`: `start_date` → `effective_date` column name.

**Result:**
| Cat Microchip | Before | After |
|---------------|--------|-------|
| 900263005064321 | No place link | 5403 San Antonio Rd ✓ |
| 981020053841041 | No place link | 5403 San Antonio Rd ✓ |

**What Tippy should know:**
> "When staff enters an address in the Owner Name field (common for community cats with no owner), Atlas now extracts a place from that address. If you see `inferred_place_source = 'owner_account_address'`, the place came from the clinic account's display name, not the corrupted Owner Address field. This handles ClinicHQ's autocorrect corruption issue."

**Key Learning:** ClinicHQ autocorrect corrupts addresses. Always prefer address extracted from owner name fields (if classified as address) over the Owner Address field.

### 2026-02-06: DQ_009 — Boolean Field Standardization + Phone-Only Linking (MIG_899, MIG_900, MIG_901, MIG_902, MIG_903)

**Problem:** Boolean field extraction was inconsistent across the codebase:
- MIG_870 health flags used `IN ('Yes', 'TRUE', 'true')` — missing 'Y', 'Checked'
- TypeScript ingest route used `= 'Yes'` — only catching one variant
- UI `isPositiveValue()` function handles all variants correctly
- Result: Health conditions underreported if ClinicHQ used 'Y' or 'Checked'

**Investigation:**
- `v_clinichq_boolean_values` view revealed inconsistent raw values
- 106 appointments had phone-only contact info (INV-15) — not linked to persons
- 4,331 appointments have no microchip in ClinicHQ source — unresolvable

**Solution:**
- **MIG_899:** Added enriched columns for misc flags (polydactyl, bradycardia, etc.) with proper boolean checking
- **MIG_900:** Created canonical `trapper.is_positive_value()` function that handles: Yes, TRUE, Y, Checked, Positive, 1, Left, Right, Bilateral (case-insensitive). Updated `process_staged_appointment()` to use it.
- **MIG_901:** Created 4 data quality monitoring views (`v_appointment_data_quality`, `v_clinichq_boolean_values`, `v_appointment_linking_gaps`, `v_data_quality_health`)
- **MIG_902:** Added phone-only appointment linking — 37 appointments linked, 1,183 person-cat relationships created
- **MIG_903:** Created views to track unresolvable appointments (ClinicHQ data entry issue, not Atlas bug)
- **TypeScript fix:** Updated `/api/ingest/process/[id]/route.ts` to use `trapper.is_positive_value()` instead of `= 'Yes'`

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Health flag detection | Partial (missing 'Y', 'Checked') | Complete |
| Person link % | 97.9% | 98.0% |
| Phone-only appointments linked | 0 | 37 |
| Enriched misc flags | 0 columns | 6 columns |

**North Star Alignment:** All fixes verified against CLAUDE.md rules. No violations except the TypeScript route which was fixed.

**Key Learning:** Always use `trapper.is_positive_value()` for boolean extraction. Never hardcode `= 'Yes'`.

### 2026-02-04: DQ_008 — Unlinked Cats Deep Investigation + Gap Prevention

**Problem:** After MIG_884-886, 3,536 cats still have no `person_cat_relationships`. Needed root cause analysis per category and preventive invariants.

**Investigation:**
Deep query analysis traced every unlinked cat to its source system and reason:
- **1,461 ShelterLuv-only**: Zero appointments. 3,348 adoption/foster events exist in `staged_records` but 1,616 adoptions + 1,732 fosters are unprocessed (`is_processed = false`). `process_shelterluv_outcomes()` would create person-cat links for these.
- **956 PetLink-only**: Bulk microchip registry import (2026-01-11). Have microchips but were never seen at FFSC clinic or ShelterLuv. Expected — external data.
- **662 ClinicHQ with appointments**:
  - 351 have NO contact info (email or phone) on the appointment — cannot auto-link
  - 205 have email but `link_appointments_to_owners()` didn't process them
  - 106 have phone ONLY — **BUG**: function has `WHERE a.owner_email IS NOT NULL`, skipping phone-only records entirely
- **439 ClinicHQ without appointments**: Cat records exist from ingest but no `sot_appointments` row links to them
- **48 both sources + 10 no identifiers**: Edge cases

**Bug found:** `link_appointments_to_owners()` (MIG_862, Step 2) requires email to process:
```sql
WHERE a.owner_email IS NOT NULL AND a.person_id IS NULL  -- skips phone-only!
```
Fix: `WHERE (a.owner_email IS NOT NULL OR a.owner_phone IS NOT NULL) AND a.person_id IS NULL`

**Trapper gap investigation:** 102 unassigned requests:
- 69 Airtable requests genuinely had no trapper (field empty)
- 24 assigned to "Client Trapping" pseudo-trapper (no email, no person_id — expected)
- 9 new requests (atlas_ui/web_intake) — not yet assigned

**Solution:** 6 new system invariants added to CLAUDE.md:
1. Entity linking must re-run after backfills
2. Owner linking must support phone-only
3. ShelterLuv outcomes must be fully processed
4. Trapper linking depends on request volume (structural, not a bug)
5. PetLink cats are external registry data (not a gap)
6. Re-run `link_cats_to_places()` after any person_place backfill

**Result:** All gaps fully documented with root causes, actionable fixes identified, and preventive invariants added.

### 2026-02-05: DQ_007 — Beacon Readiness Gap Closure (MIG_884, MIG_885, MIG_886)

**Problem:** Beacon readiness audit found 4 gaps: cat-place coverage 91.7%, geocoding 92.2%, trapper-appointment linking 3.2%, mortality cron limit 50.

**Investigation:**
- Cat-place gap root cause: 2,569 cats have no `person_cat_relationships` at all (hard ceiling). 438 adopter+resident cats were linkable but `link_cats_to_places()` hadn't been re-run after MIG_877 backfill. 105 ClinicHQ people had addresses in staged_records but no `person_place_relationships`.
- Geocoding: 91 places permanently failed after 5 attempts. Cron IS running (*/30 in vercel.json).
- Trapper-appointment: Current function matches via owner email/phone = trapper, which is fundamentally wrong (owner ≠ trapper). Real path is appointment → cat → place → request → trapper.
- Mortality: ShelterLuv mortality already handled by MIG_874 (`process_shelterluv_events`).

**Solution:**
- **MIG_884:** Backfilled 105 ClinicHQ owner addresses into `person_place_relationships`. Expanded `link_cats_to_places()` to include `requester` role (unlocked 1,951 additional cat-place edges). Re-running the function alone created 4,542 edges from MIG_877 backlog.
- **MIG_885:** Re-queued 86 permanently failed geocoding places. Increased `record_geocoding_result()` max_attempts from 5 to 10. 1,167 places now in geocoding queue.
- **MIG_886:** Added `request_id` column to `sot_appointments`. Created `link_appointments_to_requests()` using place + attribution window (MIG_860 rules). Updated `link_appointments_to_trappers()` with two-pass: request chain first, email/phone fallback. 1,348 appointments linked to requests, 972 got trappers.
- Mortality cron limit increased from 50 to 200 per run.

**Result:**
| Metric | Before | After |
|--------|--------|-------|
| Cat-place coverage | 91.7% | 92.9% |
| Geocoding | 92.2% | 92.9% (processing) |
| Trapper-appointment | 3.2% | 5.3% |
| Mortality cron | 50/run | 200/run |

**Remaining gaps:** Cat-place ceiling is 3,536 cats with no person association (see DQ_008 for breakdown). Trapper-appointment limited by only 289 requests (grows as staff creates requests). Geocoding will improve to ~95%+ as cron processes the queue.

### 2026-02-05: DQ_006 — Data Quality Filtering for Map, Search & Shared Phone Monitoring (MIG_882, MIG_883)

**Problem:** People with `data_quality='garbage'` or `'needs_review'` appeared in map pin popups, search results, and the volunteers layer. 717 bad-quality records (133 garbage + 584 needs_review) were polluting user-facing surfaces.

**Solution:**
- **MIG_882:** Added `data_quality NOT IN ('garbage', 'needs_review')` filter to:
  - `v_map_atlas_pins` people CTE (map pin popups)
  - `search_unified()` PEOPLE section (global search)
  - Volunteers layer query in `/api/beacon/map-data` route
- **MIG_883:** Created `v_shared_phone_candidates` monitoring view that detects phone numbers shared between active trappers and non-trapper people. Seeds `data_engine_soft_blacklist` with any unprotected shared phones (reason: `trapper_colony_phone_sharing`).

**Result:** Search for "Gordon" now returns only canonical Gordon Maxwell (26 cats) — no phantom first-name-only records. Map pins no longer show garbage/needs_review people in popups.

**Ingest pipeline verified safe:** `search_unified()` and `v_map_atlas_pins` are read-only display surfaces. Zero ingest or entity-linking functions depend on them. ClinicHQ upload → staging → processing → entity linking pipeline is completely independent.

**Known Data Pattern: Trapper-Colony Phone Sharing**

> Legacy FFSC trappers often gave their cell phone as the contact number for elderly or less capable colony owners they managed. This is a common operational pattern, especially from the early days of FFSC operations. When both a trapper and a colony owner share a phone number, identity matching can incorrectly link the colony owner's appointments to the trapper (or vice versa).
>
> **How Atlas handles this:**
> 1. `process_clinichq_owner_info()` now prefers Owner Phone over Owner Cell Phone (MIG_881)
> 2. Shared trapper phones are added to `data_engine_soft_blacklist` (MIG_883)
> 3. `v_shared_phone_candidates` monitors for new cases (query via Tippy)
>
> **If staff see a trapper with unexpectedly many cats**, check if they share a phone with a colony owner. The soft blacklist requires name similarity (0.6+) for phone matches, preventing automatic cross-linking.

**What Tippy should know:**
> "If asked about shared phones between trappers and colony owners, query `v_shared_phone_candidates`. This is a known legacy pattern — trappers gave their cell phone as contact for elderly colony owners. The system now monitors for this and adds shared phones to the soft blacklist."

---

### 2026-02-04: DQ_005 — Phone COALESCE Cross-Linking Fix (MIG_881)

**Problem:** `process_clinichq_owner_info(integer)` (MIG_573) used `COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')` — preferring cell phone over landline for identity matching. When two phones resolve to different people (household phone sharing), appointments got linked to the wrong person.

**Discovery:** Staff reported Gordon Maxwell (20+ cats in ClinicHQ) showing 0 cats in Atlas, while 8 phantom "Gordon" (first-name-only) records appeared in map search. Investigation revealed Gordon Maxwell shares cell phone 707-543-6499 with Susan Simons. Because COALESCE preferred cell phone, all of Gordon's appointments were linked to Susan.

**Scope of bug:** 30+ affected clients across 1,386 cross-linked appointments, including Henry Dalley (57 appts), Comstock Middle School (46), Cal Eggs (37), Alina Kremer (36), Gordon Maxwell (34), Anytime Fitness (28), Michael Proctor (28), Pam Stevens (26).

**Root cause:** MIG_152 introduced cell-phone-first priority for observation extraction (to avoid grouping by FFSC's shared landline 707-576-7999). This was correct for observations but MIG_573 copied the pattern into identity matching where it causes household cross-linking.

**Solution (MIG_881):**
- **Phase 1:** Reversed COALESCE in `process_clinichq_owner_info(integer)` to prefer Owner Phone over Owner Cell Phone
- **Phase 2a:** Re-linked 1,386 cross-linked appointments to correct people (143 people affected)
- **Phase 2b:** Removed 7,616 orphaned person_cat_relationships
- **Phase 2c:** Created 880 correct person_cat_relationships
- **Phase 3:** Merged 8 phantom "Gordon" first-name-only records into canonical Gordon Maxwell
- **Phase 4:** Removed 176 `@petlink.tmp` fabricated emails from person_identifiers
- **Phase 5:** Marked 575 first-name-only web_app records as `data_quality='needs_review'`

**Result:**
- Gordon Maxwell: 0 → 44 appointments, 0 → 26 cats, 0 → 26 PCR
- Susan Simons: 82 → 38 appointments, 47 → 21 cats (kept only her own)
- Both function overloads (`integer` and `uuid, integer`) now use correct phone priority

**What Tippy should know:**
> "In February 2026 we discovered that household phone sharing caused ~1,386 appointments to be linked to the wrong person. The bug was in how we prioritized cell phones vs landlines — cell phones are often shared between household members (spouses, family), so using them for identity matching caused cross-linking. The fix prefers the 'Owner Phone' (typically a personal/landline) over 'Owner Cell Phone'. If a staff member notices a person with unexpectedly many or few cats, check if they share a phone number with another person in the household."

**Additional cleanup:**
- `@petlink.tmp` emails were fabricated from phone numbers during an older PetLink processing script — not found in current codebase, likely a one-off migration. All 176 removed.
- 575 first-name-only records from `web_app` marked `needs_review` — these may be partial intake submissions or data entry errors.

**Staff Impact:**
- People who appeared to have someone else's cats now show only their own
- People who appeared to have no cats now correctly show their animals
- ~143 people affected across the database

---

### 2026-02-04: Source System Authority Map + ShelterLuv Data Completeness (MIG_875-880)

**Problem:** After fixing ShelterLuv outcomes (MIG_874), several gaps remained: no documentation of which system is authoritative for which data, events sync stale 12+ days, 4,960 SL people had addresses but no place links (wrong field name bug), and 4,179 intake events were unprocessed.

**CRITICAL — Source System Authority:**
- **VolunteerHub** = authoritative for volunteer PEOPLE (trappers, fosters, clinic volunteers)
- **ShelterLuv** = authoritative for program ANIMALS and outcomes (foster cats, relo cats, adopted cats, intake)
- **ClinicHQ** = authoritative for clinic clients/owners, TNR procedures, medical records
- "Show me fosters" = foster PEOPLE from VolunteerHub, NOT foster cats from ShelterLuv
- "Show me foster cats" = cats in foster from ShelterLuv Outcome.Foster events
- VH group hierarchy: "Approved Volunteer" (parent) > "Approved Trappers", "Approved Foster Parent", "Clinic Volunteers"

**Solution:**
- **MIG_875:** Created `source_semantic_queries` table + `v_source_authority_map` view. Added `authority_domains` JSONB to `orchestrator_sources`. Documents which system owns what.
- **MIG_876:** Reset events `last_sync_timestamp` to NULL (forces re-sync). Added `last_check_at` column to distinguish "checked but nothing new" from "hasn't run."
- **MIG_877:** Backfilled ~4,960 SL people addresses into `person_place_relationships` via `find_or_create_place_deduped()`.
- **MIG_878:** Backfilled place contexts (adopter_residence, foster_home, relocation_destination, colony_site) for outcome relationships that now have places.
- **MIG_879:** Created `cat_intake_events` table + `process_shelterluv_intake_events()`. Processed 4,179 intake events. Reset intake events that were incorrectly marked processed by outcome processor.
- **MIG_880:** Registered `v_source_authority_map`, `v_source_semantic_queries`, `v_cat_intake_summary` in Tippy catalog.

**Result:**
- Source authority documented in code, database, CLAUDE.md, and Tippy
- Events sync health restored
- Place context counts increased significantly (foster_home, adopter_residence, relocation_destination)
- 4,179 intake events processed into `cat_intake_events` table
- Tippy can now route "show me fosters" to VolunteerHub and "show me foster cats" to ShelterLuv

**What Tippy should know:**
> "When staff ask about 'fosters', they mean foster PEOPLE (volunteers from VolunteerHub), not foster cats (from ShelterLuv outcomes). Always check `source_semantic_queries` to route queries to the right data source. Intake events (when animals enter FFSC programs) are now tracked in `cat_intake_events`."

**Staff Impact:**
- Tippy now correctly understands the difference between "fosters" (people) and "foster cats" (animals)
- Relocation spots, adopter residences, and foster homes now show on the map with full address data
- Intake history for cats is now queryable (when they entered the program, how, and from whom)

---

### 2026-02-03: DQ_004 — ShelterLuv Phantom Cat + Microchip Validation + Foster Homes (MIG_871, MIG_872, MIG_873)

**Problem:** Auditing ShelterLuv foster/adopter data revealed that **76.9% of SL adopter links** pointed to a phantom cat "Daphne" created from a junk microchip (`981020000000000` — Excel scientific notation artifact). Additionally, 23 cats had concatenated microchips, and 95 VolunteerHub foster parents had no `foster_home` place tags.

**Investigation:**
- ShelterLuv XLSX export converted microchip `9.8102E+14` to `981020000000000` (all-zeros pattern)
- `find_or_create_cat_by_microchip()` only checked `LENGTH >= 9` — accepted the junk chip and created a phantom cat
- Every subsequent SL outcome with the same junk chip matched to the phantom → 2,155 SL IDs accumulated on one cat
- `process_shelterluv_outcomes()` then created 1,161 fake adopter + 25 fake foster relationships
- These cascaded through `link_cats_to_places()` (Step 8) into 1,331 fake cat_place links
- Foster parents from VolunteerHub had places but `link_vh_volunteer_to_place()` never checked for foster role

**Solution:**
- **MIG_872:** Cleaned phantom Daphne — deleted 2,156 identifiers, 1,202 person_cat, 1,331 cat_place. Merged phantom into real Daphne.
- **MIG_873 (pending):** `validate_microchip()` gatekeeper — rejects all-zeros, length > 15, all-same-digit, known test patterns. Integrated into `find_or_create_cat_by_microchip()` and SL processing functions.
- **MIG_871:** Tagged 95 foster parents' residential places as `foster_home`. Updated VH cron function to auto-tag going forward.

**Result:**
- SL data clean: 349 real adopters, 4 real fosters, 13 real owners (down from 1,510/29/29)
- Foster parents now queryable via `foster_home` place context
- Three new North Star invariants: INV-14 (microchip validation), INV-15 (canonical view rule), INV-16 (SL outcomes via API not XLSX)

**Staff Impact:**
- If staff ask about ShelterLuv foster/adopter numbers being lower than expected: the previous high numbers were inflated by a phantom cat. The current counts reflect real, verified relationships.
- Foster parent locations are now visible on the map and queryable.
- The SL outcome data (6,420 records) came from XLSX imports. For accurate data, outcomes should be re-pulled from the ShelterLuv API.

### 2026-02-03: DQ_003 — Cat-Place Linking Gap (MIG_870)

**Problem:** Cats linked to people as caretakers (or foster, adopter, colony_caretaker) were NOT linked to those people's places. Example: cat with microchip 981020053820871 is connected to Toni Price (caretaker) who has an address, but the cat shows "No places linked" in the UI.

**Investigation:**
- The entity linking pipeline creates `person_cat_relationships` (Step 7, MIG_862) from appointments
- But `link_cats_to_places()` (MIG_797) only handles `relationship_type = 'owner'`
- `link_cats_to_places()` was also never called from the pipeline — only the older `run_cat_place_linking()` (staged_records path) was invoked
- Result: thousands of cats with person links but no place links

**Solution:**
- **MIG_870:** Expanded `link_cats_to_places()` to handle owner, caretaker, foster, adopter, colony_caretaker
- Added `'person_relationship'` evidence type to `link_cat_to_place()` gatekeeper
- Added as **Step 8** in `run_all_entity_linking()` — runs automatically on every ingestion cycle
- Backfilled all existing data

**Result:** Cats with person_cat relationships now automatically get cat_place links. Pipeline is permanent.

**Staff Impact:** Cat detail pages that previously showed "No places linked" will now show the caretaker/foster/adopter's address. No workflow changes needed — data appears automatically.

### 2026-02-03: DQ_002 — Inflated Cat Counts on Map + Excessive Cat Identifiers (MIG_868, MIG_869)

**Problem:** Some places on the Beacon map showed 1000+ cats, far exceeding what's physically possible. Separately, some cats had dozens of identifiers.

**Investigation:**
- Map cat counts come from `COUNT(DISTINCT cat_id) FROM cat_place_relationships` — this query never excluded merged cats
- When Cat A is merged into Cat B, `sot_cats.merged_into_cat_id` is set on Cat A, but its `cat_place_relationships` rows remain orphaned
- Similarly, `cat_identifiers` on merged cats were never transferred to the canonical cat
- Multiple source_tables could link the same cat to the same place, creating duplicate rows
- Low-confidence microchip format guesses (truncated, AVID reinterpretations) accumulated alongside real chips

**Root Causes:**
1. **Merged cats not filtered from map counts** — `v_map_atlas_pins`, places layer, TNR priority layer, clinic activity layer, and summary stats all counted merged cats
2. **Duplicate cat-place links** — Same cat at same place via `appointment_info` and `entity_linking` source_tables
3. **Orphaned identifiers on merged cats** — Not transferred to canonical cat on merge
4. **Low-confidence microchip variants** — Format detection (MIG_553) created separate entries for truncated/AVID/10-digit interpretations even when the cat already had a high-confidence 15-digit ISO chip

**Solution:**
- **MIG_868:** Audit + remediation for places
  - Diagnostic queries comparing `cat_place_relationships` against actual appointment evidence
  - Removes all `cat_place_relationships` for merged cats
  - Deduplicates same-cat-same-place entries (keeps `appointment_info` source)
  - Removes residual `appointment_person_link` pollution from pre-MIG_590
- **MIG_869:** Audit + remediation for cat identifiers
  - Re-points identifiers from merged cats to their canonical cat (or removes if duplicate)
  - Removes junk microchip identifiers (too short, all letters, all zeros, test data)
  - Removes low-confidence format guesses where high-confidence chip exists
- **map-data/route.ts:** All cat count subqueries now JOIN `sot_cats` with `merged_into_cat_id IS NULL`
- **v_map_atlas_pins (MIG_820):** Cat count subquery updated to exclude merged cats

**Result:** Run MIG_868 then MIG_869. Map cat counts will reflect only active (non-merged) cats with valid place links.

**What Tippy should know:**
> "Some places previously showed inflated cat counts on the map because merged cats were still being counted. When two cat records are merged (e.g., same cat entered twice), the old record's place links weren't cleaned up. MIG_868 removes these orphaned links and deduplicates entries. After running, places should show accurate counts. Having 3-5 identifiers per cat is normal (microchip + source system IDs). Cats with 10+ identifiers had accumulated low-confidence format guesses that MIG_869 cleans up."

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

### Session: 2026-02-04 (Part 3) - Unlinked Cats Deep Dive + Gap Documentation

**Context:** After MIG_884-886 closed Beacon gaps, deep investigation of remaining 3,536 unlinked cats to understand root causes and document preventive invariants.

**Key Discoveries:**
1. **3,536 cats have no `person_cat_relationships`** (not 2,569 as initially estimated — recounted)
2. **1,461 ShelterLuv-only cats**: Have no clinic appointments. 3,348 SL adoption/foster events exist but 1,616 adoptions + 1,732 fosters are NOT processed. `process_shelterluv_outcomes()` needs to process all events.
3. **662 ClinicHQ cats with appointments but no person link**:
   - 351 appointments have NO contact info (email/phone) — cannot auto-link
   - 205 have email but `link_appointments_to_owners()` didn't process them (batch limit or error)
   - 106 have phone ONLY — `link_appointments_to_owners()` has `WHERE a.owner_email IS NOT NULL` and SKIPS phone-only records entirely
4. **956 PetLink-only cats**: Bulk microchip registry import (2026-01-11). Never seen at FFSC. Expected unlinked.
5. **439 ClinicHQ cats with no appointments at all**: Cat records exist but no appointment links them
6. **Trapper assignment gap**: 24 of 102 unassigned requests have "Client Trapping" pseudo-trapper in Airtable (requester trapped themselves, no real person_id). 69 genuinely had no trapper. 9 are new/unassigned.

**Root Cause: `link_appointments_to_owners()` phone-only bug:**
```sql
-- Current (broken for phone-only):
WHERE a.owner_email IS NOT NULL AND a.person_id IS NULL
-- Should be:
WHERE (a.owner_email IS NOT NULL OR a.owner_phone IS NOT NULL) AND a.person_id IS NULL
```
This is in MIG_862 (`link_appointments_to_owners()` Step 2). Affects 106+ cats.

**Staff Impact:**
- No immediate workflow changes
- 6 new system invariants added to CLAUDE.md to prevent gap recurrence
- Future MIG planned to fix phone-only appointment linking

**What Tippy should know:**
> "About 3,500 cats in the system have no person association. This breaks down as: ~1,500 ShelterLuv shelter animals not yet linked to adopters/fosters, ~950 PetLink microchip registry cats never seen at FFSC, ~660 clinic cats whose appointments lack owner contact info, and ~440 clinic cats with no appointment records. This is a known limitation — the system can only auto-link cats when there's owner contact info (email or phone) on the appointment. Cats seen at clinic with no owner info recorded, or ShelterLuv animals not yet processed through the outcomes pipeline, represent the remaining gap."

---

### Session: 2026-02-05 (Part 2) - Beacon Gap Closure (MIG_884-886)

**Context:** After Beacon readiness audit identified 4 gaps, systematic investigation revealed root causes and realistic improvement paths.

**Key Discoveries:**
1. Cat-place gap was mostly caused by `link_cats_to_places()` not being re-run after MIG_877 ShelterLuv address backfill — 4,542 edges were sitting unlinked
2. 2,569 cats have NO `person_cat_relationships` at all — this is the hard ceiling for person→place→cat linking
3. Trapper-appointment linking was fundamentally broken: owner_email ≠ trapper. The correct chain is appointment → place → request → trapper_assignments
4. Only 289 requests exist with 187 having trapper assignments, limiting the request chain approach
5. ShelterLuv mortality (Euthanasia + UnassistedDeathInCustody) was already handled by MIG_874 — not a real gap
6. Geocoding cron IS running (verified in vercel.json), the gap was from permanently failed places not being retried

**Changes Made:**
- MIG_884: ClinicHQ owner address backfill (105 person_place links) + requester role expansion in `link_cats_to_places()` (1,951 edges) + re-run (4,542 edges from backlog)
- MIG_885: Re-queued 86 failed geocoding places, increased max_attempts 5→10, 1,167 places now in queue
- MIG_886: Added `request_id` to `sot_appointments`, created `link_appointments_to_requests()`, updated `link_appointments_to_trappers()` with two-pass (request chain + email/phone), 1,348 appointments linked to requests, 972 got trappers
- Mortality cron limit 50→200
- Person aliases API committed (from other session)

**Staff Impact:**
- Cat-place coverage 91.7% → 92.9% — more cats visible at their correct locations
- Trapper credit now flows from request assignments to clinic appointments (5.3% linked)
- Geocoding queue will process 1,167 places over next hours
- Person aliases: GET returns aliases, name changes auto-create aliases, CRUD endpoint available

---

### Session: 2026-02-05 - Data Quality Filtering + Beacon Readiness Audit

**Context:** After MIG_881 phone COALESCE fix, staff wanted map, search, and data cleaned for Beacon. User confirmed trapper-phone-sharing is a known legacy pattern (trappers gave cell phones for elderly colony owners).

**Key Discoveries:**
1. `v_map_atlas_pins`, `search_unified()`, and volunteers layer had NO data_quality filter — 717 garbage/needs_review people appeared on map and in search
2. Ingest pipeline is completely independent of display surfaces (confirmed safe)
3. Beacon readiness audit showed solid foundation: 91.7% cat-place coverage, 97.9% appointment-person linking, 91.3% geocoding, 98 euthanasia events tracked, 2,178 test results, 93 places with disease flags

**Beacon Readiness Snapshot (2026-02-05):**
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Cat-place coverage | 91.7% | 95%+ | Warning |
| Appointment-person linking | 97.9% | 95%+ | Good |
| Geocoding coverage | 91.3% | 95%+ | Warning |
| Disease-flagged places | 93 | N/A | Baseline |
| Mortality events | 138 (98 euthanasia) | N/A | Baseline |
| Test results | 2,178 | N/A | Baseline |
| Colony sites | 1,676 | N/A | Baseline |
| Colony estimates | 2,995 places | N/A | Baseline |
| Intake events | 3,707 | N/A | Baseline |
| Map pin distribution | 8,380 active, 2,218 minimal, 1,877 historical | N/A | Healthy |

**Changes Made:**
- MIG_882: Added data_quality filter to `v_map_atlas_pins`, `search_unified()`, volunteers layer
- MIG_883: Created `v_shared_phone_candidates` monitoring view, seeded soft blacklist
- Created `/admin/data-quality/review` page for staff to resolve flagged records
- Documented trapper-phone-sharing as known data pattern

**Critical Gaps — Updated after deep investigation (2026-02-04):**

**Cat-place coverage at 92.9%** (was 91.7%) — 3,536 cats have no person_cat_relationships:
| Category | Count | Actionable? |
|----------|-------|-------------|
| ShelterLuv-only (unprocessed outcomes) | 1,461 | Yes — run `process_shelterluv_outcomes()` |
| PetLink registry (external data) | 956 | No — expected, never seen at FFSC |
| ClinicHQ appointments, no contact info | 351 | No — no identifiers available |
| ClinicHQ appointments, email exists | 205 | Yes — re-run entity linking |
| ClinicHQ appointments, phone only | 106 | Yes — future MIG to fix phone-only bug |
| ClinicHQ, no appointments | 439 | Partial — requires microchip matching |
| Both/other | 58 | Mixed |

**Geocoding at 92.9%** (was 92.2%) — 62 more geocoded since MIG_885. ~1,100 still in queue, cron processing.

**Trapper-appointment linking at 5.3%** (was 3.2%) — Structural ceiling from data sparsity:
- Only 289 requests exist (187 with trapper assignments)
- 24 requests assigned to "Client Trapping" (requester self-trapped) — no person to link
- 69 genuinely never had trappers assigned in Airtable
- Grows organically as more requests created via Atlas UI

**Known pipeline bugs:**
1. `link_appointments_to_owners()` (MIG_862) skips phone-only appointments — `WHERE a.owner_email IS NOT NULL` excludes 106+ cats
2. ShelterLuv adoption/foster events partially unprocessed — 1,616 adoptions + 1,732 fosters pending
- **Mortality cron now processes 200/run** (was 50). ShelterLuv mortality already handled by MIG_874.

**What Tippy should know:**
> "Beacon readiness improved: cat-place coverage at 92.9% (2,569 cats have no person link — this is the ceiling). Geocoding at 92.2% with 1,167 places in queue being processed. Trapper-appointment linking improved to 5.3% — limited by only 289 requests in the system. Mortality tracking is comprehensive with clinic + ShelterLuv sources. Person-linking (97.9%) and disease tracking (2,178 tests, 93 places) remain solid."

**Staff Impact:**
- Search now only shows real people (no garbage/phantom records)
- Map pins no longer show bad-quality people in popups
- Staff can review and resolve flagged records at `/admin/data-quality/review`
- Trapper credit now flows through request assignments to clinic appointments

---

### Session: 2026-02-04 - Phone COALESCE Cross-Linking Investigation & Fix

**Context:** Staff reported Gordon Maxwell (20+ cats in ClinicHQ) showing 0 cats in Atlas, with 8 phantom "Gordon" first-name-only records appearing in map search.

**Key Discoveries:**
1. `process_clinichq_owner_info(integer)` (MIG_573) preferred Owner Cell Phone over Owner Phone via COALESCE — cell phones are shared in households, causing identity cross-linking
2. 30+ affected clients across 1,386 appointments linked to wrong person
3. The `(uuid, integer)` overload (unified pipeline) already used correct logic — only the legacy `(integer)` overload had the bug
4. 177 `@petlink.tmp` fabricated emails existed in person_identifiers from an older migration
5. 579 first-name-only web_app people records with `data_quality='normal'` needed flagging
6. MIG_152's cell-phone-first priority was correct for observation extraction but wrong for identity matching — the pattern leaked into MIG_573

**Changes Made:**
- MIG_881: Fixed COALESCE phone order, re-linked 1,386 appointments, cleaned 7,616 orphaned PCR, created 880 correct PCR, merged 8 phantom Gordons, removed 176 @petlink.tmp emails, flagged 575 needs_review records
- CLAUDE.md: Added System Invariant #12 (phone COALESCE order) and Don't Do rule
- New North Star invariant: "Phone COALESCE Must Prefer Owner Phone Over Cell Phone"

**Staff Impact:**
- ~143 people now show correct cat ownership
- Gordon Maxwell restored: 44 appointments, 26 cats
- Susan Simons corrected: 82 → 38 appointments (only her own)
- Map search no longer shows phantom first-name-only entries for Gordon

---

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

### Session: 2026-02-04 - Source System Authority Map + ShelterLuv Completeness

**Context:** After MIG_874/874b fixed ShelterLuv outcome processing, user clarified the authority model: VolunteerHub owns volunteer PEOPLE, ShelterLuv owns program ANIMALS and outcomes, ClinicHQ owns clinic data. "Show me fosters" means VH people, "show me foster cats" means SL outcomes. Multiple data gaps were identified: stale events sync, missing addresses for 4,960 SL people, low place context counts, and 4,179 unprocessed intake events.

**Key Discoveries:**
1. VolunteerHub IS already integrated (MIG_350, MIG_809, MIG_810+) but no authority mapping existed
2. `orchestrator_sources` table existed but lacked authority domain information
3. Events sync appeared "very_stale" because `last_sync_timestamp` freezes when API returns 0 new records
4. `process_shelterluv_person()` had used `'Street Address'` instead of `'Street Address 1'` — fixed in 874b but never re-run on 9,123 already-processed people
5. 4,179 intake events were silently marked "processed" by the outcome processor without action
6. ShelterLuv intake types include: FeralWildlife (1,858), FosterReturn (1,779), Transfer (208), Stray (82), OwnerSurrender (62+)

**Changes Made:**
- MIG_875: Source System Authority Map (orchestrator_sources.authority_domains, source_semantic_queries table, v_source_authority_map view)
- MIG_876: Fix events sync (reset timestamp, add last_check_at for accurate health)
- MIG_877: Backfill ~4,960 SL people addresses into person_place_relationships
- MIG_878: Backfill place contexts for outcome relationships (adopter_residence, foster_home, relocation_destination, colony_site)
- MIG_879: cat_intake_events table + process_shelterluv_intake_events() function, processed 4,179 events
- MIG_880: Registered 3 new views in Tippy catalog
- Updated CLAUDE.md with authority map and semantic query rules
- Updated cron route to process intake events separately from outcomes

**Staff Impact:**
- Tippy correctly routes "fosters" to VolunteerHub people and "foster cats" to ShelterLuv
- More places visible on map (adopter residences, foster homes, relo destinations)
- Cat intake history now queryable
- Events sync health monitoring more accurate

---

### Session: 2026-02-05 - ClinicHQ Pipeline Parity, Org Identity Resolution, Cat-Place Fix

**Context:** Investigation into wrong caretaker assignments and cat-place pollution. Cat 981020053817972 showed Jeanie Garcia as caretaker but should be Carlos Lopez. Cat 981020053837292 linked to 4 wrong places. Silveira Ranch address missing house number "5403". User reported cats at Old Stony Point Rd showing at Silver Spur instead.

**Key Discoveries:**
1. **TS Upload Route Diverged from SQL Processor** — The TypeScript UI upload route (`/api/ingest/process/[id]/route.ts`) never got the `should_be_person()` guard from MIG_573. Pseudo-profiles like "5403 San Antonio Road Petaluma" were being created as people via `find_or_create_person()` instead of routed to `clinic_owner_accounts`.
2. **Email Soft Blacklist Never Checked** — `data_engine_score_candidates()` checked `data_engine_soft_blacklist` for phones (reducing score to 0.5) but NOT for emails. Org email `marinferals@yahoo.com` (Marin Friends of Ferals) auto-matched at full score, causing Carlos Lopez's cats to be linked to Jeanie Garcia.
3. **Shared Identifier Orphan Pattern** — Carlos Lopez had 13 duplicate records with ZERO `person_identifiers` entries. When `find_or_create_person()` encounters a taken email/phone, the new person silently gets no identifiers (INSERT conflicts). This makes them invisible to future dedup.
4. **`link_cats_to_places()` Linked to ALL Person Places** — Created cat-place edges to every historical address a person had. 92.3% of appointments have `inferred_place_id` but it wasn't used.
5. **ClinicHQ XLSX Stores Address in Name Field** — For Silveira Ranch, "5403 San Antonio Road Petaluma" was in `Owner First Name`, not `Owner Address`. The `Owner Address` field only had "San Antonio Rd, Petaluma, CA 94952" without house number.
6. **Marin Friends of Ferals** — An outside TNR organization. Email `marinferals@yahoo.com` and phone `7074799459` are shared org identifiers used by both Jeanie Garcia and Carlos Lopez.

**Changes Made:**
- MIG_888: Added email soft blacklist check to `data_engine_score_candidates()` (parity with phone). Updated `process_clinichq_owner_info()` Step 6 with soft blacklist filter. Added `marinferals@yahoo.com` to soft blacklist. Added Marin Friends of Ferals to `known_organizations`.
- MIG_889: New `link_cats_to_appointment_places()` function using `inferred_place_id`. Updated `link_cats_to_places()` with LIMIT 1 per person (best confidence/recency).
- MIG_890: Merged Carlos Lopez (13→1) and Jeanie Garcia (4→1) duplicates. Fixed cat 981020053817972 caretaker. Fixed cat 981020053837292 place links. Merged duplicate 6930 Commerce Blvd places. Fixed Silveira Ranch address to 5403 San Antonio Rd.
- TS upload route: Added `should_be_person()` guard, clinic_owner_accounts routing, soft blacklist filter in appointment linking, pseudo-profile account linking.
- CLAUDE.md: Added INV-22 through INV-26 covering pipeline parity, org emails, orphan duplicates, pseudo-profiles, soft blacklist respect.

**Staff Impact:**
- Cat caretaker assignments now reflect actual owners (Carlos Lopez, not Jeanie Garcia)
- Cats show correct colony sites (e.g., 6930 Commerce Blvd, not random addresses)
- Re-uploading ClinicHQ exports properly handles pseudo-profiles and shared org emails
- Silveira Ranch place now shows correct address with house number

---

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

---

### Session: 2026-02-01 — Volunteer Role Data Quality + Test Infrastructure

**Context:** Staff noticed "Holiday Duncan" at 2411 Alexander Valley Rd, Healdsburg showing as both "Foster" and "Trapper" on the Beacon map, despite being a ClinicHQ clinic client (not an FFSC volunteer). Also "Wildhaven Campgrounds" appeared as a person name.

**Key Discoveries:**
1. **Map pin role badges come from `person_roles` table**, NOT `person_place_relationships`. The `v_map_atlas_pins` view (MIG_822) runs a correlated subquery: `SELECT ARRAY_AGG(DISTINCT pr.role) FROM person_roles WHERE role_status = 'active'`.
2. **ClinicHQ processing does NOT assign volunteer roles** — `process_clinichq_owner_info()` creates people and links them to places but never calls `assign_person_role()`.
3. **Three pathways can incorrectly assign roles:**
   - **ShelterLuv name matching** (HIGH RISK): `process_shelterluv_animal()` uses `ILIKE '%name%'` substring matching to assign foster roles — no email/phone verification required.
   - **VolunteerHub Data Engine matching** (MODERATE): Phone/name collision can merge a ClinicHQ person with a VH volunteer, inheriting their group roles.
   - **Airtable trapper sync** (MODERATE): Phone collision between trapper and clinic client.
4. **Business rule: All fosters and trappers are FFSC Volunteers first.** In VolunteerHub: Approved Volunteers → subgroups (Approved Trappers, Approved Foster Parent). A person should not have foster/trapper without also having volunteer.
5. **"Wildhaven Campgrounds"** — `is_organization_name()` didn't include campground/RV patterns. MIG_827 adds them.

**Changes Made:**
- **MIG_827**: Expanded `is_organization_name()` with campground/RV/lodging patterns, flagged affected people as `is_system_account = TRUE`
- **Test Suite Working Ledger**: Created `docs/TEST_SUITE_WORKING_LEDGER.md` — tracks data quality investigations, diagnostic SQL, and test coverage
- **Data Quality Guard Tests**: Created `e2e/data-quality-guards.spec.ts` — 10 tests covering org name filtering, role consistency, person/place data integrity, map pin validation

**Staff Impact:**
- After MIG_827: "Wildhaven Campgrounds" will no longer appear as a person name on map pins
- Diagnostic SQL in the working ledger can identify other people with incorrect foster/trapper roles
- The broader role consistency fix (requiring volunteer before foster/trapper) needs further review before implementation

**What Tippy should know:**
> "If staff notice someone showing as Foster or Trapper on the map who shouldn't be, this is a known data quality issue where the identity matching system can sometimes merge records from different sources (ClinicHQ clinic clients with VolunteerHub volunteers). The source_system column on person_roles tracks which pipeline assigned the role. Organization names like campground/winery/lodge names sometimes appear as person names — MIG_827 expanded the detection patterns to catch these."

### Session: 2026-02-01 — Map Badge Integrity: Eliminating False Positives & Negatives

**Context:** Follow-up to the Holiday Duncan investigation. Deep-dive into all systemic causes of incorrect map pin badges, plus creation of automated tooling to prevent recurrence.

**Key Discoveries:**
1. **No automated role deactivation existed.** When VH volunteers left ALL groups, `volunteerhub_group_memberships.left_at` was set but `person_roles.role_status` stayed `'active'` forever — stale badges persisted indefinitely.
2. **ShelterLuv provides `Foster Person Email`** but `process_shelterluv_animal()` (MIG_469/621) never used it — relied on name-only `ILIKE '%name%'` matching instead.
3. **MIG_511 already had correct email-first matching** for foster relationships but did NOT assign person_roles — only created person_cat_relationships.
4. **Business rule enforcement gap:** No code path validated "foster/trapper requires volunteer" before role assignment.

**Changes Made:**
- **MIG_828**: Replaced `process_shelterluv_animal()` name-only foster matching with email-first via `person_identifiers`. Unmatched fosters queued in `shelterluv_unmatched_fosters` for staff review.
- **MIG_829**: Created `deactivate_orphaned_vh_roles()` function (30-day grace period), `role_reconciliation_log` table, and reconciliation views: `v_stale_volunteer_roles`, `v_role_without_volunteer`, `v_role_source_conflicts`.
- **MIG_831**: Retroactive data cleanup — deactivated ShelterLuv name-only foster roles, orphaned VH roles, and Holiday Duncan's incorrect badges.
- **PATCH /api/people/[id]/roles**: Staff can now deactivate/activate roles with audit trail.
- **GET /api/admin/role-audit**: Dashboard API with stale roles, missing volunteer, source conflicts, unmatched fosters, and reconciliation log.
- **`/admin/role-audit` page**: Full admin dashboard for monitoring and resolving role integrity issues.
- **`e2e/role-lifecycle.spec.ts`**: 10 tests covering map badge accuracy, role audit API, person role data integrity, and Holiday Duncan regression guard.
- **Updated `e2e/data-quality-guards.spec.ts`**: Tightened foster/trapper-without-volunteer threshold from ≤5 to 0.

**Staff Impact:**
- Holiday Duncan no longer shows Foster/Trapper badges on the map (after MIG_831)
- Wildhaven Campgrounds no longer shows as a person (after MIG_827)
- Staff can view and resolve role issues at `/admin/role-audit`
- Automated deactivation runs during VH sync — stale badges clear within 30 days of departure
- ShelterLuv foster matching now requires email verification — no more name-guessing

**What Tippy should know:**
> "The map badge system has been significantly hardened. If staff notice stale badges, the `/admin/role-audit` page shows all role integrity issues and allows one-click deactivation. ShelterLuv foster assignments now require email verification — name-only matches are queued for manual review. VH volunteer roles are automatically deactivated 30 days after leaving all approved groups."

### Session: 2026-02-02 — Ingest Pipeline Silent Failures (INGEST_001)

**Context:** Staff uploaded a ClinicHQ owner_info export via `/admin/ingest`. It stayed stuck on "pending" and never completed. Comprehensive audit of the data ingestion pipeline uncovered 6 bugs.

**Key Discoveries:**
1. **Missing `maxDuration`** on the process endpoint — Vercel killed the lambda at 10-15s default, but owner_info post-processing calls `find_or_create_person()` for hundreds of owners (~30-60s).
2. **CSV parser used `line.split(',')`** — breaks on addresses containing commas in quoted fields (e.g., `"123 Main St, Apt 4, Petaluma, CA"`).
3. **Post-processing queried ALL staged records** — not scoped to the current upload. Re-uploading any data re-processed ALL historical records, causing exponential slowdown.
4. **Stuck status on lambda kill** — If Vercel killed the lambda mid-processing, the catch block never ran. Status stayed `'processing'` forever.
5. **No progress feedback** — Single blocking `await` in the UI with no polling. 60s+ processing looked identical to a hang.
6. **`alert()` for errors** — Processing errors shown via dismissible browser alert, losing all context.

**Changes Made:**
- Added `export const maxDuration = 120` to the process endpoint
- Unified CSV + XLSX parsing through the XLSX library (handles RFC 4180 quoted fields)
- Scoped all 9 staged_records queries in post-processing to `file_upload_id` of the current upload
- Added `saveProgress()` calls between all 21 processing steps (writes intermediate results to DB)
- Built fire-and-forget processing with 2-second polling and floating progress overlay
- Added stuck-job auto-reset in the cron (>5 minutes = auto-fail)
- Replaced all `alert()` with inline error display

**Staff Impact:**
- Data uploads via `/admin/ingest` now show real-time step-by-step progress
- Uploads are resilient to serverless timeouts — progress is saved per step
- Stuck uploads are automatically recovered by the cron job
- CSV files with commas in addresses parse correctly
- Error messages are shown inline with full detail

**What Tippy should know:**
> "The data ingest pipeline at `/admin/ingest` has been fixed. If staff upload ClinicHQ data and see the progress overlay, that's the new real-time processing view. Each step (creating people, places, linking) reports results as it completes. If an upload gets stuck, the system automatically resets it after 5 minutes so it can be retried. CSV files with commas in addresses are now handled correctly."

### Session: 2026-02-02 — Post-Deployment Ingest Fix (INGEST_001 Round 2)

**Context:** After deploying the initial pipeline fix, user uploaded cat_info (success), owner_info (success but 0 new people), and appointment_info (FAILED with constraint violation). Three additional issues investigated.

**Key Discoveries:**
1. **Staging dedup constraint violation** — The pre-check query used `(source_row_id = $3 OR row_hash = $4)` which could match TWO different records. If Record A matched by source_row_id with a different hash, the UPDATE to set A's hash could conflict with Record B that already had that hash. This is a TOCTOU (time-of-check-time-of-use) race condition in the dedup logic.
2. **"Uploaded: undefined" in success message** — Upload API returned `stored_filename` but not `original_filename`. The UI referenced the wrong field.
3. **0 new people from owner_info** — NOT a bug. All owners in the upload already existed in `sot_people` (matched by email/phone). The metric `people_created_or_matched` counts both new and matched people. Since the user exported with date overlap covering existing records, all matches are expected.

**Changes Made:**
- Rewrote staging dedup to use sequential two-step check: first by hash (skip if found), then by source_row_id (safe to update since hash is unique)
- Added `original_filename` to upload API response
- Verified all three upload types are independent (no ordering dependency)

**Staff Impact:**
- Appointment_info uploads that previously failed with constraint errors will now succeed
- Upload success message shows the actual filename
- All three ClinicHQ exports (cat_info, owner_info, appointment_info) can be uploaded in any order

**What Tippy should know:**
> "A bug that caused appointment_info uploads to fail has been fixed. The error 'duplicate key value violates unique constraint staged_records_idempotency_key' no longer occurs. Staff can upload cat_info, owner_info, and appointment_info in any order — they are all independent. If owner_info shows 0 new people, that means all owners already existed in the system (matched by email or phone). This is normal when re-uploading data that overlaps with previous uploads."

### Session: 2026-02-03 — Cat Card Edit/Display Fixes

**Context:** Cat detail page showed "Sex: Unknown" for cats with known sex from ClinicHQ, "Failed to update cat" on any edit, and altered status showed "Unknown" for spayed/neutered cats (95% of records).

**Key Discoveries:**
1. **PATCH API used wrong column names** — Referenced `name`, `is_eartipped`, `color_pattern` which don't exist in `sot_cats`. Correct columns: `display_name`, `altered_status`, `primary_color`. Also cast to `::trapper.cat_sex` enum that doesn't exist (column is plain text).
2. **Sex case mismatch** — DB stores "Male"/"Female" (capitalized from ClinicHQ), edit dropdown uses "male"/"female" (lowercase). Dropdown couldn't match → showed "Unknown" even for cats with known sex.
3. **Altered status logic checked only "Yes"** — DB values: `spayed` (17,276), `neutered` (15,538), `Yes` (1,370), `No` (326), `intact` (259). Old code only matched `=== "Yes"`, missing 95% of altered cats.
4. **Edit form read wrong field for color** — Used `cat.coat_pattern` (always NULL from `v_cat_detail`) instead of `cat.color` (mapped from `primary_color`).

**Changes Made:**
- Fixed PATCH API to use correct column names (`display_name`, `altered_status`, `primary_color`)
- Removed nonexistent `::trapper.cat_sex` enum cast
- Normalized sex to lowercase on form init so dropdown pre-selects correctly
- Fixed altered status to recognize "spayed", "neutered", and "Yes" as altered
- Read mode now shows "Yes — Spayed" / "Yes — Neutered" for specific status
- Added breed field to edit form and PATCH API
- Fixed color to read from `cat.color` (maps from `primary_color`)

**Staff Impact:**
- Cat detail cards now correctly show sex ("Male"/"Female") from clinic data
- Edit form pre-selects the correct sex value
- Altered status shows correctly for 95% of cats that were previously showing "Unknown"
- Editing a cat name or any field now saves successfully
- Breed and color can be edited from the cat card

**What Tippy should know:**
> "Cat detail pages now correctly display sex and altered status from clinic data. Previously, cats showed 'Sex: Unknown' due to a case mismatch between the database and the dropdown. If staff see a cat with correct sex/color/breed data, that data comes from ClinicHQ clinic records. The edit form now pre-selects the correct values. Altered status shows 'Yes — Spayed' or 'Yes — Neutered' based on the specific procedure recorded."

### Session: 2026-02-03 — DQ_002: Map Cat Count Audit + Identifier Cleanup

**Context:** Map showed some places with 1000+ cats. Investigation revealed merged cats were being counted in `cat_place_relationships` queries throughout the map data pipeline. Also discovered cats accumulating 10+ identifiers from format detection guesses and un-transferred merged cat identifiers.

**Key Discoveries:**
1. **Merged cats inflating map counts** — `v_map_atlas_pins` and all `map-data/route.ts` queries counted `cat_place_relationships` without filtering `merged_into_cat_id IS NULL`. Post-merge, the old cat's place links remained as orphans.
2. **Duplicate cat-place links** — Same cat at same place appeared via different `source_table` values (e.g., `appointment_info` + `entity_linking`), doubling the count.
3. **Identifier accumulation** — Multi-format microchip detection (MIG_553) created separate rows for truncated/AVID/10-digit interpretations. Merged cats' identifiers never transferred to canonical cat.

**Changes Made:**
- MIG_868: Audit + fix for high-count places (removes merged cat links, deduplicates, cleans residual pollution)
- MIG_869: Audit + fix for excessive identifiers (re-points merged cat IDs, removes junk/low-confidence entries)
- map-data/route.ts: All 4 cat count subqueries + summary stat now filter merged cats
- v_map_atlas_pins (MIG_820): Cat count subquery updated

**Staff Impact:**
- Map place pins will show accurate cat counts after running MIG_868
- Cats with excessive identifiers will be cleaned after running MIG_869
- No workflow changes needed — this is purely a display/data accuracy fix

### Session: 2026-02-05 — DQ_003: Legacy Person/Place Data Cleanup

**Context:** Audit revealed significant data quality issues in people and places tables: organizations stored as people (37 "Cast Kay Tee Inc" duplicates), addresses stored as people ("890 Rockwell Rd." with 51 cat links), first-name-only duplicates (14 "Maria" records), and place display_names that are person names.

**Key Discoveries:**
1. **All duplicates created before Jan 25, 2026** — The Data Engine (MIG_314-317) was implemented correctly but these records predate it. No new duplicates have been created since.
2. **`should_be_person()` works but wasn't used historically** — Tests confirmed the function correctly classifies "Cast Kay Tee Inc Cast Kay Tee Inc" as organization, "Sonoma County Landfill Petaluma" as address. But older ingest paths didn't call it.
3. **Zero-identifier duplicates = orphan pattern from INV-24** — All 37 "Cast Kay Tee Inc" records have zero person_identifiers. ClinicHQ sends owner data with no email/phone, creating new person each appointment.
4. **Current pipeline is correct** — TS upload route (Step 1) uses `should_be_person()`. Data Engine rejects no-identifier cases. `clinic_owner_accounts` receives pseudo-profiles.
5. **Place display_names from file_upload/legacy_import** — Person names ("Samantha Tresch", "Karen Brisebois") stored as place display_name. ShelterLuv "X residence" pattern is intentional.
6. **Doubled place names** — "Comstock Middle School Comstock Middle School" from data entry errors in file_upload.

**Changes Made:**
- MIG_895: Comprehensive cleanup migration
  - Phase 1: Merge duplicate people with same name + no identifiers
  - Phase 2: Mark organizations as `is_organization = true`
  - Phase 3: Route pseudo-profiles to `clinic_owner_accounts`
  - Phase 4: Merge "Unknown" and "SCAS" duplicates
  - Phase 5: Clear person-name display_names from places
  - Phase 6: Fix doubled place names
- CLAUDE.md: Added INV-29 (Data Engine rejects no-identifier), INV-30 (legacy cleanup required), INV-31 (OK if cats have no person link)
- Don't Do section: Added guidance on single-word names, forcing cat-person matches

**Staff Impact:**
- Fewer duplicate people in search results
- Organizations properly marked as `is_organization = true`
- Place searches return cleaner results (no person names as place names)
- No action needed — the current ingest pipeline is working correctly

**What Tippy should know:**
> "A data audit found legacy issues from before January 2026: organizations and addresses were sometimes stored as people, and duplicate records existed for entities with no email/phone. MIG_895 cleaned up these historical issues. The current ingest pipeline is working correctly — it uses `should_be_person()` to filter pseudo-profiles and the Data Engine to prevent identifier-less duplicates. If you see duplicate people with the same name but no contact info, they're likely legacy records that can be safely merged."

### Session: 2026-02-05 — DQ_004: Historical Org-Contact Data Pattern (Marin Friends of Ferals)

**Context:** Investigation of Carlos Lopez search showing confusing results: "Carlos Lopez Dental" ShelterLuv records, only 1 cat linked despite many at Hicks Valley address, cats linked to Jeanie Garcia instead.

**Key Pattern Discovered: "Org Contact Proxy"**

Until 2024, FFSC data practices were informal. When ClinicHQ was the primary data source, staff would:
1. Book appointments under the **resident's name** (e.g., "Jeanie Garcia")
2. Use **partner org contact info** for pickup calls (e.g., marinferals@yahoo.com, 415-246-9162)
3. This created false identity links: resident name → org phone/email

This pattern was common throughout FFSC operations until Atlas was implemented in late 2024/early 2025.

**Specific Case: Marin Friends of Ferals**
- **Janet Williams** is the actual org contact (415-246-9162, marinferals@yahoo.com)
- **Jeanie Garcia** is a Hicks Valley resident who called for TNR
- All Jeanie's appointments used Janet's org email → 20+ cats linked to Jeanie via the org email
- **Carlos Lopez** lives at same address (1052 Hicks Valley Rd), has NO identifiers in system
- Carlos's cats are linked to Jeanie Garcia because of the shared org email

**ShelterLuv Medical Holds Pattern**
- When FFSC holds a cat for medical reasons, they create ShelterLuv records
- "Carlos Lopez Dental" = Jupiter the cat held for dental work, owner is Carlos
- These create "owner" records in ShelterLuv that look like business names

**Data Issues Found:**
| Issue | Root Cause | Fix |
|-------|------------|-----|
| Carlos Lopez has 0 identifiers | ShelterLuv record had no contact info | Seed with actual phone |
| 20+ cats linked to Jeanie Garcia | marinferals@yahoo.com used for her in 2020 | Already soft-blacklisted, but cats remain linked |
| 6 Jupiter cat records | ShelterLuv + ClinicHQ duplicates | Merge to canonical |
| 3 Hicks Valley places | Variant addresses from different sources | Merge to 1052 Hicks Valley Rd |

**Invariant Discovered:**
> **INV-32: Pre-2024 Person-Cat Links Are Suspect.** ClinicHQ data before 2024 often used partner org emails (marinferals@yahoo.com, etc.) instead of actual resident contact info. The `person_cat_relationships` from this era may link cats to the wrong person. Org emails must be in `data_engine_soft_blacklist`. For accurate cat counts, use **place views** rather than person-cat links. Historical relationships won't be retroactively fixed — the place is the source of truth for "cats at this location".

**What Tippy should know:**
> "Jeanie Garcia shows 20+ cats because of a historical data pattern. Until 2024, FFSC used partner organization contact info (Marin Friends of Ferals: marinferals@yahoo.com) for appointment bookings even when the actual resident was different. The cats at 1052 Hicks Valley Rd are actually Carlos Lopez's, but they're linked to Jeanie Garcia because her appointments used the org email. This pattern is now prevented by the soft-blacklist system, but historical links remain. Staff should use the place view (Hicks Valley Rd) to see all cats at the location rather than relying on person-cat links."

**Related Contacts:**
- Janet Williams: Marin Friends of Ferals, 415-246-9162, marinferals@yahoo.com (TNR partner org)
- Jeanie Garcia: Resident at 14485 Valley Ford Rd, Valley Ford (called for TNR, used org email)
- Carlos Lopez: Resident at 1052 Hicks Valley Rd, Petaluma (actual cat owner)

---

### Session: 2026-02-05 — DQ_005: Email Coverage Audit Correction

**Context:** While planning the address+name candidate finding feature, the initial audit showed "100% email coverage" on ClinicHQ data 2013-2025. This was suspicious and required deeper investigation.

**Finding: The "100% Coverage" Was FALSE**

The audit counted `owner_email IS NOT NULL` as "has email". But ClinicHQ exports store empty values as empty strings (`''`), not NULL. Deep audit revealed:

| Email Type | Count | Percentage |
|------------|-------|------------|
| Valid email (has @) | 36,189 | **75.8%** |
| Empty string (`''`) | 11,314 | 23.7% |
| Literal 'none' | 100 | 0.2% |
| NULL | 22 | 0.04% |
| Invalid format | 51 | 0.1% |

**Corrected Coverage by Era:**
| Era | Real Email | Phone | Notes |
|-----|------------|-------|-------|
| 2013-2015 | 71-73% | 86-90% | 27-29% empty strings |
| 2016-2020 | 70-77% | 72-85% | Phone coverage dipped |
| 2021-2024 | 76-83% | 69-77% | Improving |
| 2025+ | **79%** | **81%** | Best coverage era |

**Top Shared/Suspicious Emails Found:**
| Email | Appointments | Notes |
|-------|--------------|-------|
| info@forgottenfelines.com | 3,167 (6.6%) | FFSC staff email - expected, not an error |
| marinferals@yahoo.com | ~100 | Soft-blacklisted org email |
| petestablish.com variants | 49 | Possible ClinicHQ default? |
| juliettest.a@gmail.com | 9 | Test data leak in 2024-2025 |

**Key Insight:** The `info@forgottenfelines.com` email on 3,167 appointments (6.6% of all clinic data) is **NOT an error**. This is the FFSC organizational email used appropriately for:
- Staff-processed appointments
- Fire cat rescue operations
- Foster cats in FFSC care
- Intake records without owner contact

**System Impact:**
- **880 people (6.5%)** have no identifiers in `person_identifiers`
- **11,314 appointments (23.7%)** have empty email strings - these can't link to people via email
- The address+name candidate finding (MIG_896) targets this 6.5% + 23.7%

**What Tippy should know:**
> "Email coverage on ClinicHQ appointments is 76%, not 100%. About 24% of appointments have empty or placeholder email values from the ClinicHQ export. The info@forgottenfelines.com email on 6.6% of appointments is FFSC staff entries, not errors. Phone coverage varies from 70-90% depending on era. When searching for a person who has no identifiers, we now use address+name similarity as a fallback (MIG_896)."

**Migrations:**
- MIG_896: Added address+name candidate finding to Data Engine
- MIG_897: Hicks Valley data cleanup (Carlos Lopez, Jeanie Garcia, Janet Williams)
