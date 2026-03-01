# Atlas Data Remediation Plan

**Created:** 2026-02-19
**Last Updated:** 2026-02-24
**Status:** Phase 1 & 6 COMPLETE — Phase 7 (Client & Place Tracking) IN PROGRESS

> **For current actionable tasks, see: `docs/CURRENT_STATE_AND_PLAN.md`**
> This document contains research, background, and detailed implementation specs.

---

## Phase 7: Client & Place Tracking (2026-02-24) — IN PROGRESS

### Core Architectural Principle (INV-11)

**ClinicHQ provides CATS + PLACES as ground truth. Person links are inferred and ~30% unreliable.**

| Data Type | Source | Reliability | Use Case |
|-----------|--------|-------------|----------|
| **Cats** | ClinicHQ microchips, procedures | ✅ Ground truth | Cat identity, TNR tracking |
| **Places** | ClinicHQ Owner Address field | ✅ Ground truth | Map visualization, colony tracking |
| **People** | Email/phone inference | ⚠️ ~70% reliable | Communication, relationship tracking |

**Why 30% unreliable?**
- Trappers bring colony cats (their contact info ≠ where cat lives)
- Shared household phones (Cell Phone field used by multiple family members)
- Family members use one email for all bookings
- Org emails used for individual bookings

**Implication:** The MAP should show cats at PLACES, not filtered through person links.

### Active Data Gaps

#### DATA_GAP_053: Original Client Names Lost During Identity Resolution

**Status:** FIX READY - MIG_2489, MIG_2490, MIG_2491
**Impact:** Cannot distinguish who booked vs who it resolved to

**Example:** Cat 26-691 (Tux)
- ClinicHQ: Client = "Elisha Togneri", Email = michaeltogneri@yahoo.com
- Atlas Shows: Linked to "Michael Togneri" (email match)
- Lost: That Elisha booked it, staff notes saying "his wife"

**Fix:** Extend `ops.clinic_accounts` to store ALL ClinicHQ owners, not just pseudo-profiles.

#### DATA_GAP_054: Address-Type Accounts Missing Place Extraction

**Status:** FIX READY - MIG_2496, MIG_2497
**Impact:** Cats at address-named accounts don't appear on map

**Example:** "Old Stony Pt Rd" colony
- ClinicHQ: `Owner First Name` = "Old Stony Pt Rd" (site name)
- Processing: Correctly classified as `'address'`
- Problem: No place extracted → `inferred_place_id` = NULL → cats invisible

**Fix:** Extract places from address-type account names (port V1 MIG_909 logic).

### Audit Findings (2026-02-24)

**QRY_054 results before migrations:**

| Metric | Count | Notes |
|--------|-------|-------|
| Active cats | 42,487 | |
| With cat_place links | 34,346 (81%) | |
| Without cat_place links | 8,141 (19%) | **Gap to address** |
| Active people | 11,455 | |
| People misclassified (orgs as people) | 30 | e.g., Marin Humane, Wiggins Electric |
| Address-type accounts | 1,503 | ALL missing resolved_place_id |
| Site-name accounts | 1,709 | ALL missing resolved_place_id |

**Classification mismatches found:**
- "Grow Generation" → likely_person (should be organization) — **Fixed by MIG_2497**
- "Keller Estates Vineyard" → likely_person (should be site_name) — **Fixed by MIG_2498**
- "Rebooking placeholder" → likely_person (should be garbage) — **Fixed by MIG_2498**

**Old Stony Pt Rd trace:**
- clinic_account EXISTS with `account_type='address'`
- `resolved_place_id = NULL` ← **Root cause**
- Place "2384 Stony Point Rd" EXISTS with 55 cats
- **MIG_2496 will link account to place**

### Migration Dependency Order

```
PHASE 7 EXECUTION ORDER:

MIG_2497 (Keywords)     - Add "generation" and ~45 business keywords
     ↓
MIG_2498 (Edge Cases)   - Fix classify_owner_name for site_names and garbage
     ↓
MIG_2489 (Schema)       - Extend clinic_accounts, add columns
     ↓
MIG_2490 (Backfill)     - Create accounts for ALL appointments
     ↓
MIG_2491 (Robustness)   - Feature flags, indexes, race condition fix
     ↓
MIG_2496 (Places)       - Extract places for address-type accounts
     ↓
run_all_entity_linking() - Link cats to new places
```

### Pre-Migration Audit

**ALWAYS RUN BEFORE MIGRATIONS:**

```bash
psql -f sql/queries/QRY_054__data_quality_audit.sql
```

### Phase 7 Files

| File | Purpose |
|------|---------|
| `sql/queries/QRY_054__data_quality_audit.sql` | Pre/post migration audit |
| `sql/schema/v2/MIG_2497__add_missing_business_keywords.sql` | Add "generation" + ~45 business keywords |
| `sql/schema/v2/MIG_2498__fix_classification_edge_cases.sql` | Fix site_name (3+ words) and garbage patterns |
| `sql/schema/v2/MIG_2489__extend_clinic_accounts.sql` | Schema extension |
| `sql/schema/v2/MIG_2490__backfill_clinic_accounts.sql` | Historical backfill |
| `sql/schema/v2/MIG_2491__robustness_fixes.sql` | Race condition, indexes |
| `sql/schema/v2/MIG_2496__address_type_place_extraction.sql` | Place extraction |
| `docs/DATA_GAP_053__client_tracking.md` | DATA_GAP_053 details |
| `docs/DATA_GAP_054__address_type_accounts_missing_places.md` | DATA_GAP_054 details |

### Related Plan

See `~/.claude/plans/spicy-conjuring-sifakis.md` for full Client & Trapper Tracking System design including:
- Phase 1: Extend clinic_accounts (this phase)
- Phase 2: Households (sot.households)
- Phase 3: Trapper Contracts (Airtable migration)
- Phase 4: UI Components

---

## Completion Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Foundation Fixes (MIG_2350 VolunteerHub) | ✅ COMPLETE |
| **Phase 2** | Event Sourcing for Cats | ⏳ PENDING |
| **Phase 3** | Colony Estimation (Chapman) | ⏳ PENDING |
| **Phase 4** | Volunteer Pipeline | ⏳ PENDING |
| **Phase 5** | Process Pending Records | ⏳ PENDING |
| **Phase 6** | Reference Data Integration | ✅ COMPLETE |

### Phase 6 Completion Details (2026-02-19)

| Migration | Description | Records |
|-----------|-------------|---------|
| MIG_2370 | `ref.census_surnames` table | 162,254 |
| MIG_2371 | `ref.first_names` + `ref.ssa_names_by_year` | 104,819 unique |
| MIG_2372 | `ref.business_keywords` | 136 |
| MIG_2373 | Updated `classify_owner_name()` | All tests pass |
| MIG_2350 | Fixed `match_volunteerhub_volunteer()` | 1,329 matched |

---

## Code Audit Results (2026-02-19)

Before implementing new patterns, we audited existing code. Key findings:

### What Already Exists (and is GOOD)

| Component | Status | Notes |
|-----------|--------|-------|
| `sot.data_engine_score_candidates` | ✅ EXCELLENT | Fellegi-Sunter weighted scoring already implemented (Email 40%, Phone 25%, Name 25%, Address 10%). Has soft blacklist, returns score_breakdown. |
| `sot.data_engine_resolve_identity` | ✅ CORRECT | 6-param signature works correctly. Returns decision_type, resolved_person_id, confidence. |
| `sot.create_skeleton_person` | ✅ EXISTS | Creates placeholder people for volunteers without identifiers. |
| `source.volunteerhub_volunteers` | ✅ COMPLETE | Has all matching columns: matched_person_id, matched_at, match_confidence, match_method, match_locked, sync_status. |
| `source.volunteerhub_group_memberships` | ✅ TEMPORAL | Has joined_at, left_at for temporal tracking. |
| `quarantine.failed_records` | ✅ DLQ EXISTS | Has source_system, failure_reason, failure_details, resolution. Could add retry columns later. |
| `sot.cat_intake_events` | ✅ SCHEMA | Table exists with good schema (cat_id, intake_type, event_date, source_system). Just empty. |
| `sot.cat_mortality_events` | ✅ SCHEMA | Table exists. Empty. |
| `sot.cat_movement_events` | ✅ SCHEMA | Table exists with from_place_id, to_place_id. Empty. |
| `beacon.colony_estimates` | ✅ SCHEMA | Table exists with estimate_date, total_estimated, estimation_method. Missing Chapman columns. |

### What Needs Fixing

| Component | Issue | Fix | Status |
|-----------|-------|-----|--------|
| `sot.match_volunteerhub_volunteer` | BUG: Wrong params and column names | MIG_2350 | ✅ FIXED |
| `sot.classify_owner_name` | Missing gazetteer lookups | MIG_2373 | ✅ FIXED |
| `beacon.colony_estimates` | Missing Chapman columns | MIG_2365 | ⏳ PENDING |
| Empty event tables | cat_intake_events, cat_mortality_events empty | MIG_2363-2364 | ⏳ PENDING |

### Implications for Plan

Since much infrastructure exists, the remediation plan is SIMPLER than originally thought:

1. **Phase 1 is mostly MIG_2350** — Fix the function bug and run matching
2. **We DON'T need** a new review queue table — `ops.review_queue` exists (though unused)
3. **We DON'T need** a new DLQ — `quarantine.failed_records` exists
4. **We DO need** to populate empty tables and add Chapman columns

---

## Expanded Coverage Analysis (2026-02-19)

### Probabilistic Scoring Coverage by Entity Type

| Entity | Scoring Method | Gap Analysis |
|--------|---------------|--------------|
| **People** | ✅ `data_engine_score_candidates()` | Fellegi-Sunter with Email 40%, Phone 25%, Name 25%, Address 10%. Soft blacklist support. EXCELLENT. |
| **Cats** | ⚠️ Deterministic only | `find_or_create_cat_by_microchip()` and `find_or_create_cat_by_clinichq_id()` use exact matching. No fuzzy matching for microchip typos or name similarity. MIG_2341 plan exists but not implemented. |
| **Places** | ⚠️ Deterministic only | `find_or_create_place_deduped()` uses exact normalized address OR 10m coordinate match. No fuzzy address matching or phonetic street name similarity. |
| **Volunteers** | ✅ Uses Data Engine | `match_volunteerhub_volunteer()` (fixed in MIG_2350) calls `data_engine_resolve_identity()` for probabilistic matching. |

### Name Classification Research Findings (2026-02-19)

