# ClinicHQ Scrape Data Architecture

## Overview

ClinicHQ's API exposes only a subset of the data visible in its web UI. Daniel (beacon engineer) built a scraper that captures the full appointment UI, producing a merged CSV with fields unavailable through the API pipeline.

This document describes the architecture for importing, storing, and surfacing that data.

## What the Scrape Contains

**41,234 rows | 10,403 unique clients | Apr 2015 – Sep 2024**

File location: `data/reference/clinichq_scrape/clinichq_appointments_medical_merged.csv` (gitignored)

```
┌─────────────────────────────────────────────────────────────────┐
│  ClinicHQ Web UI (scraped)                                      │
│                                                                  │
│  Fields NOT in API:                                              │
│  ├─ internal_medical_notes   (6,756 rows, 16.4%)               │
│  ├─ animal_quick_notes       (21,214 rows, 51.4%)              │
│  ├─ animal_appointment_notes (25,975 rows, 63.0%)              │
│  ├─ animal_trapper           (1,870 rows, 150 unique trappers) │
│  ├─ heading_labels_json      (41,234 rows, 27 label types)     │
│  ├─ sterilization_status     (2,488 rows)                       │
│  ├─ animal_caution           (41,213 rows)                      │
│  └─ owner_info_text          (41,213 rows)                      │
│                                                                  │
│  Fields overlapping with API (validation/enrichment):           │
│  ├─ microchip / animal_microchip_info                           │
│  ├─ animal_name / animal_id                                     │
│  ├─ appointment_date / appointment_type / checkout_status       │
│  ├─ owner_display_name / client_id                              │
│  └─ animal_species_sex_breed / animal_colors / animal_weight    │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────────────┐
│  Daniel's Scraper    │
│  (periodic refresh)  │
└──────────┬───────────┘
           │ CSV
           ↓
┌──────────────────────────────────────────────────────────────────┐
│  data/reference/clinichq_scrape/                                 │
│  clinichq_appointments_medical_merged.csv                        │
│  (gitignored, replaced on each scrape)                           │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────────┐
│  IMPORT SCRIPT                                                    │
│  scripts/ingest/clinichq_scrape_import.mjs                       │
│  • Idempotent (keyed on record_id)                               │
│  • Bulk COPY into source.clinichq_scrape                         │
│  • Tracks import timestamp for delta detection                   │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────────┐
│  STAGING TABLE: source.clinichq_scrape                           │
│  • Mirrors CSV columns 1:1                                       │
│  • record_id is PRIMARY KEY (one row per appointment)            │
│  • heading_labels_json stored as JSONB                            │
│  • imported_at timestamp for freshness tracking                  │
└──────────┬───────────────────────────────────────────────────────┘
           │
     ┌─────┴─────────────────┬──────────────────────┐
     ↓                       ↓                      ↓
┌────────────┐     ┌──────────────────┐    ┌────────────────────┐
│ ENRICHMENT │     │ HIDDEN MICROCHIP │    │ TRAPPER ATTRIBUTION│
│ VIEWS      │     │ EXTRACTION       │    │ CROSS-REFERENCE    │
│            │     │                  │    │                    │
│ Join to:   │     │ Regex \d{15} on: │    │ animal_trapper →   │
│ ops.appts  │     │ • quick_notes    │    │ sot.trapper_       │
│ sot.cats   │     │ • appt_notes     │    │ profiles           │
│ ops.clinic │     │ • medical_notes  │    │                    │
│ _accounts  │     │ • animal_name    │    │ 150 unique values  │
└────────────┘     └──────────────────┘    └────────────────────┘
```

## Staging Table Schema

```sql
CREATE TABLE source.clinichq_scrape (
    record_id       TEXT PRIMARY KEY,       -- ClinicHQ appointment record ID
    client_id       TEXT NOT NULL,           -- ClinicHQ client ID
    appointment_date TEXT,                   -- "Apr 01, 2015" format
    appointment_type TEXT,                   -- "Spay Or Neuter", "Wellness", etc.
    checkout_status TEXT,                    -- "Checked Out", "Canceled", "No Show", etc.

    -- Owner/client info
    owner_display_name TEXT,                -- Full display name from UI
    owner_info_text    TEXT,                -- Full owner contact block

    -- Animal identity
    animal_heading_raw TEXT,                -- Raw heading text
    animal_name        TEXT,                -- Parsed animal name
    animal_id          TEXT,                -- ClinicHQ animal Number (23.9% coverage)
    heading_labels_json JSONB,             -- Structured labels array

    -- Animal details
    animal_info_raw         TEXT,
    animal_species_sex_breed TEXT,
    animal_colors           TEXT,
    animal_type             TEXT,
    animal_weight_info      TEXT,
    animal_age              TEXT,
    animal_microchip_info   TEXT,           -- Full microchip string with provider

    -- Unique scrape-only fields
    animal_trapper          TEXT,           -- Trapper name/address (4.5% coverage)
    animal_caution          TEXT,           -- Bite/anxiety warnings
    animal_quick_notes      TEXT,           -- Staff notes (51.4% coverage)
    animal_appointment_notes TEXT,          -- Per-visit notes (63.0% coverage)
    sterilization_status    TEXT,           -- Explicit spay/neuter status

    -- Medical data (API-inaccessible)
    internal_medical_notes  TEXT,           -- Vet clinical observations (16.4%)
    vet_notes               TEXT,           -- (0% in current scrape)

    -- Extracted/normalized
    weight                  TEXT,
    microchip               TEXT,           -- Extracted microchip value

    -- Metadata
    scraped_at_utc TIMESTAMPTZ,
    imported_at    TIMESTAMPTZ DEFAULT NOW()
);
```

