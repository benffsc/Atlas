# Atlas Data Ingestion Rules

This document defines the rules and patterns that MUST be followed when ingesting data into Atlas. These rules ensure data quality, prevent duplicates, and maintain the integrity of the Source of Truth (SoT) tables.

## Core Philosophy

**Atlas is the canonical source for ALL entities we have ever interacted with:**
- Every **real person** we've contacted, serviced, or worked with
- Every **real address** where we've been or had requests
- Every **cat** with a microchip or that we've processed
- Every **trapper** who has worked with us

The goal is: "If we've touched it, it's in Atlas."

---

## The Three-Layer Architecture

### Layer 1: Raw (`staged_records`)
- **Never modify** - immutable audit trail
- Contains exact data as received from source
- Indexed by `source_system`, `source_table`, `row_hash`
- Used for debugging and re-processing

### Layer 2: Identity Resolution
- Matches incoming records to existing entities
- Uses `find_or_create_person()`, phone/email matching
- Respects blacklists and exclusion rules
- Logs all decisions in `data_changes`

### Layer 3: Source of Truth (SoT)
- `sot.people` - canonical person records
- `sot.cats` - canonical cat records
- `ops.requests` - all service requests
- `sot.places` - all addresses/locations

---

## Rules for Each Entity Type

### People (`sot.people`)

**ALWAYS add to SoT if:**
- Has valid email OR phone number
- Name passes `is_valid_person_name()` validation
- Is not an internal/program account

**Identity matching priority:**
1. Email (exact match via `sot.person_identifiers`)
2. Phone (last 10 digits via `sot.person_identifiers`)
3. Never match by name alone (too many false positives)

**Required fields:**
- `display_name` - human-readable name

**Automatic behaviors:**
- Phone blacklist checked (shared phones like FFSC main line excluded)
- Organization prefixes stripped (LMFM, etc.)
- `is_canonical` flag set for primary record in merge groups

**Use this function:**
```sql
SELECT sot.find_or_create_person(
  p_email,      -- email address
  p_phone,      -- phone number
  p_first_name, -- first name (for display_name)
  p_last_name,  -- last name (for display_name)
  p_address,    -- optional address
  p_source_system -- 'airtable', 'clinichq', etc.
);
```

### Cats (`sot.cats`)

**ALWAYS add to SoT if:**
- Has a microchip number

**Identity matching:**
- Match by microchip (exact) via `cat_identifiers`
- Secondary match by name + location (low confidence)

**Required fields:**
- `display_name` - cat name
- Microchip in `cat_identifiers`

**Use this function:**
```sql
SELECT sot.find_or_create_cat_by_microchip(
  p_microchip,
  p_name,
  p_source_system
);
```

### Places (`sot.places`)

**ALWAYS add to SoT if:**
- Has a parseable street address
- Can be geocoded (lat/lng)

**Identity matching:**
- Match by Google's canonical `formatted_address` (primary)
- Match by coordinates (within 50m threshold)
- Match by normalized address string (fallback)

**Google-Based Deduplication (MIG_228+):**

Places are deduplicated using Google's Geocoding API as the canonical source:

1. **On Creation**: `find_or_create_place_deduped()` normalizes address string
2. **On Geocoding**: `record_geocoding_result()` updates `normalized_address` to Google's canonical address
3. **Duplicate Detection**: If another place has same Google canonical address, merge automatically
4. **Merge Process**:
   - All person/cat/request links transferred to existing place
   - Duplicate relationships deleted (same person/role → same place)
   - Source place marked with `merged_into_place_id`

**Example**: "1721 Las Pravadas ct" and "1721 Las Pravadas Ct, Santa Rosa, CA 95409" both resolve to Google's canonical "1721 Las Pravadas Ct, Santa Rosa, CA 95409, USA" → **merged into one place**.

**Automatic Merge During Geocoding:**

The geocoding queue (`/api/places/geocode-queue`) automatically merges duplicates when detected:
1. When a place is geocoded, Google returns the canonical `formatted_address`
2. The `record_geocoding_result()` function updates `normalized_address` with this canonical address
3. If another place already has this exact `normalized_address`, automatic merge occurs:
   - All `sot.person_place` transferred (duplicate links deleted first)
   - All `sot.cat_place` transferred
   - All `ops.requests` updated to point to canonical place
   - Source place marked with `merged_into_place_id` and `merge_reason`

**Monitor merges:**
```sql
-- Check places merged via geocoding
SELECT place_id, formatted_address, merged_into_place_id, merge_reason, merged_at
FROM sot.places
WHERE merged_into_place_id IS NOT NULL
ORDER BY merged_at DESC;
```