**Source:** Analysis of probablepeople, nameparser, NER systems, US Census data, SSA names.

#### Best Practice: Rule-Based + Gazetteer Hybrid

For domain-specific systems like Atlas, rule-based classification with gazetteer validation outperforms pure ML approaches because:
- Patterns are stable and predictable (FFSC-specific booking conventions)
- Insert-time classification is critical for routing
- False positives have high cost (wrong person-place links)

#### Implementation Strategy

| Component | Purpose | Performance |
|-----------|---------|-------------|
| **Lookup tables** | Business suffixes, keywords | ~4ms (B-tree index) |
| **Regex patterns** | Complex multi-word patterns | ~640ms (no index) |
| **Name gazetteers** | Validate first/last names | ~4ms (B-tree index) |

#### Business Name Detection Patterns to Add

Based on research, these patterns are missing from `classify_owner_name()`:

```sql
-- Business service words (World Of Carpets, Atlas Tree Surgery)
'Surgery|Carpets?|Market|Store|Shop|Service|Services|Plumbing|
Electric|Electrical|Roofing|Landscaping|Construction|Painting|
Cleaning|Moving|Storage|Auto|Automotive|Tire|Glass|Repair'

-- "World Of X" pattern (common business naming)
'^World\s+Of\s'

-- DBA patterns
'\mDBA\M|\mD\.B\.A\.\M'

-- "&" with business words
'\s&\s.*(associates|partners|sons|company)'
```

#### False Positive Prevention: Surname Safelist

Common surnames that are also occupations (prevent "John Carpenter" → business):

| Surname | Rank | Notes |
|---------|------|-------|
| Carpenter | #231 | Also occupation |
| Baker | #40 | Also occupation |
| Cook | #126 | Also occupation |
| Fisher | #95 | Also occupation |
| Miller | #6 | Also occupation |
| Taylor | #11 | Also occupation |

**Rule:** If `first_word` is common first name AND `last_word` is in surname safelist → `likely_person`

#### Reference Data Sources

- **US Census Surnames:** 151,000+ surnames with frequency (census.gov)
- **SSA Baby Names:** All first names 1880-present (ssa.gov)
- **Business Keywords:** Curated list of ~100 business indicators

---

**Recommendation:** Cats and Places can remain deterministic for now because:
- Cats have gold-standard microchip identifiers (95.6% coverage)
- Places have structured addresses that normalize well
- Probabilistic matching adds complexity and false positive risk

If needed later, MIG_2341 provides a cat dedup detection system with confidence scoring.

### Source Authority Map Coverage

**Status:** ✅ COMPLETE (MIG_875)

| Source | Authoritative For | NOT Authoritative For |
|--------|------------------|----------------------|
| **ClinicHQ** | Clinic clients, appointments, medical records, microchips, procedures | Volunteers, program outcomes |
| **VolunteerHub** | Volunteer people, user groups, group memberships, roles (trapper/foster/clinic) | Animals, outcomes, clinic data |
| **ShelterLuv** | Program animals, outcomes (adoption/foster/transfer/mortality), intake events | Volunteer people, clinic procedures |
| **Airtable** | Legacy requests, public intake, legacy trapper roster | Volunteer management, clinic data |
| **PetLink** | Microchip registrations | Everything else (emails are fabricated) |

**Semantic Query Routing:** `trapper.source_semantic_queries` table maps "show me fosters" → VolunteerHub (people) vs "show me foster cats" → ShelterLuv (outcomes).

### Safe Re-Sync Patterns for Source Changes

**Scenario Analyzed:** Dahlia & Sage Community Market account rename + address correction

**Current State (115 E 2nd St, Cloverdale):**
- 17 unique cats with microchips linked to this place
- Cats booked under "Dahlia & Sage Community Market" account
- Katie Moore (community trapper) linked to some appointments
- Actual cat residence is Jessica Gonzalez at 118 E. 2nd Street

**What Happens on Re-Export After Account Rename:**

| Component | What Persists | What Changes | Risk Level |
|-----------|---------------|--------------|------------|
| **Cat Identity** | ✅ Microchip + clinichq_animal_id | Nothing | SAFE |
| **Cat-Place Links** | ⚠️ May need update | If address changes (115→118) | LOW |
| **Person Links** | ⚠️ May orphan | Old person no longer on export | MEDIUM |
| **Appointment Records** | ✅ Historical | New owner_info on re-export | SAFE |

**Cat Identity Is SAFE Because:**
1. `find_or_create_cat_by_microchip()` checks `clinichq_animal_id` as fallback (MIG_2340)
2. Microchip is immutable gold standard
3. Cat records update in place, never duplicate

**Safe Re-Export Workflow:**

```
1. BEFORE RENAME (analytical preview):
   - Run: SELECT cat_id, microchip, clinichq_animal_id FROM appointments WHERE place_id = 'X'
   - Verify all cats have microchips and clinichq_animal_ids
   - Document current state

2. RENAME IN CLINICHQ:
   - Change account name from "Dahlia & Sage" to "Jessica Gonzalez"
   - Update address from 115 E 2nd St to 118 E. 2nd Street
   - Update phone from 707-280-4556 to 707-536-5213

3. RE-EXPORT & INGEST:
   - Export clinic data
   - Ingest via standard pipeline
   - Cat matching via clinichq_animal_id → existing cats found
   - New place created (118 E. 2nd Street)
   - New person created (Jessica Gonzalez with phone)
   - Appointments get new person_id and place_id

4. POST-INGEST VERIFICATION:
   - Verify same cat_ids exist
   - Verify cat-place relationships updated to new address
   - Old "Dahlia & Sage" person becomes orphan (acceptable)
   - Old 115 E 2nd St place remains (historical)
```

**Key Invariant:** Cat identity persists through ALL source changes because microchip/clinichq_animal_id are immutable.

### Data Gaps Discovered

**GAP_001: Two Real Katie Moores — Correctly Separated ✅**
- 2 records with different contact info (different emails and phones)
- Both from clinichq, created 37 minutes apart
- **CONFIRMED:** These are TWO REAL DIFFERENT PEOPLE named Katie Moore
- Probabilistic scoring correctly keeps them separate because different identifiers
- **No action needed** — this validates the scoring system is working

**GAP_002: No Source Change Audit Trail**
- When ClinicHQ account info changes, no record of previous state
- **Future Enhancement:** Add `source_record_mappings` table (see research below)

**GAP_003: Person-Cat Links May Orphan on Re-Export**
- If owner info changes, old person_id on appointments persists but new ones get new person
- Not actually a problem — historical data is preserved
- **No action needed**

---

## Best Practices Research (2026-02-19)

### Entity Resolution Research Findings

**Source:** Analysis of Splink, dedupe.io, healthcare MPI systems, and Fellegi-Sunter literature.

#### 1. Weight Calibration — Move from Fixed Percentages to m/u Probabilities

**Current Atlas:** Email 40%, Phone 25%, Name 25%, Address 10%

**Industry Best Practice:** Calculate weights dynamically using log2(m/u):

| Field | m (match prob) | u (coincidence prob) | Weight |
|-------|---------------|---------------------|--------|
| Email (exact) | 0.97 | 0.0005 | ~11 points |
| Phone (exact) | 0.95 | 0.002 | ~9 points |
| Name (exact) | 0.90 | 0.005 | ~7 points |
| Name (fuzzy) | 0.70 | 0.02 | ~5 points |
| Address | 0.80 | 0.01 | ~6 points |

**Key insight:** The u-probability (chance of random agreement) is what makes email so powerful. Common names have much higher collision rates.

#### 2. Value-Frequency Weighting (TF-IDF for Names)

Common names like "Katie Moore" or "John Smith" should receive **lower match weights** than rare names like "Xenophon Papadopoulos". Soft TF-IDF showed ~1,200 additional true matches without false positives in production datasets.

**Recommendation:** Add name frequency table for weighted scoring:

```sql
-- Track name frequencies for TF-IDF weighting
CREATE TABLE IF NOT EXISTS sot.name_frequencies AS
SELECT LOWER(display_name) as name_norm, COUNT(*) as frequency
FROM sot.people WHERE merged_into_person_id IS NULL
GROUP BY LOWER(display_name);

-- Weight calculation: rare names get bonus, common names get penalty
-- name_weight = base_weight * log(total_names / name_frequency)
```

#### 3. Threshold Calibration — Industry Standard

| Zone | Score Range | Action | Atlas Status |
|------|-------------|--------|--------------|
| Auto-Match | > 0.95 probability (weight > +4) | Automatic merge | ✅ Implemented |
| Review Queue | 0.5 to 0.95 | Human verification | ⚠️ Queue exists, unused |
| Auto-Reject | < 0.5 (weight < 0) | No match | ✅ Implemented |

#### 4. Blocking Strategies (Multi-Pass)

Best practice: Use multiple blocking passes with different keys:
- First name + DOB
- Last name + phone prefix
- Email domain + first name initial
- Address ZIP + last name

**Atlas Current:** `data_engine_score_candidates()` uses email/phone lookup + name similarity. Could add explicit blocking keys for efficiency.

#### 5. Same-Name Different-People Protection (Katie Moore Case)

The two Katie Moores demonstrate the system working correctly:
- Different emails → scored as different people
- Different phones → scored as different people
- Name match alone never auto-links (CLAUDE.md INV-5)

**Additional safeguard (recommended):** Value-frequency weighting would further reduce "Katie Moore" match weight since it's a common name combination.

### Data Pipeline Research Findings

**Source:** PostgreSQL patterns, MDM survivorship documentation, ETL architecture guides.

#### 1. Source Record Mapping for ID Changes

When ClinicHQ renames an account (like Dahlia & Sage → Jessica Gonzalez), track the change:

```sql
CREATE TABLE IF NOT EXISTS source.source_record_mappings (
  mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,  -- 'person', 'place', 'cat'
  entity_id UUID NOT NULL,
  source_system TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  previous_source_record_id TEXT,  -- If ID changed
  change_reason TEXT,  -- 'initial', 'id_change', 'account_rename'
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_to TIMESTAMPTZ,  -- NULL = current
  is_current BOOLEAN DEFAULT TRUE
);
```

**Benefit:** Preserves audit trail when upstream systems change data.

#### 2. DLQ with Exponential Backoff

Current `quarantine.failed_records` exists but lacks retry scheduling:

```sql
-- Add retry columns to existing DLQ
ALTER TABLE quarantine.failed_records ADD COLUMN IF NOT EXISTS
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  backoff_interval INTERVAL GENERATED ALWAYS AS (
    INTERVAL '5 minutes' * POWER(3, LEAST(retry_count, 5))
  ) STORED;
```

