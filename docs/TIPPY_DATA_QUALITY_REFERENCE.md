# Tippy Data Quality Reference

**Purpose:** This document provides Tippy with authoritative information to explain data discrepancies to staff when questions arise about missing or unlinked records.

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

## Development Session Log

Brief summaries of development sessions for context on system evolution.

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

*Last updated: 2026-01-21*