**Use this function:**
```sql
SELECT sot.find_or_create_place_deduped(
  p_formatted_address,  -- address text
  p_display_name,       -- optional display name
  p_lat,                -- optional latitude (skips geocode queue if provided)
  p_lng,                -- optional longitude
  p_source_system       -- 'web_intake', 'airtable_sync', etc.
);
```

**Deduplication:**
- Same building, different units = separate records with `parent_place_id`
- Exact duplicates merged via `merged_into_place_id`

### Requests (`ops.requests`)

**ALWAYS create for:**
- Any service request (TNR, wellness, kitten intake)
- Phone calls requesting help
- Web form submissions
- Walk-in inquiries

**Linking:**
- Link to `place_id` (where cats are)
- Link to `requester_person_id` (who called/submitted)
- Link to cats via `request_cat_links`

---

## Deduplication Patterns

### Standard Upsert Pattern
```sql
INSERT INTO table (...)
VALUES (...)
ON CONFLICT (unique_constraint)
DO UPDATE SET
  field = EXCLUDED.field,
  updated_at = NOW()
RETURNING (xmax = 0) AS was_inserted;
```

### Staged Records Pattern
```sql
INSERT INTO ops.staged_records (
  source_system, source_table, source_row_id, row_hash, payload
) VALUES ($1, $2, $3, $4, $5::jsonb)
ON CONFLICT (source_system, source_table, row_hash)
DO UPDATE SET updated_at = NOW();
```

### Identity Linking Pattern
```javascript
// 1. Stage raw record
await stageRecord(sourceSystem, sourceTable, recordId, payload);

// 2. Find or create person using DB function
const personId = await db.query(
  'SELECT sot.find_or_create_person($1, $2, $3, $4, $5, $6)',
  [email, phone, firstName, lastName, address, sourceSystem]
);

// 3. Add role/relationship
await db.query(
  'INSERT INTO sot.person_roles (...) ON CONFLICT DO UPDATE ...'
);
```

---

## Merge Stability & Re-Import Protection

Manual corrections (merges) survive future data re-imports. This is critical for data quality.

### How Merges Work

When entities are merged:
1. Source entity marked with `merged_into_*_id` pointing to canonical
2. All relationships transferred to canonical entity
3. Merge logged in `entity_merge_history` for audit
4. Atlas ID preserved on canonical entity

### Re-Import Protection

During ingest, always use canonical lookups:

```sql
-- Find cat by microchip, respecting merges
SELECT sot.find_canonical_cat_by_microchip('981020012345678');

-- If the microchip belongs to a merged cat, returns the CANONICAL cat_id
-- Not the merged-away cat_id
```

**Ingest code pattern:**
```sql
-- Use get_canonical_cat_id when linking
INSERT INTO ops.appointments (cat_id, ...)
SELECT
  sot.get_canonical_cat_id(c.cat_id),  -- NOT c.cat_id directly
  ...
FROM ops.staged_records sr
JOIN sot.cat_identifiers ci ON ...
JOIN sot.cats c ON c.cat_id = ci.cat_id
```

### Canonical Resolution Functions

| Function | Purpose |
|----------|---------|
| `get_canonical_cat_id(uuid)` | Follow cat merge chain to canonical |
| `get_canonical_person_id(uuid)` | Follow person merge chain to canonical |
| `get_canonical_place_id(uuid)` | Follow place merge chain to canonical |
| `find_canonical_cat_by_microchip(text)` | Find cat by microchip, returns canonical |
| `find_canonical_person_by_email(text)` | Find person by email, returns canonical |
| `find_canonical_place_by_google_id(text)` | Find place by Google ID, returns canonical |

### Canonical Views for UI

Use these views to exclude merged entities from user-facing queries:

```sql
-- Only shows cats that are NOT merged into another
SELECT * FROM ops.v_canonical_cats;

-- Only shows people that are NOT merged into another
SELECT * FROM ops.v_canonical_people;

-- Only shows places that are NOT merged into another
SELECT * FROM ops.v_canonical_places;
```

### Merge Audit Trail

All merges are logged for debugging and compliance:

```sql
SELECT * FROM ops.entity_merge_history
WHERE entity_type = 'cat'
ORDER BY merged_at DESC;
```

---

## Source System Handling

### Airtable
- Personal Access Token in `AIRTABLE_PAT`
- Paginate with `offset` parameter
- Record ID = `record.id`
- Fields in `record.fields`

