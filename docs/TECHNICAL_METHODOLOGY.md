# Atlas Technical Methodology

This document provides a comprehensive explanation of how Atlas calculates population estimates, tracks TNR progress, and manages data integrity. It is intended for researchers, auditors, and collaborators who need to understand the underlying methodology.

## Table of Contents

1. [System Overview](#system-overview)
2. [Data Architecture](#data-architecture)
3. [Population Estimation Methods](#population-estimation-methods)
4. [TNR Progress Tracking](#tnr-progress-tracking)
5. [Entity Resolution](#entity-resolution)
6. [Data Quality & Confidence](#data-quality--confidence)
7. [Known Limitations](#known-limitations)
8. [Areas for Improvement](#areas-for-improvement)

---

## System Overview

Atlas is a data management system for Forgotten Felines of Sonoma County (FFSC) that tracks:

- **People**: Requesters, trappers, volunteers, staff
- **Places**: Addresses where cats are located (colonies, feeding sites)
- **Cats**: Individual animals with microchips and clinic visit history
- **Requests**: TNR service requests linking people to places
- **Observations**: Field observations for population estimation

### Core Principle: Single Source of Truth

Atlas follows a three-layer data architecture:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: RAW (staged_records)                         │
│  - Immutable audit trail of all imported data          │
│  - Never modified after initial import                 │
│  - Stores original values with source provenance       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: IDENTITY RESOLUTION                          │
│  - Matching via email/phone normalization              │
│  - sot.person_identifiers table for canonical lookup       │
│  - Probabilistic matching with confidence scores       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: SOURCE OF TRUTH (sot_*)                      │
│  - sot.people, sot.cats, ops.requests, sot.places      │
│  - Canonical records with verified data                │
│  - Entity_edits table tracks all changes               │
└─────────────────────────────────────────────────────────┘
```

---

## Data Architecture

### Key Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `sot.people` | All known individuals | `person_id` (UUID) |
| `sot.cats` | All cats with microchips | `cat_id` (UUID) |
| `ops.requests` | TNR service requests | `request_id` (UUID) |
| `sot.places` | All geolocated addresses | `place_id` (UUID) |
| `sot.person_identifiers` | Email/phone lookup | `identifier_id` |
| `place_colony_estimates` | Population observations | `estimate_id` |

### Data Sources

Atlas ingests data from three primary sources:

| Source | Type | Data Provided |
|--------|------|---------------|
| **Airtable** | Legacy operational data | Requests, trappers, historical records |
| **ClinicHQ** | Veterinary clinic system | Appointments, microchips, medical data |
| **Web Intake** | Public submission forms | New service requests |

Each record tracks its source:
- `source_system`: 'airtable', 'clinichq', or 'web_intake'
- `source_record_id`: Original ID in source system
- `source_created_at`: Original creation timestamp

---

## Population Estimation Methods

### Chapman Mark-Resight Estimator

Atlas uses the **Chapman estimator** to estimate cat colony populations. This is a modified Lincoln-Petersen estimator that reduces bias for small populations.

#### Formula

```
N̂ = [(M + 1)(C + 1) / (R + 1)] - 1
```

Where:
- **N̂** = Estimated population size
- **M** = Number of marked (altered/ear-tipped) cats at the site (from clinic data)
- **C** = Total cats observed during a site visit
- **R** = Number of marked cats observed during the visit

#### Example Calculation

At a site where:
- 12 cats have been altered at FFSC clinics (M = 12)
- Trapper observes 8 cats during a site visit (C = 8)
- 5 of those cats have ear tips (R = 5)

```
N̂ = [(12 + 1)(8 + 1) / (5 + 1)] - 1
N̂ = [(13)(9) / 6] - 1
N̂ = [117 / 6] - 1
N̂ = 19.5 - 1
N̂ ≈ 19 cats
```

#### Implementation

```sql
-- SQL implementation in observations endpoint
SELECT
    place_id,
    ROUND(((M + 1) * (C + 1)) / (R + 1) - 1) AS chapman_estimate
FROM (
    SELECT
        p.place_id,
        COUNT(DISTINCT c.cat_id) AS M,  -- Altered cats linked to place
        obs.total_cats_observed AS C,
        obs.eartip_count_observed AS R
    FROM sot.places p
    JOIN observations obs ON obs.place_id = p.place_id
    LEFT JOIN sot.cat_place cpr ON cpr.place_id = p.place_id
    LEFT JOIN sot.cats c ON c.cat_id = cpr.cat_id
        AND c.altered_status IN ('spayed', 'neutered')
    GROUP BY p.place_id, obs.total_cats_observed, obs.eartip_count_observed
) data;
```

#### Assumptions & Validity

The Chapman estimator assumes:

1. **Closed population**: No births, deaths, immigration, or emigration between marking and resighting
2. **Equal catchability**: All cats have equal probability of being trapped
3. **Mark retention**: Ear tips are permanent and always visible
4. **Random mixing**: Marked and unmarked cats mix randomly

**When assumptions break down:**
- Colony turnover (births/deaths) during long gaps between trapping and observation
- Trap-shy cats may never be caught (violates equal catchability)
- Some cats may have ear damage that mimics or obscures ear tips

### Colony Size Estimates from Other Sources

Besides mark-resight, colony sizes come from:

| Source Type | Confidence | Description |
|-------------|------------|-------------|
| `verified_cats` | 100% | Actual clinic-verified cats at location |
| `post_clinic_survey` | 85% | Trapper survey after clinic visit |
| `trapper_site_visit` | 80% | Field observation with structured form |
| `trapping_request` | 60% | Requester's estimate on intake |
| `intake_form` | 55% | Public intake form estimate |
| `appointment_request` | 50% | Clinic appointment note |

Weighted aggregation:

```sql
-- Confidence-weighted estimate
SELECT
    place_id,
    SUM(total_cats * base_confidence) / SUM(base_confidence) AS weighted_estimate
FROM place_colony_estimates pce
JOIN colony_source_confidence csc ON csc.source_type = pce.source_type
WHERE observation_date > NOW() - INTERVAL '6 months'
GROUP BY place_id;
```

---

## TNR Progress Tracking

### Alteration Rate Calculation

The **alteration rate** measures what percentage of a colony has been fixed:

```
Alteration Rate = (Verified Altered Cats / Estimated Population) × 100
```

#### Attribution Windows

Cats are attributed to requests using time-based windows:

```sql
CASE
    -- Legacy requests (before May 2025): Fixed 6-month window
    WHEN source_created_at < '2025-05-01' THEN source_created_at + INTERVAL '6 months'

    -- Completed requests: 3-month buffer after resolution
    WHEN resolved_at IS NOT NULL THEN resolved_at + INTERVAL '3 months'

    -- Active requests: Rolling window to future
    ELSE NOW() + INTERVAL '6 months'
END AS attribution_end
```

This rolling window system ensures:
- New clinic visits continue to attribute to active requests
- Completed requests don't claim cats indefinitely
- Historical data uses consistent 6-month windows

### Pregnancy Rate (Beacon Metric)

Tracks reproductive status from clinic intake data:

```
Pregnancy Rate = (Pregnant Females / Total Females Examined) × 100
```

Parsed from:
- ClinicHQ `reproductive_status` field
- Notes containing keywords: "pregnant", "lactating", "in heat", "nursing"

### Mortality Tracking

Death events captured from:
- Clinic records (`deceased`, `euthanized`)
- Trapper notes
- Intake follow-ups

```sql
-- Monthly mortality rate
SELECT
    DATE_TRUNC('month', event_date) AS month,
    COUNT(*) AS deaths,
    COUNT(*) * 100.0 / LAG(total_cats) OVER (ORDER BY month) AS mortality_rate
FROM cat_mortality_events
GROUP BY 1;
```

---

## Entity Resolution

### Person Matching

People are matched using normalized identifiers:

```sql
-- Email normalization
LOWER(TRIM(email))

-- Phone normalization (US)
SELECT sot.norm_phone_us('+1 (707) 555-1234');
-- Returns: 7075551234
```

Matching priority:
1. **Email match** (exact normalized match)
2. **Phone match** (normalized 10-digit US number)
3. **Never by name alone** (too many false positives)

### Place Deduplication

Addresses are geocoded and deduplicated:

```sql
-- Geographic deduplication
SELECT * FROM sot.find_or_create_place_deduped(
    p_address := '123 Main St, Santa Rosa, CA',
    p_source_system := 'web_intake'
);
```

Deduplication uses:
- Google Places API for geocoding
- 50-meter radius for duplicate detection
- Manual merge capability for complex cases

### Cat Identification

Cats are primarily identified by microchip:

```sql
-- Microchip-based lookup
SELECT * FROM sot.find_or_create_cat_by_microchip(
    p_microchip := '985141234567890',
    p_name := 'Whiskers',
    p_sex := 'female',
    p_source_system := 'clinichq'
);
```

---

## Data Quality & Confidence

### Source Confidence Levels

Each data source has an assigned confidence level:

| Source | Confidence | Rationale |
|--------|------------|-----------|
| Clinic records | 100% | Verified by veterinary staff |
| Trapper site visit | 80% | Trained observer, structured data |
| Request notes | 60% | May contain useful but unstructured info |
| Intake form | 55% | Self-reported by public |
| Parsed from text | 40% | AI/regex extraction, may misinterpret |

### Geocoding Confidence

Addresses are assigned quality tiers:

| Tier | Confidence | Description |
|------|------------|-------------|
| `exact` | 100% | Rooftop-level geocoding |
| `high` | 85% | Street address interpolation |
| `medium` | 65% | Approximate block-level |
| `low` | 40% | City/ZIP centroid |

### Entity Edit Logging

All changes to canonical records are logged:

```sql
-- entity_edits table
INSERT INTO ops.entity_edits (
    entity_type,      -- 'person', 'place', 'cat', 'request'
    entity_id,
    field_name,
    old_value,
    new_value,
    edited_by,
    edit_reason
) VALUES (...);
```

---

## Known Limitations

### 1. Chapman Estimator Violations

**Problem**: The mark-resight method assumes a closed population, but cat colonies experience turnover.

**Impact**: Population estimates may be biased:
- Deaths of marked cats → Underestimate population
- New arrivals → Overestimate alteration rate

**Mitigation**: Use observations within 30 days of clinic visits for highest accuracy.

### 2. Observation Bias

**Problem**: Cats may be trap-shy or avoid humans, making them less likely to be observed.

**Impact**: The "C" (cats seen) may undercount the true population, leading to underestimates.

**Mitigation**:
- Conduct observations at feeding times
- Multiple observation sessions improve accuracy
- Note observation conditions (time of day, feeding station)

### 3. Ear Tip Visibility

**Problem**: Ear tips may be hard to see at distance, or cats may have natural ear damage.

**Impact**: "R" (recaptures) may be miscounted.

**Mitigation**: Train observers on ear tip identification; flag uncertain observations.

### 4. Historical Data Gaps

**Problem**: Pre-2020 data exists in separate systems (paper, old databases) that aren't fully migrated.

**Impact**: Long-term trends may be incomplete.

**Mitigation**: Document known gaps; prioritize migrating high-value historical records.

### 5. Self-Reported Data Quality

**Problem**: Intake forms rely on public estimates of colony sizes, which are often inaccurate.

**Impact**: Initial triage may be based on incorrect information.

**Mitigation**: Assign low confidence to self-reported data; require trapper verification.

### 6. Address Ambiguity

**Problem**: Rural addresses, apartment complexes, and mobile home parks can be ambiguous.

**Impact**: Cats may be attributed to wrong places; colonies may be incorrectly merged.

**Mitigation**: Manual review for low-confidence geocoding; unit number tracking.

---

## Areas for Improvement

### Priority 1: Increase Observation Coverage

**Current State**: Chapman estimates available for ~422 places.
**Goal**: 2,000+ places with population estimates.

**Actions**:
- Mobile-friendly observation logging for trappers
- Automated reminders for post-clinic observations
- Gamification of observation logging

### Priority 2: Improve Pregnancy/Reproduction Data

**Current State**: ~15% of female cats have reproductive status recorded.
**Goal**: 80%+ coverage.

**Actions**:
- Standardize clinic intake forms
- Parse reproductive status from unstructured notes
- Train clinic staff on consistent data entry

### Priority 3: Seasonal Adjustment Models

**Current State**: Raw counts without seasonal normalization.
**Goal**: Adjusted estimates accounting for seasonal breeding patterns.

**Research Areas**:
- Seasonal population dynamics (peak kitten season: April-October)
- Weather-adjusted observation probability
- Multi-year trend analysis

### Priority 4: Machine Learning Integration

**Potential Applications**:
- **Named Entity Recognition**: Extract cat counts from unstructured notes
- **Duplicate Detection**: Probabilistic matching beyond exact email/phone
- **Image Recognition**: Count cats in trail camera footage
- **Predictive Modeling**: Forecast which sites need intervention

### Priority 5: External Data Integration

**Potential Sources**:
- Animal shelter intake data
- Veterinary clinic networks
- Citizen science apps (iNaturalist, etc.)
- Municipal animal control records

---

## Summary

Atlas provides a rigorous, auditable system for TNR tracking with:

| Aspect | Approach |
|--------|----------|
| **Population Estimation** | Chapman mark-resight estimator with confidence weighting |
| **Data Integrity** | Three-layer architecture with immutable audit trail |
| **Entity Resolution** | Normalized email/phone matching, no name-only matches |
| **Quality Control** | Source confidence levels, geocoding tiers, edit logging |
| **Transparency** | All calculations documented with clear assumptions |

**For questions or audits**, contact the FFSC data team or review the source code in the `sql/schema/sot/` directory for implementation details.

---

*Last updated: January 2026*
*Version: 1.0*