#### 3. Event Sourcing Assessment

**Research finding:** Full event sourcing is overkill for Atlas. The current `entity_edits` audit trail is the right approach. Only add snapshots for lifecycle events (create, merge, ownership_transfer), not every field change.

#### 4. Field-Level Provenance

`cat_field_sources` (MIG_620) is already excellent. If needed for people/places, generalize the pattern rather than creating new infrastructure.

---

## Executive Summary

This plan addresses all data gaps discovered in the V2 audit and implements industry-standard patterns for:

1. **Entity Resolution** — Fellegi-Sunter scoring with hybrid blocking
2. **Pipeline Architecture** — Staged records, DLQ, idempotent processing
3. **Volunteer Management** — Temporal role tracking, external sync
4. **Event Sourcing** — Lifecycle events for cats
5. **Colony Estimation** — Chapman mark-recapture with confidence intervals

### Current State Summary

| Metric | Count | Status |
|--------|-------|--------|
| Cats | 40,220 | ✅ Healthy |
| People | 10,578 | ✅ Healthy |
| Places | 7,838 | ✅ Healthy |
| Appointments | 38,762 | ✅ Healthy |
| **Volunteers matched** | 178/1,346 | ⚠️ 13% - needs fix |
| **Staged records pending** | 4,741 | ⚠️ Processing needed |
| **Cat intake events** | 0 | ❌ Not populated |
| **Colony estimates** | 0 | ❌ Not calculated |
| **ops.volunteers** | 0 | ❌ Not populated |

---

## Phase 1: Foundation Fixes ✅ COMPLETE

### 1.1 Data Engine Review Queue

**Pattern:** Industry-standard review queue for uncertain matches (Fellegi-Sunter threshold zone)

```sql
-- MIG_2360: Data Engine Review Queue
CREATE TABLE IF NOT EXISTS sot.match_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Candidate pair
  record_a_table TEXT NOT NULL,  -- 'volunteerhub_volunteers', 'clinichq_raw', etc.
  record_a_id TEXT NOT NULL,
  record_b_table TEXT NOT NULL,  -- 'sot.people'
  record_b_id UUID NOT NULL,

  -- Scoring breakdown (for explainability)
  match_score NUMERIC(5,3) NOT NULL,
  match_weights JSONB NOT NULL,  -- {"email": 9.9, "phone": 7.5, "name": 5.3}
  blocking_key TEXT,             -- What blocked these together

  -- Resolution
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deferred')),
  resolution TEXT,  -- 'merge', 'separate', 'need_more_info'
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Metadata
  source_system TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(record_a_table, record_a_id, record_b_table, record_b_id)
);

CREATE INDEX idx_review_queue_pending
  ON sot.match_review_queue(status, match_score DESC)
  WHERE status = 'pending';

COMMENT ON TABLE sot.match_review_queue IS
'Review queue for uncertain entity matches. Records with scores in threshold zone (8-15)
queue here for human review. Based on Fellegi-Sunter probabilistic matching pattern.';
```

### 1.2 Dead Letter Queue for Failed Records

**Pattern:** PostgreSQL-native DLQ with SKIP LOCKED for concurrent workers

```sql
-- MIG_2361: Pipeline Dead Letter Queue
CREATE TABLE IF NOT EXISTS ops.pipeline_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  source_system TEXT NOT NULL,
  source_table TEXT,
  source_record_id TEXT,
  raw_payload JSONB NOT NULL,

  -- Error tracking
  error_type TEXT NOT NULL,  -- 'validation', 'api_error', 'schema_mismatch', 'timeout'
  error_message TEXT NOT NULL,
  error_context JSONB,  -- Stack trace, request details, etc.

  -- Retry management
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'resolved', 'abandoned')),
  attempt_count INT DEFAULT 1,
  max_attempts INT DEFAULT 3,
  next_retry_at TIMESTAMPTZ,

  -- Resolution
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  last_attempt_at TIMESTAMPTZ DEFAULT now()
);

-- Exponential backoff retry intervals: 1hr, 4hr, 24hr
CREATE INDEX idx_dlq_retry
  ON ops.pipeline_dlq(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

-- Function to get next batch with SKIP LOCKED (prevents race conditions)
CREATE OR REPLACE FUNCTION ops.dlq_get_retry_batch(p_batch_size INT DEFAULT 50)
RETURNS SETOF ops.pipeline_dlq
LANGUAGE sql AS $$
  SELECT * FROM ops.pipeline_dlq
  WHERE status IN ('pending', 'retrying')
    AND (next_retry_at IS NULL OR next_retry_at <= now())
    AND attempt_count < max_attempts
  ORDER BY created_at
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED;
$$;

-- Function to record failure with backoff
CREATE OR REPLACE FUNCTION ops.dlq_record_failure(
  p_source_system TEXT,
  p_source_record_id TEXT,
  p_payload JSONB,
  p_error_type TEXT,
  p_error_message TEXT,
  p_error_context JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_attempt INT;
  v_backoff INTERVAL;
BEGIN
  -- Upsert with attempt tracking
  INSERT INTO ops.pipeline_dlq (
    source_system, source_record_id, raw_payload,
    error_type, error_message, error_context
  ) VALUES (
    p_source_system, p_source_record_id, p_payload,
    p_error_type, p_error_message, p_error_context
  )
  ON CONFLICT (source_system, source_record_id)
  WHERE source_record_id IS NOT NULL
  DO UPDATE SET
    attempt_count = ops.pipeline_dlq.attempt_count + 1,
    error_message = p_error_message,
    error_context = p_error_context,
    last_attempt_at = now(),
    next_retry_at = now() + (INTERVAL '1 hour' * POWER(2, ops.pipeline_dlq.attempt_count))
  RETURNING id, attempt_count INTO v_id, v_attempt;

  RETURN v_id;
END;
$$;
```

### 1.3 Fix VolunteerHub Matching Function

**Pattern:** Hybrid deterministic + probabilistic matching with review queue

```sql
-- MIG_2362: Fix VolunteerHub Matching with Industry Patterns
CREATE OR REPLACE FUNCTION sot.match_volunteerhub_volunteer(p_volunteerhub_id TEXT)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_vol RECORD;
  v_person_id UUID;
  v_match_score NUMERIC := 0;
  v_match_weights JSONB := '{}'::JSONB;
  v_method TEXT;
  v_candidate RECORD;
  v_is_blacklisted BOOLEAN;

  -- Fellegi-Sunter thresholds
  c_auto_match_threshold CONSTANT NUMERIC := 15.0;
  c_review_threshold CONSTANT NUMERIC := 8.0;

  -- Field weights (log2(m/u))
  c_email_weight CONSTANT NUMERIC := 9.9;   -- m=0.95, u=0.001
  c_phone_weight CONSTANT NUMERIC := 7.5;   -- m=0.90, u=0.005
  c_name_exact_weight CONSTANT NUMERIC := 5.3;
  c_name_fuzzy_weight CONSTANT NUMERIC := 2.5;
BEGIN
  -- Get volunteer record
  SELECT * INTO v_vol
  FROM source.volunteerhub_volunteers
  WHERE volunteerhub_id = p_volunteerhub_id;

  IF v_vol IS NULL THEN RETURN NULL; END IF;

  -- Respect locked matches
  IF v_vol.match_locked AND v_vol.matched_person_id IS NOT NULL THEN
    RETURN v_vol.matched_person_id;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- STAGE 1: Deterministic Blocking (find candidates efficiently)
  -- ═══════════════════════════════════════════════════════════════

  -- Strategy 1: Exact email match (deterministic, highest confidence)
  IF v_vol.email_norm IS NOT NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist WHERE identifier_type = 'email' AND identifier_norm = v_vol.email_norm
    ) INTO v_is_blacklisted;

    IF NOT v_is_blacklisted THEN
      SELECT p.person_id INTO v_person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = v_vol.email_norm
        AND p.merged_into_person_id IS NULL
        AND NOT sot.is_organization_name(p.display_name)
      LIMIT 1;

      IF v_person_id IS NOT NULL THEN
        v_match_score := c_email_weight;
        v_match_weights := jsonb_build_object('email_exact', c_email_weight);
        v_method := 'email_deterministic';
        -- Score > 15, auto-match
      END IF;
    END IF;
  END IF;

  -- Strategy 2: Exact phone match
  IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist WHERE identifier_type = 'phone' AND identifier_norm = v_vol.phone_norm
    ) INTO v_is_blacklisted;

    IF NOT v_is_blacklisted THEN
      SELECT p.person_id INTO v_person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = v_vol.phone_norm
        AND p.merged_into_person_id IS NULL
        AND NOT sot.is_organization_name(p.display_name)
      LIMIT 1;

      IF v_person_id IS NOT NULL THEN
        v_match_score := c_phone_weight;
        v_match_weights := jsonb_build_object('phone_exact', c_phone_weight);
        v_method := 'phone_deterministic';
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- STAGE 2: Probabilistic Scoring (for candidates without exact ID match)
  -- ═══════════════════════════════════════════════════════════════

  IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
    -- Find candidates by name blocking
    FOR v_candidate IN
      SELECT p.person_id, p.display_name, p.first_name, p.last_name
      FROM sot.people p
      WHERE p.merged_into_person_id IS NULL
        AND NOT sot.is_organization_name(p.display_name)
        AND (
          -- Name blocking: same first 2 chars of last name + first initial
          (LEFT(LOWER(p.last_name), 2) = LEFT(LOWER(v_vol.last_name), 2)
           AND LEFT(LOWER(p.first_name), 1) = LEFT(LOWER(v_vol.first_name), 1))
          OR
          -- Or exact name match
          (LOWER(p.display_name) = LOWER(v_vol.first_name || ' ' || v_vol.last_name))
        )
      LIMIT 10  -- Cap candidates per volunteer
    LOOP
      v_match_score := 0;
      v_match_weights := '{}'::JSONB;

      -- Score name match
      IF LOWER(v_candidate.display_name) = LOWER(v_vol.first_name || ' ' || v_vol.last_name) THEN
        v_match_score := v_match_score + c_name_exact_weight;
        v_match_weights := v_match_weights || jsonb_build_object('name_exact', c_name_exact_weight);
      ELSIF similarity(v_candidate.display_name, v_vol.first_name || ' ' || v_vol.last_name) > 0.7 THEN
        v_match_score := v_match_score + c_name_fuzzy_weight;
        v_match_weights := v_match_weights || jsonb_build_object('name_fuzzy', c_name_fuzzy_weight);
      END IF;

      -- Check if candidate has matching identifiers
      IF v_vol.email_norm IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM sot.person_identifiers pi
          WHERE pi.person_id = v_candidate.person_id
          AND pi.id_type = 'email'
          AND pi.id_value_norm = v_vol.email_norm
        ) THEN
          v_match_score := v_match_score + c_email_weight;
          v_match_weights := v_match_weights || jsonb_build_object('email_match', c_email_weight);
        END IF;
      END IF;

      IF v_vol.phone_norm IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM sot.person_identifiers pi
          WHERE pi.person_id = v_candidate.person_id
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = v_vol.phone_norm
        ) THEN
          v_match_score := v_match_score + c_phone_weight;
          v_match_weights := v_match_weights || jsonb_build_object('phone_match', c_phone_weight);
        END IF;
      END IF;

      -- Decision based on Fellegi-Sunter thresholds
      IF v_match_score >= c_auto_match_threshold THEN
        v_person_id := v_candidate.person_id;
        v_method := 'probabilistic_auto';
        EXIT;  -- Found confident match
      ELSIF v_match_score >= c_review_threshold THEN
        -- Queue for review
        INSERT INTO sot.match_review_queue (
          record_a_table, record_a_id, record_b_table, record_b_id,
          match_score, match_weights, blocking_key, source_system
        ) VALUES (
          'source.volunteerhub_volunteers', p_volunteerhub_id,
          'sot.people', v_candidate.person_id,
          v_match_score, v_match_weights,
          LEFT(LOWER(v_vol.last_name), 2) || '/' || LEFT(LOWER(v_vol.first_name), 1),
          'volunteerhub'
        ) ON CONFLICT DO NOTHING;

        v_method := 'queued_for_review';
      END IF;
    END LOOP;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- STAGE 3: Create skeleton if no match found
  -- ═══════════════════════════════════════════════════════════════

  IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
    -- Check if queued for review - don't create skeleton if review pending
    IF NOT EXISTS (
      SELECT 1 FROM sot.match_review_queue
      WHERE record_a_table = 'source.volunteerhub_volunteers'
      AND record_a_id = p_volunteerhub_id
      AND status = 'pending'
    ) THEN
      v_person_id := sot.create_skeleton_person(
        p_first_name := v_vol.first_name,
        p_last_name := v_vol.last_name,
        p_address := CONCAT_WS(', ', NULLIF(v_vol.address, ''), NULLIF(v_vol.city, ''), NULLIF(v_vol.state, ''), NULLIF(v_vol.zip, '')),
        p_source_system := 'volunteerhub',
        p_source_record_id := p_volunteerhub_id,
        p_notes := 'VH volunteer - skeleton until verified'
      );
      v_method := 'skeleton_creation';
      v_match_score := 0;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Update source record
  -- ═══════════════════════════════════════════════════════════════

  UPDATE source.volunteerhub_volunteers
  SET
    matched_person_id = v_person_id,
    matched_at = CASE WHEN v_person_id IS NOT NULL THEN now() ELSE matched_at END,
    match_confidence = v_match_score / 20.0,  -- Normalize to 0-1
    match_method = v_method,
    sync_status = CASE
      WHEN v_person_id IS NOT NULL THEN 'matched'
      WHEN v_method = 'queued_for_review' THEN 'review_pending'
      ELSE 'unmatched'
    END,
    synced_at = now()
  WHERE volunteerhub_id = p_volunteerhub_id;

  -- Add volunteer role if matched
  IF v_person_id IS NOT NULL THEN
    INSERT INTO sot.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
    VALUES (v_person_id, 'volunteer', 'pending', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
    ON CONFLICT (person_id, role) DO UPDATE SET
      role_status = CASE WHEN sot.person_roles.role_status = 'active' THEN 'active' ELSE 'pending' END,
      updated_at = now();
  END IF;

  RETURN v_person_id;
END;
$$;
```