**Appointment Requests** (`scripts/ingest/airtable_appointment_requests_sync.mjs`):

Legacy appointment request submissions from the website. Being replaced by the new intake pipeline.

**Philosophy:**
- People are always saved if they pass SOT validation (salvageable contact info)
- Places only created for valid geocodable addresses
- "Booked" status = handled, no active request needed
- Old "Pending Review" (>2 months) = archived, person profile preserves trail
- Garbage data stays in `staged_records` for audit

**Address Handling:**
- `Clean Address` is primary address field
- `Clean Address (Cats)` often contains just unit number (e.g., "#4")
- `smart_merge_address()` combines: "665 Russell Ave, Santa Rosa, CA" + "#4" → "665 Russell Ave #4, Santa Rosa, CA"

**SOT Validation for People:**
- Name must have 2+ tokens (first + last)
- Each token ≥2 characters if only 2 tokens
- No HTML, URLs, or image links
- Not an address-like name ("123 Main St")
- <30% digit ratio

**Status Mapping:**
- `Status` = contact status (Contacted, No Response, etc.)
- `Submission Status` = progress (Booked, Pending Review, Declined, Complete)

**Usage:**
```bash
node scripts/ingest/airtable_appointment_requests_sync.mjs           # Live sync
node scripts/ingest/airtable_appointment_requests_sync.mjs --dry-run # Analyze only
node scripts/ingest/airtable_appointment_requests_sync.mjs --resync  # Update existing
```

### ClinicHQ
- Export as CSV/XLSX
- Match by microchip for cats
- Match by phone/email for people
- Handle `LMFM` prefix stripping

### VolunteerHub
- API credentials in `.env`
- Sync volunteer roles
- Match to existing people by email/phone

### JotForm → Airtable
- JotForm submissions land in Airtable
- Airtable sync pulls them into Atlas
- Community trapper signups follow this path

### Web Intake Submissions (`web_intake_submissions`)

All intake submissions (legacy and new) are stored in a single table with unified schema.

**Key fields:**
- `submission_id` - UUID primary key
- `is_legacy` - TRUE for Airtable imports, FALSE for new web intake
- `matched_person_id` - Links to `sot.people` if matched
- `place_id` / `matched_place_id` - Links to `sot.places`
- `created_request_id` - Links to `ops.requests` if converted

**Cat Ownership Types (`ownership_status`):**
- `unknown_stray` - Stray cat (no apparent owner)
- `community_colony` - Outdoor cat I/someone feeds
- `newcomer` - Newcomer (just showed up recently)
- `neighbors_cat` - Neighbor's cat
- `my_cat` - My own pet

**Feeding Behavior Fields (MIG_236):**
| Field | Values | Purpose |
|-------|--------|---------|
| `feeds_cat` | BOOLEAN | Does requester feed the cat? |
| `feeding_frequency` | daily, few_times_week, occasionally, rarely | How often? |
| `feeding_duration` | just_started, few_weeks, few_months, over_year | How long? |
| `cat_comes_inside` | yes_regularly, sometimes, never | Indoor access? |

**Emergency Fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `is_emergency` | BOOLEAN | Flagged as urgent |
| `emergency_acknowledged` | BOOLEAN | User acknowledged FFSC is not a 24hr hospital |
| `emergency_acknowledged_at` | TIMESTAMPTZ | When acknowledged |

**Legacy vs New Intake:**

| Field | Legacy (Airtable) | New Web Intake |
|-------|-------------------|----------------|
| `is_legacy` | TRUE | FALSE |
| `legacy_status` | Airtable Status field | NULL |
| `legacy_submission_status` | Booked/Pending/etc | NULL |
| `intake_source` | NULL | web_intake |
| `triage_category` | NULL | Auto-computed |

**Person-Place Linking:**

When importing, use database functions to link:
```sql
-- After creating person, link to submission
UPDATE ops.web_intake_submissions
SET matched_person_id = (person_id)
WHERE submission_id = $1;

-- After creating/matching place, link to submission
UPDATE ops.web_intake_submissions
SET place_id = (place_id)
WHERE submission_id = $1;
```

**UI Display:**

Submissions are visible on person and place profiles via:
- `GET /api/people/[id]/submissions`
- `GET /api/places/[id]/submissions`

These endpoints return submissions with source badges (Legacy/Web Intake) and status information.

---

## Logging & Audit Trail

### All changes must be logged:
```sql
INSERT INTO ops.data_changes (
  entity_type,   -- 'person', 'cat', 'request', etc.
  entity_key,    -- UUID as text
  field_name,    -- what changed
  old_value,     -- previous value
  new_value,     -- new value
  change_source  -- 'MIG_XXX', 'api', 'manual'
);
```

