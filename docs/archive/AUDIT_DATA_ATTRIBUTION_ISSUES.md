# Data Attribution & Statistics Audit

**Date**: 2026-01-17
**Context**: Jean Worthey's place showed incorrect statistics - 97 cats caught but only 6 altered, despite her being a long-term TNR client since 2014.

---

## Executive Summary

The current statistics system has fundamental architectural issues that cause incorrect data display:

1. **Request-centric vs Place-centric**: Views designed for request attribution are being used for place-level statistics
2. **Time Window Confusion**: Attribution windows make sense for requests but not for place histories
3. **Year Grouping**: Stats grouped by request year, not procedure year

---

## Issue #1: Request-Centric Attribution Used for Place Statistics

### The Problem
`v_request_alteration_stats` was designed to answer: *"How many cats were done FOR this specific request?"*

But it's being used to answer: *"What is the complete TNR history at this place?"*

These are fundamentally different questions.

### How It Works Now

```sql
-- v_request_alteration_stats logic:
-- 1. Get request's place_id
-- 2. Find all cats linked to that place via cat_place_relationships
-- 3. Filter to cats with procedures in the attribution window
-- 4. "cats_altered" = cats altered AFTER request date
```

For Jean Worthey:
- Request created: Nov 2025
- Window: May 2025 - July 2026
- **cats_caught**: 97 (all cats ever at place - CORRECT for "place view")
- **cats_altered**: 6 (only cats altered after Nov 2025 - WRONG for "place view")

### Root Cause

The view conflates two concepts:
1. **Place-level totals**: All cats ever at this place
2. **Request attribution**: Which cats can be credited to this request

### Solution Options

**Option A: Separate Views (Recommended)**
- Keep `v_request_alteration_stats` for request-level attribution
- Create `v_place_cat_history` for place-level totals
- Each view serves its specific purpose

**Option B: Dual-mode View**
- Add a `mode` parameter to differentiate
- More complex, harder to maintain

---

## Issue #2: Yearly Breakdown Uses Request Year, Not Procedure Year

### The Problem

When displaying year-by-year breakdown, the system groups by when the REQUEST was created, not when cats were actually altered.

### Example

Jean Worthey's cats were altered:
- 2014: 29 cats
- 2015: 13 cats
- 2016: 18 cats
- 2017: 6 cats
- 2018: 3 cats
- 2020: 11 cats
- 2021: 11 cats
- 2025: 6 cats

But `v_place_alteration_history` showed:
```json
{ "2025": { "caught": 97, "altered": 6 } }
```

All 97 cats were attributed to 2025 because that's when her current request was created.

### Root Cause

`v_place_alteration_history` builds on `v_request_alteration_stats`, inheriting its request-year grouping.

### Solution

Query `cat_procedures` table directly, grouped by `EXTRACT(YEAR FROM procedure_date)`.

**Already Fixed**: MIG_311 addresses this by creating a place-centric view.

---

## Issue #3: "Caught" vs "Altered" Terminology Confusion

### The Problem

The UI shows:
- "97 Cats Caught"
- "6 Altered"
- "91 Pre-Altered"

This suggests 91 cats came in already fixed (pre-altered), which is misleading. In reality, Jean Worthey brought cats over 10+ years, all getting altered - just not all since November 2025.

### Root Cause

Terminology was designed for request attribution:
- "cats_caught" = total cats linked to place
- "cats_altered" = cats altered FOR this request
- "pre-altered" = cats altered before request date

For a place view, this language is confusing.

### Solution Options

