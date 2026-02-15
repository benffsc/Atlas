# V1 → V2 Data Gap Analysis

**Date:** Feb 14, 2026
**Purpose:** Document data that EXISTS in V2 but is NOT connected/displayed properly

> **NOTE:** This is a reference document. DO NOT copy data. The goal is to identify
> gaps where V2 data exists but the views/APIs don't surface it.

---

## Executive Summary

| Category | Data Exists | Connected to UI | Status |
|----------|-------------|-----------------|--------|
| Disease Status | 10 records | **YES** | **FIXED in MIG_2303, MIG_2304, MIG_2305** |
| Disease Badges | 1,981 test results | **YES** | **FIXED - 10 places show badges** |
| Cat-Place Relationship Types | 31,836 home | **YES** | **FIXED in MIG_2305** |
| Watch List | Unknown | YES | Working |
| Google Maps Entries | EXISTS | YES | Working |
| Colony Estimates | EXISTS | YES | Working (separate API) |
| Alteration History | EXISTS | YES | Working |

### Final Disease Data State
- **10 places** with disease_status (all `historical` - tests are 2+ years old)
- **17 positive cats** correctly counted at residential locations
- **3 cats** correctly excluded (at FFSC clinic - soft blacklisted)
- **1 cat** has no residential link (data gap - Cat 2 with appointment_site only)

---

## GAP 1: Disease Badges Not Connected ~~(CRITICAL)~~ **FIXED**

### What Exists (V2)

**`ops.place_disease_status` table - 13 records:**
| Place | Disease | Status | Positive Cats |
|-------|---------|--------|---------------|
| 1814 Empire Industrial Ct | FeLV | **confirmed_active** | 3 |
| 22570 Chianti Road | FeLV | historical | 7 |
| 1647 Rose Avenue | FeLV | historical | 2 |
| + 10 more | FeLV | historical | 1 each |

**`ops.cat_test_results` table - 1,981 records:**
- 1,442 FeLV tests
- 539 FIV tests

**`ops.disease_types` table - 5 disease types defined**

### What's Missing

In `ops.v_map_atlas_pins` (MIG_2300 lines 66-68):

```sql
-- Per-disease badges (placeholder - empty for now)
'[]'::JSONB as disease_badges,
0 as disease_count,
```

The view explicitly uses placeholder values instead of joining to `ops.place_disease_status`.

### Expected Behavior (from MIG_2116 comments)

```
Pipeline:
ops.cat_test_results + sot.cat_place → MIG_2116 → ops.place_disease_status
ops.place_disease_status → MIG_2110 → v_map_atlas_pins.disease_badges
```

MIG_2110 was supposed to update the view to include disease_badges, but MIG_2300 recreated
the view with placeholders when trapper schema was dropped.

### Fix Applied (MIG_2303)

**FIXED:** `sql/schema/v2/MIG_2303__fix_map_view_disease_join.sql`

The view now joins `ops.v_place_disease_summary`:

```sql
-- FIX: Disease summary join (was missing in MIG_2300)
LEFT JOIN ops.v_place_disease_summary ds ON ds.place_id = p.place_id

-- Disease badges from ops.v_place_disease_summary
COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
COALESCE(ds.active_disease_count, 0) as disease_count,

-- Pin style now checks computed disease status
WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.active_disease_count, 0) > 0 THEN 'disease'
```

---

## GAP 2: Pin Style Uses Boolean Flag Instead of Actual Disease Data **FIXED**

### Previous Behavior

The view only checked `sot.places.disease_risk` boolean, missing computed disease status.

### Fix Applied (MIG_2303)

**FIXED:** Now combines manual flag AND computed disease status:

```sql
WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.active_disease_count, 0) > 0 THEN 'disease'
```

Places with confirmed FeLV/FIV test results now show as disease pins even without manual flagging.

---

## DATA THAT IS PROPERLY CONNECTED

### Watch List ✓
- Uses `sot.places.watch_list` boolean flag
- Properly included in pin_style and pin_tier logic

### Google Maps Entries ✓
- View joins to `ops.google_map_entries`
- Aggregates into `google_summaries` JSONB array
- entry_count properly populated

### Requests ✓
- View joins to `ops.requests`
- Includes request_count, active_request_count, needs_trapper_count

### Intake Submissions ✓
- View joins to `ops.intake_submissions`
- Includes intake_count

### Alteration History ✓
- View joins to `sot.v_place_alteration_history`
- Includes total_altered, last_alteration_at