### Ingest runs tracked in:
```sql
INSERT INTO ops.ingest_runs (
  source_system, source_table, source_file_path,
  row_count, rows_inserted, rows_linked, run_status
);
```

---

## Exclusion Rules

### Phone Blacklist (`identity_phone_blacklist`)
- Shared phones (FFSC main line, shelters)
- Phones used by 5+ distinct names

### Name Exclusions (`identity_name_exclusions`)
- Organization names (hotels, schools, etc.)
- Program accounts (FFSC internal)
- Prefixes to strip (LMFM, etc.)

---

## Quick Reference

| Entity | Match By | Add If | Table |
|--------|----------|--------|-------|
| Person | Email, Phone | Has email OR phone | `sot.people` |
| Cat | Microchip | Has microchip | `sot.cats` |
| Place | Address, Coords | Has street address | `sot.places` |
| Request | Source ID | Any service request | `ops.requests` |

---

## Scripts Location

- `scripts/ingest/` - All ingest scripts
- `scripts/ingest/_lib/` - Shared utilities
- `sql/schema/sot/` - Migrations and functions

## Adding New Data Sources

1. Create `scripts/ingest/{source}_{table}_sync.mjs`
2. Stage raw records in `staged_records`
3. Use `find_or_create_*` functions for identity linking
4. Add roles/relationships as needed
5. Log changes in `data_changes`
6. Update this document with source-specific notes

---

## Cat-Request Attribution Windows

### How Cats Are Linked to Requests

Cats are attributed to requests based on:
1. **Explicit links** - Manual `request_cat_links` entries (100% confidence)
2. **Place matching** - Cat at same location as request (85% confidence)
3. **Requester matching** - Booking person email/phone matches requester (80% confidence)

### Attribution Time Windows

The system uses **rolling attribution windows** to determine which cats belong to which requests:

| Request Age | Window Logic | Window End |
|-------------|--------------|------------|
| **Legacy** (before May 2025) | Fixed | request_date + 6 months |
| **Active** (ongoing) | Rolling | NOW() + 6 months |
| **Resolved** (completed) | Buffered | resolved_at + 3 months |

### Critical Rules for Ingests

1. **Preserve `source_created_at`** - For imported data, this determines window calculations
2. **Set `resolved_at`** when closing requests - Triggers window buffer logic
3. **Don't manually override window calculations** - The view handles this automatically
4. **Legacy cutoff is May 1, 2025** - Data before this uses fixed windows only

### ClinicHQ Integration

When importing clinic visits:
- Match by `client_email` or `client_phone` to `sot.person_identifiers`
- Clinic visit `visit_date` determines if within attribution window
- Procedure dates (`is_spay`/`is_neuter`) determine alteration counts

### View Reference

- `v_request_alteration_stats` - Shows attributed cats with `window_type` column
- `v_trapper_full_stats` - Uses attribution for trapper cat counts

See `/docs/architecture/attribution-windows.md` for detailed documentation.

---

## Colony Size Tracking (MIG_209)

### Overview

Colony size is tracked separately from "cats caught" - it represents our best estimate of how many cats are at a location based on multiple data sources.

### Data Sources (by confidence)

| Source Type | Confidence | Description |
|-------------|------------|-------------|
| `verified_cats` | 100% | Actual cats in database with place link |
| `post_clinic_survey` | 85% | Project 75 post-clinic survey |
| `trapper_site_visit` | 80% | Trapper assessment report |
| `manual_observation` | 75% | Staff/admin manual entry |
| `trapping_request` | 60% | Requester estimate |
| `intake_form` | 55% | Web intake form |
| `appointment_request` | 50% | Appointment booking |

### Adding New Colony Data

To add a new colony data source:

1. **Add to `colony_source_confidence`** with appropriate confidence:
   ```sql
   INSERT INTO ops.colony_source_confidence (source_type, base_confidence, description)
   VALUES ('new_source', 0.65, 'Description of new source');
   ```

2. **Insert estimates into `place_colony_estimates`**:
   ```sql
   INSERT INTO ops.place_colony_estimates (
     place_id, total_cats, adult_count, kitten_count,
     altered_count, unaltered_count,
     source_type, observation_date, is_firsthand,
     source_system, source_record_id
   ) VALUES (...);
   ```

3. **The view auto-aggregates** - `v_place_colony_status` will automatically include the new data with weighted confidence.

### Confidence Calculation