---

## Phase 2: Event Sourcing for Cats

### 2.1 Cat Lifecycle Events Table

**Pattern:** Event sourcing with materialized current state view

```sql
-- MIG_2363: Cat Lifecycle Events (Event Sourcing)
CREATE TABLE IF NOT EXISTS sot.cat_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),

  -- Event classification
  event_type TEXT NOT NULL CHECK (event_type IN (
    'intake', 'tnr_procedure', 'foster_start', 'foster_end',
    'adoption', 'return_to_field', 'transfer', 'mortality',
    'medical_hold_start', 'medical_hold_end', 'reunification'
  )),
  event_subtype TEXT,  -- e.g., 'owner_surrender', 'stray', 'spay', 'neuter'

  -- When
  event_at TIMESTAMPTZ NOT NULL,

  -- Related entities
  person_id UUID REFERENCES sot.people(person_id),  -- Adopter, foster, surrenderer
  place_id UUID REFERENCES sot.places(place_id),    -- Location of event

  -- Event-specific data
  metadata JSONB DEFAULT '{}',

  -- Provenance
  source_system TEXT NOT NULL,
  source_record_id TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX idx_cat_events_cat ON sot.cat_lifecycle_events(cat_id, event_at DESC);
CREATE INDEX idx_cat_events_type ON sot.cat_lifecycle_events(event_type, event_at DESC);
CREATE INDEX idx_cat_events_place ON sot.cat_lifecycle_events(place_id, event_at DESC) WHERE place_id IS NOT NULL;

-- Materialized view for current status (derived from events)
CREATE MATERIALIZED VIEW sot.mv_cat_current_status AS
SELECT DISTINCT ON (cat_id)
  cat_id,
  event_type AS current_status,
  event_subtype AS status_detail,
  event_at AS status_since,
  person_id AS associated_person_id,
  place_id AS current_place_id
FROM sot.cat_lifecycle_events
ORDER BY cat_id, event_at DESC;

CREATE UNIQUE INDEX idx_mv_cat_status ON sot.mv_cat_current_status(cat_id);

-- Refresh function (call after batch inserts)
CREATE OR REPLACE FUNCTION sot.refresh_cat_status()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY sot.mv_cat_current_status;
$$;
```

### 2.2 Migrate Existing Data to Events

```sql
-- MIG_2364: Populate Cat Lifecycle Events from Existing Data

-- From cat_procedures (TNR events)
INSERT INTO sot.cat_lifecycle_events (cat_id, event_type, event_subtype, event_at, place_id, source_system, source_record_id, metadata)
SELECT
  cp.cat_id,
  'tnr_procedure',
  cp.procedure_type,  -- 'spay', 'neuter'
  cp.procedure_date,
  a.inferred_place_id,
  'clinichq',
  cp.appointment_id::text,
  jsonb_build_object(
    'appointment_number', a.appointment_number,
    'microchip', c.microchip
  )
FROM ops.cat_procedures cp
JOIN ops.appointments a ON a.appointment_id = cp.appointment_id
JOIN sot.cats c ON c.cat_id = cp.cat_id
WHERE cp.procedure_type IN ('spay', 'neuter')
ON CONFLICT DO NOTHING;

-- From ShelterLuv staged records (intake/outcome events)
-- Will be populated by process_shelterluv_events function

COMMENT ON TABLE sot.cat_lifecycle_events IS
'Event-sourced cat tracking. Each row is an immutable event.
Current status derived from most recent event per cat.
Pattern: Martin Fowler Event Sourcing.';
```

---

## Phase 3: Colony Estimation

### 3.1 Chapman Estimator Implementation

**Pattern:** Mark-recapture with confidence intervals stored per estimate