**For Place Views:**
- "Total Cats Altered: 97"
- "This Year: 6"
- Remove "Pre-Altered" from place view (it's not meaningful)

**For Request Views:**
- Keep current terminology but clarify context

---

## Issue #4: Missing API Columns

### The Problem

Several API endpoints reference columns that don't exist in views:

1. **colony-estimates API**: Referenced `p_hat_chapman_pct`, `best_colony_estimate`, `estimated_work_remaining` - columns not in `v_place_ecology_stats`
2. **edges API**: Referenced `pb.name` instead of `pb.display_name`

### Root Cause

Views were updated but API code wasn't synchronized.

### Solution

**Already Fixed**: Updated APIs to match actual view columns.

---

## Issue #5: Attribution Window Complexity

### The Problem

The attribution window system (MIG_208) tries to handle multiple scenarios:
- Legacy Airtable requests (fixed 6-month window)
- Active requests (rolling window)
- Resolved requests (buffer after resolution)

This complexity causes confusion when the same data appears differently depending on request status.

### Current Window Logic

```sql
-- Legacy (Airtable): request_date ± 6 months
-- Active: request_date - 6mo to NOW + 6mo (rolling)
-- Resolved: request_date - 6mo to resolved_at + 3mo
```

### Questions to Consider

1. **Do we need windows at all for place statistics?**
   - Place history should show ALL alterations, regardless of windows

2. **Are windows only for request attribution?**
   - Makes sense for "crediting" cats to specific requests
   - Not for showing a place's complete history

3. **How do we handle overlapping requests at the same place?**
   - Currently cats can be "double counted" across requests
   - Is this intentional?

---

## Deep-Rooted Issues

### Issue A: Two Parallel Data Models

The system has two parallel ways of tracking cat-place relationships:

1. **Request-based**: `sot_requests.place_id` → cats linked to request
2. **Direct**: `cat_place_relationships` → cats directly linked to places

These can get out of sync or produce conflicting totals.

### Issue B: No Clear "Source of Truth" for Place Stats

Currently, place statistics are derived from:
- `cat_place_relationships` → which cats belong here
- `cat_procedures` → when they were altered
- `sot_requests` → which requests exist here
- Colony estimates → reported counts

No single view consolidates all sources authoritatively.

### Issue C: Legacy Data Integration

Historical data from Airtable was imported with different assumptions:
- Many records lack `source_created_at`
- Some have incorrect `place_id` mappings
- Window calculations may not apply to pre-import data

---

## Recommended Audit Approach

### Step 1: Clarify Data Model Intent
Answer these questions:
1. What is the authoritative source for "how many cats are at this place"?
2. What is the relationship between requests and place statistics?
3. Should place statistics be independent of request attribution?

### Step 2: Audit Existing Views
For each view, document:
- Purpose (what question does it answer?)
- Dependencies (what tables/views does it use?)
- Known issues

**Views to audit:**
- `v_request_alteration_stats`
- `v_place_alteration_history`
- `v_place_colony_status`
- `v_place_ecology_stats`
- `v_trapper_full_stats`

### Step 3: Identify Data Inconsistencies
Run queries to find places where:
- `cat_place_relationships` count differs from procedure count
- Colony estimates differ significantly from verified cat counts
- Requests have no associated cats but claim alterations

### Step 4: Propose Unified Model
Design a clear hierarchy:
1. **Place** → ground truth location
2. **Cat-Place Links** → which cats have been at this place
3. **Procedures** → what happened to each cat
4. **Requests** → operational tracking (separate from statistics)

### Step 5: Create Migration Plan
- Prioritize fixes that affect data display
- Minimize breaking changes to existing code
- Add comprehensive tests

---

## Fixes Already Applied (Revert if Needed)

### MIG_311: Fix Place Alteration History
- Changed `v_place_alteration_history` to query procedures directly
- Groups by procedure year, not request year
- Shows all-time stats, not windowed

**Impact**: Place detail pages now show correct yearly breakdown.

### API Fixes
1. `colony-estimates/route.ts`: Removed non-existent columns
2. `edges/route.ts`: Changed `pb.name` to `pb.display_name`

---

---

## Issue #6: ClinicHQ Owner Info Not Linked to Appointments (CRITICAL)

**Discovered**: Auditing Jean Worthey's January 12, 2026 cats

### The Problem

The January 12, 2026 appointments for Jean Worthey show **NULL** for `owner_email` and `owner_phone` in `sot_appointments`, even though the raw `staged_records.owner_info` contains complete contact information.

### Evidence

**Raw data in staged_records (owner_info):**
```
| appt_number | owner_first | owner_last | owner_email               | owner_phone | owner_address                           |
|-------------|-------------|------------|---------------------------|-------------|-----------------------------------------|
| 26-127      | Jean        | Worthey    | jean_worthey@peoplepc.com | 7075757767  | 3820 Selvage Road, Santa Rosa, CA 95401 |
| 26-128      | Jean        | Worthey    | jean_worthey@peoplepc.com | 7075757767  | 3820 Selvage Road, Santa Rosa, CA 95401 |
| ... (5 more) ...
```

**sot_appointments table:**
```
| appointment_number | owner_email | owner_phone | microchip       |
|--------------------|-------------|-------------|-----------------|
| 26-127             | NULL        | NULL        | 981020053928942 |
| 26-128             | NULL        | NULL        | 981020053870567 |
| ... (5 more) ...
```

### Root Cause

The `clinic_full_pipeline.mjs` pipeline:
1. ✅ Ingests `cat_info.xlsx` → creates cats
2. ✅ Ingests `owner_info.xlsx` → **stages only, doesn't link to appointments**
3. ✅ Ingests `appointment_info.xlsx` → creates appointments
4. ✅ Links cats to places via `a.person_id` → **but person_id is NULL!**

**The missing step**: Join `staged_records.owner_info` with `sot_appointments` by appointment number to populate:
- `owner_email`
- `owner_phone`
- `person_id` (via `find_or_create_person`)

### Why Place Linking Fails

The place linking query relies on:
```sql
FROM trapper.sot_appointments a
JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
```

But `a.person_id` is NULL for new appointments because owner info was never linked!

### Impact

- **All cats from recent clinic dates (post-pipeline fix)** may be unlinked to places
- Jean Worthey's 7 January 12 cats not linked to her place
- Colony statistics undercount recent activity
- Trappers don't get credit for cats done

### Solution

Add a step to `clinic_full_pipeline.mjs` (after ingesting owner_info):

```sql
-- Update sot_appointments with owner info from staged_records
UPDATE trapper.sot_appointments a
SET
  owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
  owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone'),
  person_id = (
    SELECT trapper.find_or_create_person(
      LOWER(TRIM(sr.payload->>'Owner Email')),
      trapper.norm_phone_us(sr.payload->>'Owner Phone'),
      sr.payload->>'Owner First Name',
      sr.payload->>'Owner Last Name',
      sr.payload->>'Owner Address',
      'clinichq'
    )
  )
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND a.owner_email IS NULL;
```

Then re-run the place linking query.

---

## Summary of All Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Request-centric attribution used for place stats | High | Needs fix |
| 2 | Yearly breakdown uses request year, not procedure year | High | **FIXED** (MIG_311) |
| 3 | "Caught" vs "Altered" terminology confusion | Medium | Needs fix |
| 4 | Missing API columns (colony-estimates, edges) | Low | **FIXED** |
| 5 | Attribution window complexity | Medium | Document/clarify |
| 6 | ClinicHQ owner_info not linked to appointments | **Critical** | Needs fix |

---

## Next Steps

1. [x] Document all issues (this file)
2. [ ] Fix Issue #6: Add owner_info linking step to clinic pipeline
3. [ ] Re-run place linking for affected appointments
4. [ ] Verify Jean Worthey's cats now link correctly
5. [ ] Decide on terminology fixes (Issue #3)
6. [ ] Audit other recent clinic dates for same issue
7. [ ] Add automated tests to catch this in future