Final confidence = `base_confidence × recency_factor + firsthand_boost + activity_boost`

Where:
- **Recency factor**: 100% (≤30 days), 90% (≤90 days), 75% (≤180 days), 50% (≤365 days), 25% (>365 days)
- **Firsthand boost**: +5% if reporter saw cats themselves
- **Clinic boost**: +10% if clinic procedure at place within 4 weeks of survey, +5% if any clinic history
- **Multi-source confirmation**: +15% if 2+ sources agree within 20%

### Key Tables

| Table | Purpose |
|-------|---------|
| `place_colony_estimates` | All observations from all sources |
| `colony_source_confidence` | Confidence weights per source type |
| `v_place_colony_status` | Computed best estimate per place |

### Views

- `v_place_colony_status.colony_size_estimate` - Weighted average of all estimates
- `v_place_colony_status.verified_cat_count` - Ground truth from database
- `v_place_colony_status.estimated_work_remaining` - Cats still needing alteration

### Project 75 Post-Clinic Surveys

Project 75 surveys are submitted after clinic visits and provide high-confidence colony size data.

**Script:** `scripts/ingest/airtable_project75_sync.mjs`

**Multi-Step Matching Strategy (Geocode-First):**

1. **Geocode First** - Normalizes user-typed addresses via Google Geocoding API
   - "4600 Todd rd Sebastopol ca95472" → "4600 Todd Rd, Sebastopol, CA 95472, USA"

2. **Exact Formatted Address Match**
   - Matches geocoded `formatted_address` against DB (with/without ", USA")
   - Handles slight format differences between Google results

3. **Fuzzy Address Match**
   - Extracts key components: street number + street name + city
   - Regex match: `^655.*willowsid.*santa rosa` matches "655 Willowside Rd, Santa Rosa, CA 95401"
   - Handles Road/Rd, Street/St, Avenue/Ave variations

4. **Proximity Match**
   - Finds places within 100m of geocoded coordinates
   - Requires ≥60% string similarity OR <30m distance

5. **Person Lookup (Fallback)**
   - Finds requester by email/phone via `sot.person_identifiers`
   - Links to their most recent request's place

6. **Raw Text Match (Last Resort)**
   - Fuzzy text search on normalized address components

**Match Rate:** 528/631 (84%) surveys matched

**Data Storage:**
- Colony estimates stored in `place_colony_estimates` with `source_type='post_clinic_survey'`
- Linked to person via `reported_by_person_id`
- Colony size synced to `places.colony_size_estimate` for Beacon access

**Alteration Rate Calculation:**
```
alteration_rate = verified_altered_count / colony_size_estimate
```
Where:
- `verified_altered_count` = cats with procedures at this place
- `colony_size_estimate` = weighted estimate from all sources

**Why No Place Creation:**
- Project 75 is supplemental colony data for existing places
- Unmatched addresses (~16%) are places not yet in Atlas
- These will be added through trapping requests or intake forms

**Usage:**
```bash
node scripts/ingest/airtable_project75_sync.mjs           # Run sync
node scripts/ingest/airtable_project75_sync.mjs --dry-run # Preview only
node scripts/ingest/airtable_project75_sync.mjs -v        # Verbose output
```

---

## Ecology-Based Colony Estimation (MIG_211)

### Overview

Atlas uses wildlife ecology best practices for colony size estimation. This approach provides:
- Defensible lower-bound alteration rates (never over-claims)
- Statistical mark-resight estimates when ear-tip data available
- Clear upgrade path as data collection improves

See `/docs/architecture/colony-estimation.md` for full documentation.

### Core Calculations

```
A_known = verified altered cats (from clinic data)
N_recent_max = MAX(reported_total) within 180 days
p_lower = A_known / MAX(A_known, N_recent_max)  -- Lower-bound rate
```

For mark-resight (when ear-tip counts available):
```
M = known ear-tipped cats (A_known)
C = total cats observed
R = ear-tipped cats observed
N_hat = ((M+1)(C+1)/(R+1)) - 1  -- Chapman estimator
```

### Colony Observation Fields

When ingesting colony data, capture these fields:

#### Essential
| Field | Type | Description |
|-------|------|-------------|
| `total_cats` | INTEGER | Total cat count estimate |
| `altered_count` | INTEGER | Ear-tipped/fixed cats |

#### Ecology-Grade (enable mark-resight)
| Field | Type | Description |
|-------|------|-------------|
| `peak_count` | INTEGER | Highest seen at once (last 7 days) |
| `eartip_count_observed` | INTEGER | Ear-tipped cats in this observation |
| `total_cats_observed` | INTEGER | Total cats in same observation |