```sql
-- MIG_2365: Colony Estimation with Chapman Mark-Recapture

CREATE TABLE IF NOT EXISTS beacon.colony_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES sot.places(place_id),

  -- Point estimate
  estimated_population INT NOT NULL,

  -- 95% Confidence interval
  ci_lower INT NOT NULL,
  ci_upper INT NOT NULL,

  -- Chapman estimator inputs (for reproducibility)
  marked_count INT NOT NULL,      -- M: cats TNR'd at location
  capture_count INT NOT NULL,     -- C: cats observed in period
  recapture_count INT NOT NULL,   -- R: previously TNR'd cats re-observed

  -- Quality indicators
  estimation_method TEXT NOT NULL DEFAULT 'chapman',
  observation_period_days INT,
  sample_adequate BOOLEAN,  -- R >= 7 per Robson & Regier
  confidence_level NUMERIC(3,2) DEFAULT 0.95,

  -- Temporal
  estimation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  observation_start DATE,
  observation_end DATE,

  -- Source
  source_type TEXT NOT NULL CHECK (source_type IN ('calculated', 'caretaker_report', 'staff_observation')),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_colony_place_date ON beacon.colony_estimates(place_id, estimation_date DESC);

-- Chapman estimator function
CREATE OR REPLACE FUNCTION beacon.calculate_chapman_estimate(
  p_marked INT,      -- M: cats TNR'd
  p_captured INT,    -- C: cats observed
  p_recaptured INT   -- R: cats recaptured (previously marked)
) RETURNS TABLE(
  estimate INT,
  ci_lower INT,
  ci_upper INT,
  sample_adequate BOOLEAN
)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_n_hat NUMERIC;
  v_variance NUMERIC;
  v_se NUMERIC;
BEGIN
  -- Guard against division by zero
  IF p_recaptured = 0 THEN
    RETURN QUERY SELECT
      NULL::INT, NULL::INT, NULL::INT, FALSE;
    RETURN;
  END IF;

  -- Chapman estimator (bias-corrected Lincoln-Petersen)
  v_n_hat := ((p_marked + 1.0) * (p_captured + 1.0) / (p_recaptured + 1.0)) - 1;

  -- Variance approximation
  v_variance := ((p_marked + 1.0) * (p_captured + 1.0) *
                 (p_marked - p_recaptured) * (p_captured - p_recaptured)) /
                ((p_recaptured + 1.0) * (p_recaptured + 1.0) * (p_recaptured + 2.0));

  v_se := sqrt(v_variance);

  RETURN QUERY SELECT
    round(v_n_hat)::INT,
    greatest(0, round(v_n_hat - 1.96 * v_se))::INT,
    round(v_n_hat + 1.96 * v_se)::INT,
    (p_recaptured >= 7);  -- Robson & Regier adequacy threshold
END;
$$;

-- Function to calculate and store estimate for a place
CREATE OR REPLACE FUNCTION beacon.estimate_colony_population(
  p_place_id UUID,
  p_observation_days INT DEFAULT 365
) RETURNS beacon.colony_estimates
LANGUAGE plpgsql AS $$
DECLARE
  v_marked INT;
  v_captured INT;
  v_recaptured INT;
  v_result RECORD;
  v_estimate beacon.colony_estimates;
BEGIN
  -- Count marked cats (TNR'd at this place)
  SELECT COUNT(DISTINCT cat_id) INTO v_marked
  FROM sot.cat_place cp
  WHERE cp.place_id = p_place_id;

  -- Count captured (seen at this place in observation period)
  SELECT COUNT(DISTINCT a.cat_id) INTO v_captured
  FROM ops.appointments a
  WHERE a.inferred_place_id = p_place_id
    AND a.appointment_date >= CURRENT_DATE - p_observation_days;

  -- Count recaptured (TNR'd cats seen again)
  SELECT COUNT(DISTINCT a.cat_id) INTO v_recaptured
  FROM ops.appointments a
  JOIN sot.cat_place cp ON cp.cat_id = a.cat_id AND cp.place_id = p_place_id
  WHERE a.inferred_place_id = p_place_id
    AND a.appointment_date >= CURRENT_DATE - p_observation_days;

  -- Calculate estimate
  SELECT * INTO v_result FROM beacon.calculate_chapman_estimate(v_marked, v_captured, v_recaptured);

  -- Store if valid
  IF v_result.estimate IS NOT NULL THEN
    INSERT INTO beacon.colony_estimates (
      place_id, estimated_population, ci_lower, ci_upper,
      marked_count, capture_count, recapture_count,
      observation_period_days, sample_adequate,
      observation_start, observation_end, source_type
    ) VALUES (
      p_place_id, v_result.estimate, v_result.ci_lower, v_result.ci_upper,
      v_marked, v_captured, v_recaptured,
      p_observation_days, v_result.sample_adequate,
      CURRENT_DATE - p_observation_days, CURRENT_DATE, 'calculated'
    )
    RETURNING * INTO v_estimate;
  END IF;

  RETURN v_estimate;
END;
$$;

-- Batch calculation for all places with cat activity
CREATE OR REPLACE FUNCTION beacon.calculate_all_colony_estimates()
RETURNS TABLE(place_id UUID, estimate INT, ci_range TEXT, adequate BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_place RECORD;
  v_result beacon.colony_estimates;
BEGIN
  FOR v_place IN
    SELECT DISTINCT cp.place_id
    FROM sot.cat_place cp
    JOIN sot.places p ON p.place_id = cp.place_id
    WHERE p.merged_into_place_id IS NULL
  LOOP
    v_result := beacon.estimate_colony_population(v_place.place_id);
    IF v_result.id IS NOT NULL THEN
      RETURN QUERY SELECT
        v_result.place_id,
        v_result.estimated_population,
        v_result.ci_lower || '-' || v_result.ci_upper,
        v_result.sample_adequate;
    END IF;
  END LOOP;
END;
$$;
```

---

## Phase 4: Volunteer Pipeline

### 4.1 Temporal Role Tracking

**Pattern:** Period columns with EXCLUDE constraint for non-overlapping memberships

```sql
-- MIG_2366: Temporal Volunteer Group Membership

-- Ensure proper temporal tracking on group memberships
ALTER TABLE source.volunteerhub_group_memberships
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ DEFAULT 'infinity';

-- Update existing records
UPDATE source.volunteerhub_group_memberships
SET valid_from = COALESCE(joined_at, created_at),
    valid_to = COALESCE(left_at, 'infinity')
WHERE valid_from IS NULL;

-- Add exclusion constraint to prevent overlapping memberships
-- (requires btree_gist extension)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- View for active memberships
CREATE OR REPLACE VIEW source.v_active_group_memberships AS
SELECT vgm.*, vug.name as group_name, vug.atlas_role
FROM source.volunteerhub_group_memberships vgm
JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
WHERE vgm.valid_to = 'infinity' OR vgm.valid_to > now();
```

### 4.2 Populate ops.volunteers

```sql
-- MIG_2367: Populate ops.volunteers from Matched Source Data

CREATE OR REPLACE FUNCTION ops.sync_volunteers_from_source()
RETURNS TABLE(inserted INT, updated INT, errors INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_errors INT := 0;
BEGIN
  -- Upsert from matched volunteerhub records
  INSERT INTO ops.volunteers (
    person_id, volunteerhub_id, status,
    is_trapper, is_foster, is_clinic_volunteer, is_coordinator,
    trapper_type, groups, source_system, joined_at
  )
  SELECT
    vv.matched_person_id,
    vv.volunteerhub_id,
    COALESCE(vv.status, 'active'),
    -- Check role assignments
    EXISTS (SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = vv.matched_person_id
            AND pr.role = 'trapper' AND pr.role_status = 'active'),
    EXISTS (SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = vv.matched_person_id
            AND pr.role = 'foster' AND pr.role_status = 'active'),
    EXISTS (SELECT 1 FROM source.v_active_group_memberships vgm
            WHERE vgm.volunteerhub_id = vv.volunteerhub_id
            AND vgm.group_name ILIKE '%clinic%'),
    EXISTS (SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = vv.matched_person_id
            AND pr.role = 'staff' AND pr.role_status = 'active'),
    (SELECT pr.trapper_type FROM sot.person_roles pr
     WHERE pr.person_id = vv.matched_person_id AND pr.role = 'trapper' LIMIT 1),
    (SELECT ARRAY_AGG(vgm.group_name) FROM source.v_active_group_memberships vgm
     WHERE vgm.volunteerhub_id = vv.volunteerhub_id),
    'volunteerhub',
    vv.joined_at
  FROM source.volunteerhub_volunteers vv
  WHERE vv.matched_person_id IS NOT NULL
  ON CONFLICT (volunteerhub_id) DO UPDATE SET
    status = EXCLUDED.status,
    is_trapper = EXCLUDED.is_trapper,
    is_foster = EXCLUDED.is_foster,
    is_clinic_volunteer = EXCLUDED.is_clinic_volunteer,
    groups = EXCLUDED.groups,
    updated_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN QUERY SELECT v_inserted, v_updated, v_errors;
END;
$$;
```

---

## Phase 5: Process Pending Records

### 5.1 Batch Processing Functions

```sql
-- MIG_2368: Batch Processing for Staged Records

-- Process ShelterLuv animals in batches
CREATE OR REPLACE FUNCTION ops.process_staged_shelterluv_batch(p_batch_size INT DEFAULT 100)
RETURNS TABLE(processed INT, succeeded INT, failed INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_record RECORD;
  v_processed INT := 0;
  v_succeeded INT := 0;
  v_failed INT := 0;
BEGIN
  FOR v_record IN
    SELECT id, payload, source_row_id
    FROM ops.staged_records
    WHERE source_system = 'shelterluv'
      AND source_table = 'animals'
      AND is_processed = FALSE
    ORDER BY created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      -- Process animal
      PERFORM ops.process_shelterluv_animal_record(v_record.payload, v_record.source_row_id);

      -- Mark processed
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_staged_shelterluv_batch',
          processed_at = now()
      WHERE id = v_record.id;

      v_succeeded := v_succeeded + 1;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;

      -- Record to DLQ
      PERFORM ops.dlq_record_failure(
        'shelterluv',
        v_record.source_row_id,
        v_record.payload,
        'processing_error',
        SQLERRM,
        jsonb_build_object('stack', SQLSTATE)
      );

      -- Mark as failed
      UPDATE ops.staged_records
      SET processing_error = SQLERRM,
          is_processed = TRUE
      WHERE id = v_record.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_succeeded, v_failed;
END;
$$;

-- Process all pending in loop
CREATE OR REPLACE FUNCTION ops.process_all_pending_staged()
RETURNS TABLE(source TEXT, processed INT, succeeded INT, failed INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_batch_result RECORD;
  v_total_processed INT := 0;
  v_total_succeeded INT := 0;
  v_total_failed INT := 0;
BEGIN
  -- Process ShelterLuv animals
  LOOP
    SELECT * INTO v_batch_result FROM ops.process_staged_shelterluv_batch(100);
    EXIT WHEN v_batch_result.processed = 0;
    v_total_processed := v_total_processed + v_batch_result.processed;
    v_total_succeeded := v_total_succeeded + v_batch_result.succeeded;
    v_total_failed := v_total_failed + v_batch_result.failed;
  END LOOP;

  RETURN QUERY SELECT 'shelterluv'::TEXT, v_total_processed, v_total_succeeded, v_total_failed;

  -- Add more source processors here as needed
END;
$$;
```

---

## Implementation Order

| Phase | Migration | Description | Expected Impact |
|-------|-----------|-------------|-----------------|
| **1.1** | MIG_2360 | Match review queue | Enable human review for uncertain matches |
| **1.2** | MIG_2361 | Pipeline DLQ | Capture and retry failed records |
| **1.3** | MIG_2362 | Fix VH matching | Match 1,168 unmatched volunteers |
| **2.1** | MIG_2363 | Cat lifecycle events | Event sourcing foundation |
| **2.2** | MIG_2364 | Populate events | ~33,000 TNR events from procedures |
| **3.1** | MIG_2365 | Colony estimation | Chapman estimates for ~2,000 places |
| **4.1** | MIG_2366 | Temporal memberships | Track join/leave history |
| **4.2** | MIG_2367 | Populate ops.volunteers | 1,346 volunteer records |
| **5.1** | MIG_2368 | Batch processing | Process 4,741 pending records |

---

## Verification Queries

```sql
-- After all migrations, verify:

-- 1. Volunteer matching improved
SELECT sync_status, COUNT(*) FROM source.volunteerhub_volunteers GROUP BY 1;
-- Expected: matched >> unmatched

-- 2. ops.volunteers populated
SELECT COUNT(*) FROM ops.volunteers;
-- Expected: ~1,200+

-- 3. Cat lifecycle events populated
SELECT event_type, COUNT(*) FROM sot.cat_lifecycle_events GROUP BY 1 ORDER BY 2 DESC;
-- Expected: tnr_procedure ~33,000

-- 4. Colony estimates calculated
SELECT COUNT(*), AVG(estimated_population), AVG(ci_upper - ci_lower) as avg_ci_width
FROM beacon.colony_estimates;
-- Expected: 1,000+ places with estimates

-- 5. Staged records processed
SELECT source_system, is_processed, COUNT(*)
FROM ops.staged_records
GROUP BY 1, 2;
-- Expected: is_processed = TRUE for most

-- 6. DLQ manageable
SELECT status, COUNT(*) FROM ops.pipeline_dlq GROUP BY 1;
-- Expected: resolved >> pending
```

