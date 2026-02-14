# V1 → V2 Data Gap Analysis

**Date:** Feb 14, 2026
**Purpose:** Document data that EXISTS in V2 but is NOT connected/displayed properly

> **NOTE:** This is a reference document. DO NOT copy data. The goal is to identify
> gaps where V2 data exists but the views/APIs don't surface it.

---

## Executive Summary

| Category | Data Exists | Connected to UI | Status |
|----------|-------------|-----------------|--------|
| Disease Status | 13 records | **YES** | **FIXED in MIG_2303** |
| Disease Badges | 1,981 test results | **YES** | **FIXED in MIG_2303** |
| Watch List | Unknown | YES | Working |
| Google Maps Entries | EXISTS | YES | Working |
| Colony Estimates | EXISTS | YES | Working (separate API) |
| Alteration History | EXISTS | YES | Working |

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

1. ~~**Create MIG_2303** - Update `ops.v_map_atlas_pins` to include disease_badges from `ops.place_disease_status`~~ **DONE**
2. **Verify disease computation** - Run `ops.compute_place_disease_status()` to ensure data is current
3. **Test map** - Verify 1814 Empire Industrial Ct shows disease pin (has confirmed_active FeLV)

---

## FILES REFERENCED

- `sql/schema/v2/MIG_2300__restore_map_views.sql` - Original view definition (had gap)
- `sql/schema/v2/MIG_2303__fix_map_view_disease_join.sql` - **FIX: Adds disease join**
- `sql/schema/v2/MIG_2116__compute_disease_status.sql` - Disease computation (works)
- `sql/schema/v2/MIG_2110__disease_tracking_v2.sql` - Disease types setup

---

*Generated by V1→V2 migration audit, Feb 14 2026*
*Updated: MIG_2303 created to fix disease badge gap*