#### Context (improves accuracy)
| Field | Type | Description |
|-------|------|-------------|
| `observation_time_of_day` | TEXT | dawn, midday, dusk, evening, night, various |
| `is_at_feeding_station` | BOOLEAN | If observed at regular feeding |
| `reporter_confidence` | TEXT | high, medium, low |

### Ingest Pipeline Requirements

When ingesting colony data from any source:

1. **Prefer peak_count over total_cats** if available
2. **Capture ear-tip observations** when possible (enables mark-resight)
3. **Store observation context** for weight adjustments
4. **Link to place** via geocoding
5. **Link to reporter** via email/phone matching

### Example Insert

```sql
INSERT INTO ops.place_colony_estimates (
  place_id,
  total_cats,
  peak_count,
  eartip_count_observed,
  total_cats_observed,
  observation_time_of_day,
  is_at_feeding_station,
  reporter_confidence,
  source_type,
  observation_date,
  is_firsthand,
  source_system,
  source_record_id
) VALUES (
  $1,  -- place_id
  $2,  -- total_cats
  $3,  -- peak_count
  $4,  -- eartip_count_observed
  $5,  -- total_cats_observed
  $6,  -- observation_time_of_day
  $7,  -- is_at_feeding_station
  $8,  -- reporter_confidence
  'intake_form',
  CURRENT_DATE,
  TRUE,
  'web_intake',
  $9   -- source_record_id
);
```

### View Reference

- `v_place_ecology_stats` - Ecology-based metrics (A_known, N_max, p_lower, Chapman)
- `v_place_colony_status` - Weighted average approach with confidence boosts

### Estimation Method Selection

The system automatically selects the best method:

| Method | When Used | Display |
|--------|-----------|---------|
| `mark_resight` | Ear-tip observations + clinic data | "~X cats (ecology estimate)" |
| `max_recent` | Survey reports exist | "≥X% alteration rate" |
| `verified_only` | Only clinic data | "X verified altered" |

### Recommended Survey Questions

For ecology-grade estimation, ask:

1. **Peak count**: "In the last 7 days, what's the highest number of cats you've seen at one time?"
2. **Ear-tip count**: "Of those, about how many had an ear tip?"
3. **Observation time**: "When do you usually see these cats?"
4. **Feeding station**: "Is there a regular feeding station?"
5. **Confidence**: "How confident are you in your count?"

---

## Colony Data Flow Architecture

### Data Sources → Colony Estimates

```
                            ┌──────────────────────────────────────┐
                            │   v_place_ecology_stats (View)       │
                            │   • effective_colony_size            │
                            │   • effective_altered                │
                            │   • p_lower (alteration rate)        │
                            │   • estimation_method                │
                            └──────────────────────────────────────┘
                                            ▲
                                            │
        ┌───────────────────────────────────┼───────────────────────────────────┐
        │                                   │                                   │
   ┌────┴────┐                        ┌─────┴─────┐                      ┌──────┴──────┐
   │ Clinic  │                        │  Colony   │                      │   Manual    │
   │  Data   │                        │ Estimates │                      │  Override   │
   │(a_known)│                        │   Table   │                      │  (Staff)    │
   └────┬────┘                        └─────┬─────┘                      └──────┬──────┘
        │                                   │                                   │
   cat_procedures                   place_colony_estimates              places.colony_override_*
   + sot.cat_place                         ▲
                                           │
        ┌──────────────────────────────────┬────────────────────────────┬──────────────────┐
        │                                  │                            │                  │
   ┌────┴────┐                       ┌─────┴─────┐                ┌─────┴─────┐     ┌──────┴──────┐
   │   P75   │                       │ Trapping  │                │   Web     │     │   Future    │
   │ Survey  │                       │ Request   │                │  Intake   │     │   Sources   │
   │  (85%)  │                       │   (60%)   │                │   (55%)   │     │             │
   └─────────┘                       └───────────┘                └───────────┘     └─────────────┘
```

### How Data Flows

1. **Project 75 Post-Clinic Surveys** (85% confidence)
   - Airtable → `scripts/ingest/airtable_project75_sync.mjs` → `place_colony_estimates`
   - Fields: total_cats, adult_count, kitten_count, altered_count
   - Run: `node scripts/ingest/airtable_project75_sync.mjs`

2. **Trapping Requests** (60% confidence)
   - Airtable → `ops.requests` → Trigger `trg_request_colony_estimate` → `place_colony_estimates`
   - Fields: estimated_cat_count → total_cats
   - Automatic via trigger on insert/update