---

## Monitoring Queries

Add to admin dashboard:

```sql
-- Data pipeline health
CREATE VIEW ops.v_pipeline_health AS
SELECT
  'staged_pending' as metric,
  COUNT(*) FILTER (WHERE NOT is_processed) as value
FROM ops.staged_records

UNION ALL

SELECT 'dlq_pending', COUNT(*)
FROM ops.pipeline_dlq WHERE status = 'pending'

UNION ALL

SELECT 'review_queue_pending', COUNT(*)
FROM sot.match_review_queue WHERE status = 'pending'

UNION ALL

SELECT 'volunteers_unmatched', COUNT(*)
FROM source.volunteerhub_volunteers WHERE matched_person_id IS NULL

UNION ALL

SELECT 'cats_without_events', COUNT(*)
FROM sot.cats c
WHERE NOT EXISTS (SELECT 1 FROM sot.cat_lifecycle_events e WHERE e.cat_id = c.cat_id)
  AND c.merged_into_cat_id IS NULL;
```

---

## Summary

This plan implements industry-standard patterns:

| Pattern | Implementation | Source |
|---------|---------------|--------|
| **Fellegi-Sunter matching** | Scoring thresholds + review queue | Healthcare MPI |
| **Dead Letter Queue** | PostgreSQL with SKIP LOCKED | Robinhood pattern |
| **Event Sourcing** | cat_lifecycle_events + materialized view | Martin Fowler |
| **Chapman Estimator** | With confidence intervals | Mark-recapture literature |
| **Temporal tracking** | Period columns + EXCLUDE | SQL Server temporal tables |
| **Idempotent processing** | ON CONFLICT + batch functions | ETL best practices |

All patterns are PostgreSQL-native and appropriate for Atlas scale (~50K records).

---

## PRIORITIZED NEXT STEPS (Action Plan)

Based on the comprehensive review and research, here is the prioritized action plan:

### Immediate (Apply Now)

| # | Action | File | Expected Result |
|---|--------|------|-----------------|
| **1** | Apply MIG_2350 | `sql/schema/v2/MIG_2350__fix_volunteerhub_matching.sql` | ~1,200 volunteers matched (up from 178) |
| **2** | Verify two Katie Moores are correctly separate | Query below | Confirm scoring system working |

```bash
# Step 1: Apply MIG_2350
DB_URL=$(grep "^DATABASE_URL=" .env | cut -d"'" -f2)
psql "$DB_URL" -f sql/schema/v2/MIG_2350__fix_volunteerhub_matching.sql

# Step 2: Verify results
psql "$DB_URL" -c "SELECT sync_status, match_method, COUNT(*) FROM source.volunteerhub_volunteers GROUP BY 1, 2 ORDER BY 3 DESC;"
```

### Short-Term (This Week)

| # | Action | Migration | Purpose |
|---|--------|-----------|---------|
| **3** | Process VolunteerHub group roles | MIG_2351 | Create person_roles for trappers/fosters |
| **4** | Populate ops.volunteers | MIG_2352 | ~1,300 volunteer records |
| **5** | Add source_record_mappings table | MIG_2353 | Track ClinicHQ account renames |

### Medium-Term (After VH Complete)

| # | Action | Migration | Purpose |
|---|--------|-----------|---------|
| **6** | Process pending ShelterLuv animals | MIG_2354 | Clear 4,741 staged records |
| **7** | Populate cat lifecycle events | MIG_2355 | ~33,000 TNR procedure events |
| **8** | Add Chapman columns to colony_estimates | MIG_2356 | Enable mark-recapture calculations |
| **9** | Calculate colony estimates | MIG_2357 | Estimates for ~2,000 places |

### Future Enhancements (Optional)

| # | Action | Value | Complexity |
|---|--------|-------|------------|
| **10** | Add name frequency weighting (TF-IDF) | Reduces false positives for common names | Medium |
| **11** | Enhanced DLQ with exponential backoff | Better retry handling | Low |
| **12** | Review queue UI in admin | Human verification of uncertain matches | Medium |

---

## Dahlia & Sage Re-Export Checklist

When ready to rename ClinicHQ account and re-export:

```sql
-- PRE-EXPORT: Document current state
SELECT c.cat_id, c.name, c.microchip, c.clinichq_animal_id,
       a.appointment_date, a.appointment_number
FROM sot.cats c
JOIN ops.appointments a ON a.cat_id = c.cat_id
JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id)
WHERE pl.formatted_address ILIKE '%115%e%2nd%cloverdale%'
ORDER BY a.appointment_date DESC;
-- Save this output!

-- POST-EXPORT: Verify cat identity persisted
-- Run same query - cat_ids should be IDENTICAL
-- New appointments may have different person_id (Jessica Gonzalez) - that's OK

-- VERIFY: No duplicate cats created
SELECT microchip, COUNT(*) FROM sot.cats
WHERE merged_into_cat_id IS NULL
GROUP BY microchip HAVING COUNT(*) > 1;
-- Should return 0 rows
```

**Key invariant verified:** Cat identity persists through all source changes because microchip + clinichq_animal_id are immutable identifiers that the `find_or_create_cat_by_microchip()` function uses for matching.

---

## Phase 6: Reference Data Integration (Name Classification) ✅ COMPLETE

### Problem Statement

`classify_owner_name()` currently uses hardcoded patterns for detecting business names vs people names. This causes:
1. False positives: "John Carpenter" classified as business (INV-44)
2. False negatives: "World Of Carpets Santa Rosa" classified as person (DATA_GAP_033)
3. Maintenance burden: Manual regex patterns grow unwieldy

### Solution: Gazetteer-Based Classification

Use official US Census and SSA datasets as lookup tables for accurate name classification.

### Reference Data Sources

| Dataset | Records | Download URL | License | Update Frequency |
|---------|---------|--------------|---------|------------------|
| **US Census Surnames 2010** | 162,253 | `https://www2.census.gov/topics/genealogy/2010surnames/names.zip` | CC0 (Public Domain) | Decennial (2020 coming) |
| **SSA Baby Names** | ~100,364 unique | `https://www.ssa.gov/oact/babynames/names.zip` | CC0 (Public Domain) | Annual (May) |

### 6.1 Census Surnames Table

**Migration: MIG_2370**

```sql
-- Full Census surnames with frequency data for TF-IDF weighting
CREATE TABLE IF NOT EXISTS ref.census_surnames (
    name TEXT PRIMARY KEY,
    rank INTEGER NOT NULL,           -- National rank by frequency
    count INTEGER NOT NULL,          -- Frequency (occurrences nationally)
    prop100k NUMERIC(10,2),          -- Proportion per 100,000 population
    cum_prop100k NUMERIC(10,2),      -- Cumulative proportion
    pct_white NUMERIC(5,2),
    pct_black NUMERIC(5,2),
    pct_api NUMERIC(5,2),            -- Asian/Pacific Islander
    pct_aian NUMERIC(5,2),           -- American Indian/Alaska Native
    pct_2prace NUMERIC(5,2),         -- Two or more races
    pct_hispanic NUMERIC(5,2),
    census_year INTEGER DEFAULT 2010,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_census_surnames_lower ON ref.census_surnames (LOWER(name));
CREATE INDEX idx_census_surnames_rank ON ref.census_surnames (rank);
CREATE INDEX idx_census_surnames_count ON ref.census_surnames (count DESC);

COMMENT ON TABLE ref.census_surnames IS
'US Census Bureau 2010 surnames dataset. 162,253 surnames occurring 100+ times.
Used for: (1) Validating last names, (2) TF-IDF frequency weighting in identity matching,
(3) Preventing false-positive business classification for occupation surnames.
Source: https://www2.census.gov/topics/genealogy/2010surnames/names.zip
See INV-44, INV-45.';

-- Occupation surnames view (surnames that are also occupations)
CREATE VIEW ref.occupation_surnames AS
SELECT name, rank, count
FROM ref.census_surnames
WHERE LOWER(name) IN (
    'carpenter', 'baker', 'mason', 'miller', 'cook', 'hunter', 'fisher',
    'taylor', 'smith', 'cooper', 'porter', 'turner', 'walker', 'butler',
    'carter', 'parker', 'weaver', 'potter', 'sawyer', 'brewer', 'dyer',
    'barber', 'fowler', 'fuller', 'gardener', 'glover', 'thatcher',
    'chandler', 'collier', 'fletcher', 'forester', 'shepherd', 'slater',
    'wheeler', 'bowman', 'archer', 'painter', 'plumber', 'glazier',
    'roofer', 'draper'
);
```

### 6.2 SSA Baby Names Table

**Migration: MIG_2371**

```sql
-- Aggregated first names with gender and frequency data
CREATE TABLE IF NOT EXISTS ref.first_names (
    name TEXT PRIMARY KEY,
    total_count BIGINT NOT NULL,           -- Sum across all years
    peak_year INTEGER,                      -- Year with highest count
    peak_count INTEGER,                     -- Count in peak year
    first_year INTEGER,                     -- First year name appeared
    last_year INTEGER,                      -- Most recent year
    male_count BIGINT DEFAULT 0,
    female_count BIGINT DEFAULT 0,
    is_primarily_male BOOLEAN,              -- >70% male usage
    is_primarily_female BOOLEAN,            -- >70% female usage
    is_unisex BOOLEAN,                      -- 30-70% either gender
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_first_names_lower ON ref.first_names (LOWER(name));
CREATE INDEX idx_first_names_count ON ref.first_names (total_count DESC);

-- Raw yearly data (optional, for detailed analysis)
CREATE TABLE IF NOT EXISTS ref.ssa_names_by_year (
    name TEXT NOT NULL,
    sex CHAR(1) NOT NULL CHECK (sex IN ('M', 'F')),
    year INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (name, sex, year)
);

COMMENT ON TABLE ref.first_names IS
'SSA Baby Names aggregated from 1880-2024. ~100,364 unique names.
Used for: (1) Validating first names, (2) Distinguishing "John Carpenter" (person)
from "Carpenter" (ambiguous), (3) TF-IDF weighting for common vs rare names.
Source: https://www.ssa.gov/oact/babynames/names.zip
See INV-44, INV-45.';

-- Helper function for first name validation
CREATE OR REPLACE FUNCTION ref.is_common_first_name(p_name TEXT, p_min_count INT DEFAULT 1000)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM ref.first_names
        WHERE LOWER(name) = LOWER(p_name)
        AND total_count >= p_min_count
    );
$$;

-- Helper function for surname validation
CREATE OR REPLACE FUNCTION ref.is_census_surname(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM ref.census_surnames
        WHERE LOWER(name) = LOWER(p_name)
    );
$$;
```