## Scrape vs API Export: Important Difference

The scraper captures the **current ClinicHQ UI state**, while the API export captures the **at-appointment-time** snapshot. This means:

- **API export**: Shows client 1 (who booked the appointment at the time)
- **Scrape**: May show client 2 (current owner after an ownership transfer)

For the same `record_id`, the `client_id` and `owner_display_name` in the scrape may differ from the API data if the cat's ownership was transferred after the appointment. **Cat identity (microchip, clinichq_id) is stable** across both sources, but client-based matching should be treated as lower confidence.

This also means the scrape can surface ownership transfers that aren't visible in the API data.

## Cross-Reference Strategy

The scrape data joins to existing Atlas tables via multiple keys:

| Scrape Column | Atlas Table | Join Column | Coverage |
|---|---|---|---|
| `record_id` | `ops.appointments` | `source_record_id` | Best match |
| `client_id` | `ops.clinic_accounts` | `clinichq_client_id` | Ground truth for accounts |
| `extracted_clinichq_id` | `sot.cat_identifiers` | `id_value` WHERE `id_type = 'clinichq_animal_id'` | 49.7% (20,480 rows) |
| `animal_id` | `sot.cat_identifiers` | `id_value` WHERE `id_type = 'clinichq_animal_id'` | 23.9% (mostly microchips/names) |
| `microchip` | `sot.cat_identifiers` | `id_value` WHERE `id_type = 'microchip'` | ~61.8% |
| `appointment_date` | `ops.appointments` | `appointment_date` | Fuzzy match fallback |

## Heading Labels — Structured Tags

The `heading_labels_json` field contains an array of UI labels. There are 27 unique values:

**Appointment type:** `Spay Or Neuter`, `Wellness`, `Recheck`
**Status:** `Checked Out`, `Canceled`, `No Show`, `Pending`, `In Progress`
**Alteration:** `Spay/Neutered`, `Not Spay/Neutered`, `Spay/Neutered : Unknown`, `Spay/Neutered : Not Asked`

**Deceased (15 variants with timing + cause):**
```
Pre-operative:
  ├─ Euthanized per owner request (24)
  ├─ Pre-Existing Condition (43)
  ├─ Stress-exacerbated Disease (1)
  ├─ Surgical Complication (1)
  └─ Undetermined (9)

Intra-operative:
  ├─ Euthanized per owner request (20)
  ├─ Pre-Existing Condition (1)
  └─ Undetermined (63)

Post-operative:
  ├─ Anesthetic Reaction (1)
  ├─ Euthanized per owner request (21)
  ├─ Hemorrhage (5)
  ├─ Pre-Existing Condition (9)
  ├─ Surgical Complication (2)
  └─ Undetermined (18)

Unspecified: Deceased: () (204)
```

Total: 413 records with cause-of-death data. Currently Atlas only tracks `mortality_type = natural|euthanasia` — these labels provide timing (pre/intra/post-operative) and specific cause.

## Hidden Microchip Locations

Microchips (15-digit `\d{15}` pattern) are embedded in free-text fields:

| Field | Rows with chips | Notes |
|---|---|---|
| `animal_quick_notes` | 236 | Many on cats with `microchip = ---` |
| `animal_appointment_notes` | 13 | Cross-reference with structured col |
| `animal_name` | 10 | Recheck pattern (already partially handled) |
| `internal_medical_notes` | 7 | Some records have 2 chips (dual-scan) |
| `animal_microchip_info` | 3 | Info field populated but structured col empty |

**Total: ~269 potential hidden microchips.** Many correspond to cats currently without microchip records in `sot.cat_identifiers`.

## Use Cases

### 1. Clinic Accounts Ground Truth
10,403 unique `client_id` values with `owner_display_name` and `owner_info_text`. Cross-reference with `ops.clinic_accounts` to validate and fill gaps in account classification.

### 2. Internal ClinicHQ Mirror
When API data is incomplete or ambiguous, the scrape provides a reference copy of what the ClinicHQ UI actually shows. Useful for debugging data pipeline issues.

### 3. Cat Profile Enrichment
Surface on cat detail page:
- **Medical notes** — Vet observations per appointment
- **Quick notes** — Staff context about the animal
- **Caution flags** — Bite/anxiety warnings as badges
- **Cause of death** — Detailed mortality classification

### 4. Trapper Attribution
1,870 appointments with explicit `animal_trapper` field. Values include:
- Addresses (trapping locations)
- Microchips (trapper identified by chip?)
- Names (cross-reference with `sot.trapper_profiles`)

### 5. Hidden Microchip Recovery
Extract ~269 microchips from notes fields and register in `sot.cat_identifiers` for cats currently showing `microchip = ---`.

## Refresh Process

1. Daniel runs scraper → produces new CSV
2. Replace `data/reference/clinichq_scrape/clinichq_appointments_medical_merged.csv`
3. Run import script: `node scripts/ingest/clinichq_scrape_import.mjs`
4. Script upserts into `source.clinichq_scrape` (ON CONFLICT UPDATE)
5. Run enrichment/extraction pipelines as needed

## Related Issues

| Issue | Description |
|---|---|
| FFS-356 | Import scraped data into `source.clinichq_scrape` |
| FFS-357 | Extract hidden microchips from notes fields |
| FFS-358 | Surface lifecycle status badges in UI |
| FFS-359 | Surface medical notes and cause-of-death on cat profiles |