3. **Web Intake Submissions** (55% confidence)
   - Web form → `web_intake_submissions` → Geocode → Link place → Trigger → `place_colony_estimates`
   - Fields: cat_count_estimate, peak_count, eartip_count_observed
   - Run: `node scripts/ingest/geocode_intake_addresses.mjs`

4. **Clinic Data** (100% ground truth)
   - ClinicHQ → `ops.appointments` → `cat_procedures` + `sot.cat_place`
   - Fields: is_spay, is_neuter → a_known (verified altered count)
   - Automatic via ingest pipeline

### Key Functions

| Function | Purpose |
|----------|---------|
| `find_or_create_place_deduped()` | Creates places with deduplication |
| `resync_all_linkages()` | Re-syncs gaps in the pipeline |
| `set_colony_override()` | Staff manual override with audit |
| `create_intake_colony_estimate()` | Auto-creates estimate from intake |

### Confidence Weights

| Source | Confidence | Description |
|--------|------------|-------------|
| Verified cats (clinic) | 100% | Ground truth from procedures |
| P75 survey | 85% | Post-clinic survey |
| Trapper site visit | 80% | Assessment by trained trapper |
| Manual observation | 75% | Staff/admin entry |
| Trapping request | 60% | Requester estimate |
| Web intake | 55% | Online form submission |
| Appointment request | 50% | Booking estimate |

### Manual Override

Staff can override computed estimates when they have confirmed information:

```sql
-- Set override
SELECT * FROM ops.set_colony_override(
    'place-uuid',
    15,                    -- confirmed total cats
    15,                    -- confirmed altered
    'Site visit 2025-01-14 - all cats ear-tipped',
    'staff@ffsc.org'
);

-- Clear override (revert to computed)
SELECT ops.clear_colony_override(
    'place-uuid',
    'New survey data available',
    'staff@ffsc.org'
);
```

All overrides are tracked in `colony_override_history` for audit.

### Resync Command

Run periodically to catch any gaps in linkages:

```sql
SELECT * FROM sot.resync_all_linkages();
```

Returns counts of:
- Appointments linked to cats
- Cat-place relationships created
- Procedures created
- Colony estimates created
- Places updated with activity flags

---

## Fuzzy Name Matching (MIG_233)

### Overview

People often spell names differently or have similar names that represent the same person. Atlas uses fuzzy matching to detect potential duplicates when adding new contacts.

**Example**: "Bibiana Patino" and "Viviana Patino" with the same phone number are likely the same person.

### Matching Functions

#### `find_similar_people(name, phone, email, threshold)`

Returns potential matches ranked by confidence.

**Match Types (in priority order):**
| Match Type | Score | Description |
|------------|-------|-------------|
| `exact_phone` | 1.0 | Phone number matches exactly |
| `exact_email` | 1.0 | Email matches exactly |
| `name_similar` | 0.3-1.0 | Trigram similarity above threshold |
| `soundex_match` | 0.7 | First and last name sound similar (B/V, etc.) |

**Example:**
```sql
SELECT * FROM sot.find_similar_people(
  'Viviana Patino',    -- name to search
  '707-975-1628',      -- phone (optional)
  NULL,                -- email (optional)
  0.30                 -- threshold (default)
);
```

#### `check_for_duplicate_person(first, last, phone, email)`

Quick check when adding new contacts. Returns top 5 matches with confidence level.

**Confidence Levels:**
| Level | Criteria |
|-------|----------|
| HIGH | Exact phone/email match OR similarity > 0.8 |
| MEDIUM | Similarity 0.5-0.8 |
| LOW | Similarity 0.3-0.5 |

### API Endpoint

**GET** `/api/people/check-duplicate`

Query params:
- `name` (required): Full name to search
- `phone` (optional): Phone number for exact matching
- `email` (optional): Email for exact matching
- `threshold` (optional): Similarity threshold (default 0.30)

**Response:**
```json
{
  "query": { "name": "Viviana Patino", "phone": "707-975-1628" },
  "total_matches": 1,
  "high_confidence": [{ "person_id": "...", "display_name": "Bibiana Patino Garcia", "similarity_score": 1.0, "match_type": "exact_phone" }],
  "medium_confidence": [],
  "low_confidence": [],
  "suggested_match": { ... }
}
```

### Same-Family Detection

The system detects potential family members with the same last name:
- Same last name (exact match)
- Similar first name (similarity > 0.5)
- This catches B/V variations (Bibiana/Viviana), spelling mistakes, nicknames