### 6.3 Business Keywords Table

**Migration: MIG_2372**

```sql
-- Business indicator words (curated, not from reference data)
CREATE TABLE IF NOT EXISTS ref.business_keywords (
    keyword TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN (
        'suffix',       -- LLC, Inc, Corp
        'service',      -- Plumbing, Roofing
        'retail',       -- Store, Shop, Market
        'professional', -- Medical, Dental, Legal
        'trades',       -- Construction, Electric
        'food',         -- Restaurant, Cafe
        'real_estate',  -- Realty, Properties
        'automotive',   -- Auto, Tire, Glass
        'gas_station'   -- Chevron, Shell
    )),
    weight NUMERIC(3,2) DEFAULT 1.0,  -- Confidence weight (1.0 = strong indicator)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with comprehensive business keywords
INSERT INTO ref.business_keywords (keyword, category, weight) VALUES
    -- Business suffixes (very strong)
    ('llc', 'suffix', 1.0), ('inc', 'suffix', 1.0), ('corp', 'suffix', 1.0),
    ('co', 'suffix', 0.8), ('ltd', 'suffix', 1.0), ('llp', 'suffix', 1.0),

    -- Service industry (strong)
    ('plumbing', 'service', 1.0), ('roofing', 'service', 1.0),
    ('landscaping', 'service', 1.0), ('construction', 'service', 1.0),
    ('painting', 'service', 0.9), ('cleaning', 'service', 0.9),
    ('moving', 'service', 0.9), ('storage', 'service', 0.9),
    ('heating', 'service', 1.0), ('cooling', 'service', 1.0),
    ('hvac', 'service', 1.0), ('electric', 'trades', 1.0),
    ('electrical', 'trades', 1.0), ('fencing', 'service', 0.9),
    ('paving', 'service', 1.0), ('masonry', 'service', 1.0),
    ('concrete', 'service', 1.0), ('drywall', 'service', 1.0),
    ('insulation', 'service', 1.0), ('siding', 'service', 1.0),
    ('gutters', 'service', 1.0), ('pest', 'service', 0.9),
    ('locksmith', 'service', 1.0), ('towing', 'service', 1.0),
    ('welding', 'service', 1.0), ('machining', 'service', 1.0),
    ('printing', 'service', 0.9), ('signs', 'service', 0.9),
    ('graphics', 'service', 0.9), ('repair', 'service', 0.8),
    ('repairs', 'service', 0.8), ('service', 'service', 0.6),
    ('services', 'service', 0.6), ('surgery', 'professional', 1.0),
    ('tree', 'service', 0.7),  -- "Tree Surgery", "Tree Service"

    -- Retail
    ('store', 'retail', 0.9), ('shop', 'retail', 0.8),
    ('market', 'retail', 0.8), ('carpets', 'retail', 1.0),
    ('carpet', 'retail', 0.9), ('flooring', 'retail', 1.0),
    ('windows', 'retail', 0.8), ('doors', 'retail', 0.8),
    ('tile', 'retail', 0.9), ('supply', 'retail', 0.9),

    -- Professional services
    ('dental', 'professional', 1.0), ('medical', 'professional', 1.0),
    ('legal', 'professional', 1.0), ('accounting', 'professional', 1.0),
    ('insurance', 'professional', 0.9), ('consulting', 'professional', 0.9),
    ('realty', 'real_estate', 1.0), ('properties', 'real_estate', 0.9),
    ('apartments', 'real_estate', 1.0), ('rentals', 'real_estate', 0.9),

    -- Food service
    ('restaurant', 'food', 1.0), ('cafe', 'food', 0.9),
    ('diner', 'food', 1.0), ('bakery', 'food', 1.0),
    ('pizza', 'food', 0.9), ('grill', 'food', 0.8),
    ('bar', 'food', 0.7), ('tavern', 'food', 0.9),
    ('brewery', 'food', 1.0),

    -- Automotive
    ('auto', 'automotive', 0.9), ('automotive', 'automotive', 1.0),
    ('tire', 'automotive', 1.0), ('glass', 'automotive', 0.8),
    ('body', 'automotive', 0.6),  -- "Body Shop"

    -- Gas stations (by brand)
    ('chevron', 'gas_station', 1.0), ('shell', 'gas_station', 1.0),
    ('arco', 'gas_station', 1.0), ('texaco', 'gas_station', 1.0),
    ('exxon', 'gas_station', 1.0), ('mobil', 'gas_station', 1.0),
    ('valero', 'gas_station', 1.0)
ON CONFLICT (keyword) DO NOTHING;
```

### 6.4 Updated classify_owner_name() Function

**Migration: MIG_2373**

```sql
-- Enhanced classification using reference tables
CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_name TEXT;
    v_name_lower TEXT;
    v_words TEXT[];
    v_word_count INT;
    v_first_word TEXT;
    v_last_word TEXT;
    v_has_common_first_name BOOLEAN;
    v_has_census_surname BOOLEAN;
    v_business_score NUMERIC := 0;
    v_business_keywords TEXT[];
BEGIN
    IF p_display_name IS NULL OR TRIM(p_display_name) = '' THEN
        RETURN 'garbage';
    END IF;

    v_name := TRIM(p_display_name);
    v_name_lower := LOWER(v_name);
    v_words := string_to_array(regexp_replace(v_name_lower, '[^a-z ]', '', 'g'), ' ');
    v_words := array_remove(v_words, '');  -- Remove empty strings
    v_word_count := array_length(v_words, 1);

    IF v_word_count IS NULL OR v_word_count = 0 THEN
        RETURN 'garbage';
    END IF;

    v_first_word := v_words[1];
    v_last_word := v_words[v_word_count];

    -- =========================================================================
    -- STEP 1: Check reference data
    -- =========================================================================

    -- Is first word a common first name? (SSA data, 1000+ occurrences)
    SELECT ref.is_common_first_name(v_first_word, 1000) INTO v_has_common_first_name;

    -- Is last word a census surname?
    SELECT ref.is_census_surname(v_last_word) INTO v_has_census_surname;

    -- =========================================================================
    -- STEP 2: Business pattern detection (high priority)
    -- =========================================================================

    -- "World Of X" pattern (strong business indicator)
    IF v_name_lower ~ '^world\s+of\s' THEN
        RETURN 'organization';
    END IF;

    -- Collect business keywords and calculate score
    SELECT COALESCE(SUM(bk.weight), 0), ARRAY_AGG(bk.keyword)
    INTO v_business_score, v_business_keywords
    FROM ref.business_keywords bk
    WHERE v_name_lower ~ ('\m' || bk.keyword || '\M');

    -- Strong business indicators override name validation
    IF v_business_score >= 1.5 THEN
        RETURN 'organization';
    END IF;

    -- Single business keyword + no valid person name pattern
    IF v_business_score >= 0.8 AND NOT (v_has_common_first_name AND v_has_census_surname) THEN
        RETURN 'organization';
    END IF;

    -- Business keyword + 3+ words (e.g., "John Smith Plumbing")
    IF v_business_score >= 0.6 AND v_word_count >= 3 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 3: Organization patterns
    -- =========================================================================

    -- Business suffixes (LLC, Inc, etc.) - always organization
    IF v_name ~* '\m(LLC|Inc|Corp|Ltd|LLP|Foundation|Association|Society|Center)\M' THEN
        RETURN 'organization';
    END IF;

    -- "The X" pattern (The Humane Society, The Villages)
    IF v_name ~* '^The\s+' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- Animal/rescue org keywords
    IF v_name ~* '\m(Animal|Pet|Veterinary|Vet|Clinic|Rescue|Shelter|Humane)\M' THEN
        RETURN 'organization';
    END IF;

    -- Government/institution keywords
    IF v_name ~* '\m(County|City|Department|Hospital|Program|Project|Initiative)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 4: FFSC-specific site patterns
    -- =========================================================================

    IF v_name ~* '\mFFSC\M' OR v_name ~* '\mMHP\M' THEN
        RETURN 'site_name';
    END IF;

    -- Feline org keywords
    IF v_name ~* '\m(Feline|Felines|Ferals?)\M' THEN
        RETURN 'organization';
    END IF;

    -- Ranch/Farm/Estate (trapping sites)
    IF v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M' THEN
        RETURN 'site_name';
    END IF;

    -- =========================================================================
    -- STEP 5: Address patterns
    -- =========================================================================

    IF v_name ~ '^[0-9]+\s' THEN
        RETURN 'address';
    END IF;

    IF v_name ~* '\m(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Highway|Hwy)\M' THEN
        RETURN 'address';
    END IF;

    -- =========================================================================
    -- STEP 6: Garbage patterns
    -- =========================================================================

    IF v_word_count = 1 AND v_name = UPPER(v_name) AND LENGTH(v_name) > 3 THEN
        RETURN 'garbage';
    END IF;

    IF v_name ~ '^[0-9\s\-\.\(\)]+$' THEN
        RETURN 'garbage';
    END IF;

    IF v_name ~* '^(Unknown|N/A|NA|None|Test|TBD|TBA|Owner|Client|\?+)$' THEN
        RETURN 'garbage';
    END IF;

    -- =========================================================================
    -- STEP 7: Person validation using reference data
    -- =========================================================================

    -- Strong person signal: common first name + census surname
    IF v_has_common_first_name AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Moderate person signal: at least 2 words, one is a census surname
    IF v_word_count >= 2 AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Weak person signal: at least 2 words with reasonable length
    IF v_word_count >= 2
       AND LENGTH(v_words[1]) >= 2
       AND LENGTH(v_words[v_word_count]) >= 2 THEN
        RETURN 'likely_person';
    END IF;

    -- Single capitalized word that looks like a name
    IF v_word_count = 1 AND LENGTH(v_name) >= 2 AND v_name ~ '^[A-Z][a-z]+$' THEN
        RETURN 'likely_person';
    END IF;

    RETURN 'unknown';
END;
$$;
```

### 6.5 Data Loading Scripts

**File: `scripts/reference-data/load_census_surnames.sh`**