### Cat Counts ✓
- View joins to `sot.cat_place`
- Properly excludes merged cats

### People ✓
- View joins to `sot.person_place` + `sot.people`
- Includes role info from `ops.person_roles`

---

## TABLES IN V2 (Reference)

### Source of Truth (sot.*)
| Table | Purpose | Used by Map View |
|-------|---------|------------------|
| `sot.places` | All places | YES |
| `sot.addresses` | Geocoded addresses | YES |
| `sot.cats` | All cats | YES (via cat_place) |
| `sot.people` | All people | YES (via person_place) |
| `sot.cat_place` | Cat-place relationships | YES |
| `sot.person_place` | Person-place relationships | YES |
| `sot.place_colony_estimates` | Colony size estimates | NO (separate API) |
| `sot.v_place_alteration_history` | TNR history | YES |

### Operations (ops.*)
| Table | Purpose | Used by Map View |
|-------|---------|------------------|
| `ops.requests` | TNR requests | YES |
| `ops.intake_submissions` | Intake forms | YES |
| `ops.google_map_entries` | GM timeline notes | YES |
| `ops.place_disease_status` | Disease by place | **YES** (MIG_2303) |
| `ops.cat_test_results` | Test results | NO (feeds disease_status) |
| `ops.disease_types` | Disease definitions | NO (reference) |
| `ops.person_roles` | Volunteer roles | YES |

---

## ACTION ITEMS

1. ~~**Create MIG_2303** - Update `ops.v_map_atlas_pins` to include disease_badges~~ **DONE**
2. ~~**Create MIG_2304** - V2-compliant disease computation (soft blacklist, gated checks)~~ **DONE**
3. ~~**Create MIG_2305** - Fix cat_place relationship types (appointment_site → home)~~ **DONE**
4. ~~**Verify disease computation** - Run `ops.compute_place_disease_status()`~~ **DONE**
5. ~~**Fix soft blacklist** - Ensure all FFSC clinic locations are excluded~~ **DONE (7 places)**

---

## GAP 3: Cat-Place Relationship Types **FIXED (MIG_2305)**

### Problem
`link_cats_to_appointment_places()` was creating `appointment_site` relationships using
`inferred_place_id`, but `inferred_place_id` IS the owner's home address, NOT the clinic.

This caused 30,324 cats to have `appointment_site` relationships to residential addresses instead of
`home` relationships, which broke disease computation (it filters to residential types only).

### Fix Applied
- **MIG_2305**: Updated 29,210 records from `appointment_site` to `home`
- Updated `link_cats_to_appointment_places()` to use `home` relationship type
- Relationship distribution now: 31,836 `home`, 1,114 `appointment_site`

---

## GAP 4: FFSC Clinic Soft Blacklist **FIXED (MIG_2304)**

### Problem
1814 Empire Industrial Ct (FFSC clinic) was showing as having disease status, but cats are
TESTED there, not RESIDENT. Disease is ecological (where cats LIVE), not medical (where tested).

### Fix Applied
- **MIG_2304**: Created `sot.place_soft_blacklist` table
- Added 7 FFSC clinic/office locations to soft blacklist
- Created `sot.should_compute_disease_for_place()` gated check function
- Updated `ops.compute_place_disease_status()` to exclude blacklisted places

### Soft Blacklisted Locations
1. 1814 Empire Industrial Ct (main clinic)
2. 1814 Empire Industrial Ct Suite F
3. 1814A Empire Industrial Court
4. 636 Montgomery Road 1814 Empire Industrial Ct (data quality issue)
5. 1813 Empire Industrial Ct (adjacent)

---

## FILES REFERENCED

- `sql/schema/v2/MIG_2300__restore_map_views.sql` - Original view definition (had gap)
- `sql/schema/v2/MIG_2303__fix_map_view_disease_join.sql` - **FIX: Adds disease join**
- `sql/schema/v2/MIG_2304__v2_disease_computation_fix.sql` - **FIX: V2-compliant computation**
- `sql/schema/v2/MIG_2305__fix_cat_place_relationship_types.sql` - **FIX: Relationship types**
- `sql/schema/v2/MIG_2116__compute_disease_status.sql` - Disease computation (works)
- `sql/schema/v2/MIG_2110__disease_tracking_v2.sql` - Disease types setup

---

*Generated by V1→V2 migration audit, Feb 14 2026*
*Updated: MIG_2303, MIG_2304, MIG_2305 applied to fix disease data gaps*