### Potential Duplicate View

```sql
-- View all potential duplicates in the system
SELECT * FROM ops.v_potential_duplicate_people;
```

Returns pairs of people who may be duplicates based on:
- Phonetic match (soundex on first + last name)
- High name similarity (> 0.6)
- Same family (same last name, similar first name)

---

## Name Normalization (MIG_232)

### Overview

Names are automatically normalized to Title Case on insert/update to prevent ALL CAPS or all lowercase names.

### Automatic Trigger

A trigger on `sot.people` and `sot.cats` normalizes names:
- `BIBIANA PATINO GARCIA` → `Bibiana Patino Garcia`
- `john smith` → `John Smith`

Only triggered when:
- Name is > 3 characters
- Name is entirely uppercase OR entirely lowercase

### Manual Normalization

```sql
-- Normalize a single name
SELECT sot.normalize_display_name('JOHN SMITH');
-- Returns: 'John Smith'

-- Fix all caps names in existing data
UPDATE sot.people
SET display_name = sot.normalize_display_name(display_name)
WHERE display_name = UPPER(display_name)
  AND LENGTH(display_name) > 3;
```

### Special Cases

The normalizer handles:
- McDonald → McDonald (not Mcdonald)
- O'Brien → O'Brien (not O'brien)

---

## Ingest Script Consistency Requirements

### Standard Functions (MUST use)

All ingest scripts MUST use these database functions instead of replicating logic in JavaScript:

| Function | Purpose |
|----------|---------|
| `find_or_create_person()` | Create/match people with proper deduplication |
| `find_or_create_cat_by_microchip()` | Create/match cats by microchip |
| `find_or_create_place_deduped()` | Create/match places by normalized address |
| `is_valid_person_name()` | Validate name before insert |
| `normalize_display_name()` | Normalize name case |
| `get_canonical_*_id()` | Follow merge chains |

### Validation Checklist for Ingest Scripts

When creating or reviewing ingest scripts, ensure:

1. **Name Validation**: Call `is_valid_person_name()` before creating people
2. **Phone Blacklist**: Check `identity_phone_blacklist` before matching by phone
3. **Name Normalization**: Names are normalized (trigger handles this, but verify)
4. **Place Deduplication**: Use `find_or_create_place_deduped()` not direct INSERT
5. **Person Deduplication**: Use `find_or_create_person()` not direct INSERT
6. **Merge Awareness**: Use `get_canonical_*_id()` when linking to entities
7. **Source System**: Set `data_source` correctly for audit trail
8. **Staged Records**: Stage raw data in `staged_records` before processing

### Known Gaps to Address

Scripts that may need updates:
- `airtable_appointment_requests_sync.mjs` - Replicates name validation in JS
- `clinichq_owner_info_xlsx.mjs` - Doesn't use standard person creation

### Source System Enum

Valid values for `data_source`:
- `airtable` - Airtable sync
- `clinichq` - ClinicHQ imports
- `web_intake` - Web intake form
- `atlas` - Manual Atlas entry
- `beacon` - Beacon mobile app
- `import` - Bulk imports

---

## Geocoding and Place Deduplication

### Geocoding Queue

Places without coordinates are automatically queued for geocoding:

```sql
-- View queue stats
SELECT * FROM ops.v_geocoding_stats;

-- View failed geocodes (need manual review)
SELECT * FROM ops.v_geocoding_failures;
```

### Admin UI Controls

The admin page (`/admin`) has geocoding controls:
- **Run for 1 Minute** - Process batch for 1 minute
- **Run for 5 Minutes** - Process batch for 5 minutes
- **Run Until Complete** - Process until queue is empty
- **Stop** - Interrupt processing

### Automatic Deduplication During Geocoding

When a place is geocoded:
1. Google returns canonical `formatted_address`
2. System checks if another place has same canonical address
3. If duplicate found:
   - All relationships transferred to existing place
   - Source place marked with `merged_into_place_id`
   - Merge logged for audit

**Example:**
- "1721 Las Pravadas ct" and "1721 Las Pravadas Ct, Santa Rosa, CA 95409"
- Both geocode to "1721 Las Pravadas Ct, Santa Rosa, CA 95409, USA"
- Automatically merged into one place

### Monitor Merges

```sql
-- Check places merged via geocoding
SELECT place_id, formatted_address, merged_into_place_id, merge_reason, merged_at
FROM sot.places
WHERE merge_reason = 'geocode_canonical_match'
ORDER BY merged_at DESC;
```