```bash
#!/bin/bash
# Download and load US Census 2010 Surnames

set -e

DATA_DIR="data/reference"
CENSUS_URL="https://www2.census.gov/topics/genealogy/2010surnames/names.zip"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# Download if not exists
if [ ! -f "Names_2010Census.csv" ]; then
    echo "Downloading Census surnames..."
    curl -L -o names.zip "$CENSUS_URL"
    unzip -o names.zip
fi

# Load into database
echo "Loading Census surnames into database..."
psql "$DATABASE_URL" << 'EOF'
-- Create temp table for loading
CREATE TEMP TABLE tmp_census_load (
    name TEXT,
    rank TEXT,
    count TEXT,
    prop100k TEXT,
    cum_prop100k TEXT,
    pctwhite TEXT,
    pctblack TEXT,
    pctapi TEXT,
    pctaian TEXT,
    pct2prace TEXT,
    pcthispanic TEXT
);

\copy tmp_census_load FROM 'Names_2010Census.csv' WITH (FORMAT csv, HEADER true);

-- Insert into target table with type conversion
INSERT INTO ref.census_surnames (name, rank, count, prop100k, cum_prop100k,
    pct_white, pct_black, pct_api, pct_aian, pct_2prace, pct_hispanic)
SELECT
    UPPER(name),
    NULLIF(rank, '(S)')::INT,
    NULLIF(count, '(S)')::INT,
    NULLIF(prop100k, '(S)')::NUMERIC,
    NULLIF(cum_prop100k, '(S)')::NUMERIC,
    NULLIF(pctwhite, '(S)')::NUMERIC,
    NULLIF(pctblack, '(S)')::NUMERIC,
    NULLIF(pctapi, '(S)')::NUMERIC,
    NULLIF(pctaian, '(S)')::NUMERIC,
    NULLIF(pct2prace, '(S)')::NUMERIC,
    NULLIF(pcthispanic, '(S)')::NUMERIC
FROM tmp_census_load
WHERE name IS NOT NULL AND name != ''
ON CONFLICT (name) DO UPDATE SET
    rank = EXCLUDED.rank,
    count = EXCLUDED.count,
    prop100k = EXCLUDED.prop100k;

SELECT 'Loaded ' || COUNT(*) || ' Census surnames' FROM ref.census_surnames;
EOF

echo "Done!"
```

**File: `scripts/reference-data/load_ssa_names.sh`**

```bash
#!/bin/bash
# Download and load SSA Baby Names

set -e

DATA_DIR="data/reference"
SSA_URL="https://www.ssa.gov/oact/babynames/names.zip"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# Download if not exists
if [ ! -d "names" ]; then
    echo "Downloading SSA baby names..."
    curl -L -o ssa_names.zip "$SSA_URL"
    unzip -o ssa_names.zip -d names
fi

# Load into database
echo "Loading SSA names into database..."
psql "$DATABASE_URL" << 'EOF'
-- Create temp table for raw data
CREATE TEMP TABLE tmp_ssa_load (
    name TEXT,
    sex CHAR(1),
    count INT
);

-- Load each year file
DO $$
DECLARE
    v_year INT;
    v_file TEXT;
BEGIN
    FOR v_year IN 1880..2024 LOOP
        v_file := 'names/yob' || v_year || '.txt';

        BEGIN
            EXECUTE format('COPY tmp_ssa_load FROM %L WITH (FORMAT csv)', v_file);

            INSERT INTO ref.ssa_names_by_year (name, sex, year, count)
            SELECT name, sex, v_year, count FROM tmp_ssa_load
            ON CONFLICT DO NOTHING;

            TRUNCATE tmp_ssa_load;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Skipping year %: %', v_year, SQLERRM;
        END;
    END LOOP;
END $$;

-- Aggregate into first_names table
INSERT INTO ref.first_names (name, total_count, peak_year, peak_count,
    first_year, last_year, male_count, female_count,
    is_primarily_male, is_primarily_female, is_unisex)
SELECT
    name,
    SUM(count) as total_count,
    (ARRAY_AGG(year ORDER BY count DESC))[1] as peak_year,
    MAX(count) as peak_count,
    MIN(year) as first_year,
    MAX(year) as last_year,
    SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END) as male_count,
    SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END) as female_count,
    SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::FLOAT /
        NULLIF(SUM(count), 0) > 0.7 as is_primarily_male,
    SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END)::FLOAT /
        NULLIF(SUM(count), 0) > 0.7 as is_primarily_female,
    SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::FLOAT /
        NULLIF(SUM(count), 0) BETWEEN 0.3 AND 0.7 as is_unisex
FROM ref.ssa_names_by_year
GROUP BY name
ON CONFLICT (name) DO UPDATE SET
    total_count = EXCLUDED.total_count,
    peak_year = EXCLUDED.peak_year,
    last_year = EXCLUDED.last_year,
    male_count = EXCLUDED.male_count,
    female_count = EXCLUDED.female_count;

SELECT 'Loaded ' || COUNT(*) || ' first names' FROM ref.first_names;
EOF

echo "Done!"
```

### 6.6 TF-IDF Name Frequency Weighting (Enhancement)

```sql
-- Optional: Add name frequency weighting to identity scoring
-- This reduces false-positive matches for common names like "John Smith"

CREATE OR REPLACE FUNCTION sot.get_name_frequency_weight(p_name TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_freq BIGINT;
    v_total BIGINT;
    v_idf NUMERIC;
BEGIN
    -- Get name frequency from census surnames
    SELECT count INTO v_freq
    FROM ref.census_surnames
    WHERE LOWER(name) = LOWER(p_name);

    IF v_freq IS NULL THEN
        -- Unknown name = rare = high weight
        RETURN 1.5;
    END IF;

    -- Get total population (sum of all surname counts)
    SELECT SUM(count) INTO v_total FROM ref.census_surnames;

    -- IDF = log(total / frequency)
    -- Normalized to range 0.5 (very common) to 1.5 (rare)
    v_idf := LN(v_total::NUMERIC / v_freq) / LN(v_total);

    RETURN GREATEST(0.5, LEAST(1.5, 0.5 + v_idf));
END;
$$;

COMMENT ON FUNCTION sot.get_name_frequency_weight(TEXT) IS
'Returns a TF-IDF weight for surname rarity. Common names (Smith, Johnson)
get lower weights (0.5-0.8), rare names get higher weights (1.2-1.5).
Used to reduce false-positive matches on common names in identity resolution.
See ATLAS_DATA_REMEDIATION_PLAN.md section 6.6.';
```

### 6.7 Verification Queries

```sql
-- After loading reference data, verify:

-- 1. Census surnames loaded
SELECT COUNT(*), MIN(rank), MAX(rank) FROM ref.census_surnames;
-- Expected: 162,253 surnames, ranks 1 to 162253

-- 2. SSA first names loaded
SELECT COUNT(*), SUM(total_count) FROM ref.first_names;
-- Expected: ~100,364 names, billions of total registrations

-- 3. Business keywords loaded
SELECT category, COUNT(*) FROM ref.business_keywords GROUP BY 1 ORDER BY 2 DESC;
-- Expected: ~80+ keywords across categories

-- 4. Classification working
SELECT
    name,
    sot.classify_owner_name(name) as classification
FROM (VALUES
    ('John Carpenter'),           -- Should be: likely_person (SSA + Census)
    ('Carpenter'),                -- Should be: unknown (ambiguous)
    ('John Carpenter Plumbing'),  -- Should be: organization (business keyword + 3 words)
    ('World Of Carpets'),         -- Should be: organization (World Of pattern)
    ('Atlas Tree Surgery'),       -- Should be: organization (surgery keyword)
    ('Maria Lopez'),              -- Should be: likely_person
    ('Unknown'),                  -- Should be: garbage
    ('123 Main St')               -- Should be: address
) AS t(name);

-- 5. Occupation surname safelist working
SELECT name, rank FROM ref.occupation_surnames ORDER BY rank;
-- Should show ~40 surnames with census ranks

-- 6. Name frequency weights
SELECT
    name,
    sot.get_name_frequency_weight(name) as weight
FROM (VALUES ('Smith'), ('Johnson'), ('Papadopoulos'), ('Zuckerberg')) AS t(name);
-- Smith/Johnson: ~0.5-0.6, rare names: ~1.3-1.5
```

### Migration Dependencies

```
MIG_2350 (VolunteerHub fix) ← No dependencies
MIG_2360 (Current - replace with ref tables) ← Replace with MIG_2373
MIG_2370 (Census surnames table) ← ref schema
MIG_2371 (SSA first names table) ← ref schema
MIG_2372 (Business keywords table) ← ref schema
MIG_2373 (Updated classify_owner_name) ← MIG_2370, MIG_2371, MIG_2372

Data loading scripts:
  load_census_surnames.sh ← After MIG_2370
  load_ssa_names.sh ← After MIG_2371
```

### Implementation Order

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create `ref` schema | Schema exists |
| 2 | Apply MIG_2370 (census_surnames table) | Table ready for data |
| 3 | Apply MIG_2371 (first_names table) | Table ready for data |
| 4 | Apply MIG_2372 (business_keywords table) | ~80 keywords seeded |
| 5 | Run load_census_surnames.sh | 162,253 surnames loaded |
| 6 | Run load_ssa_names.sh | ~100,364 first names loaded |
| 7 | Apply MIG_2373 (updated classify_owner_name) | Function uses ref tables |
| 8 | Verify with test queries | All classifications correct |
| 9 | Remove old MIG_2360 hardcoded tables | Clean up |

---

## Research Sources

- **Splink:** [github.com/moj-analytical-services/splink](https://github.com/moj-analytical-services/splink) - Probabilistic record linkage
- **Fellegi-Sunter m/u values:** [robinlinacre.com/m_and_u_values](https://www.robinlinacre.com/m_and_u_values/)
- **TF-IDF for Entity Resolution:** [Enigma Engineering Blog](https://medium.com/enigma-engineering/improving-entity-resolution-with-soft-tf-idf-algorithm-42e323565e60)
- **PostgreSQL SKIP LOCKED:** [Inferable Blog](https://www.inferable.ai/blog/posts/postgres-skip-locked)
- **MDM Survivorship:** [Profisee Blog](https://profisee.com/blog/mdm-survivorship/)
- **Optimized Entity Resolution Thresholds:** [PMC Article](https://pmc.ncbi.nlm.nih.gov/articles/PMC3900213/)
- **US Census Surnames 2010:** [census.gov](https://www.census.gov/data/developers/data-sets/surnames/2010.html)
- **SSA Baby Names Data:** [ssa.gov](https://www.ssa.gov/oact/babynames/limits.html)
