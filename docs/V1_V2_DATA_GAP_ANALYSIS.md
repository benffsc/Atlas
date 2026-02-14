# V1 → V2 Data Gap Analysis

**Date:** Feb 14, 2026
**Purpose:** Document data that EXISTS in V2 but is NOT connected/displayed properly

> **NOTE:** This is a reference document. DO NOT copy data. The goal is to identify
> gaps where V2 data exists but the views/APIs don't surface it.

---

## Executive Summary

| Category | Data Exists | Connected to UI | Gap |
|----------|-------------|-----------------|-----|
| Disease Status | 13 records | NO | View hardcodes empty |
| Disease Badges | 1,981 test results | NO | View hardcodes `'[]'` |
| Watch List | Unknown | YES | `sot.places.watch_list` used |
| Google Maps Entries | EXISTS | YES | View joins properly |
| Colony Estimates | EXISTS | YES | Separate table |
| Alteration History | EXISTS | YES | View joins properly |

---

## GAP 1: Disease Badges Not Connected (CRITICAL)

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

### Fix Needed

Update `ops.v_map_atlas_pins` to join to `ops.place_disease_status` and build `disease_badges` JSONB array:

```sql
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as disease_count,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'disease', disease_type_key,
      'status', status,
      'positive_count', positive_cat_count,
      'last_positive', last_positive_date
    )) as disease_badges
  FROM ops.place_disease_status
  GROUP BY place_id
) disease ON disease.place_id = p.place_id
```

And update the pin_style CASE to check `disease_count > 0`:
```sql
WHEN COALESCE(disease.disease_count, 0) > 0 THEN 'disease'
```

---

## GAP 2: Pin Style Uses Boolean Flag Instead of Actual Disease Data

### Current Behavior

The view uses `sot.places.disease_risk` boolean:

```sql
CASE
  WHEN COALESCE(p.disease_risk, FALSE) THEN 'disease'
  ...
END as pin_style
```

### Problem

- `disease_risk` is a manual flag on the place
- Actual disease status computed from test results is in `ops.place_disease_status`
- If `disease_risk = FALSE` but place has `confirmed_active` disease status, it won't show as disease pin

### Recommendation

Combine both:
```sql
WHEN COALESCE(p.disease_risk, FALSE)
     OR COALESCE(disease.disease_count, 0) > 0 THEN 'disease'
```

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
| `ops.place_disease_status` | Disease by place | **NO** (GAP) |
| `ops.cat_test_results` | Test results | NO (feeds disease_status) |
| `ops.disease_types` | Disease definitions | NO (reference) |
| `ops.person_roles` | Volunteer roles | YES |

---

## ACTION ITEMS

1. **Create MIG_2303** - Update `ops.v_map_atlas_pins` to include disease_badges from `ops.place_disease_status`
2. **Verify disease computation** - Run `ops.compute_place_disease_status()` to ensure data is current
3. **Test map** - Verify 1814 Empire Industrial Ct shows disease pin (has confirmed_active FeLV)

---

## FILES REFERENCED

- `sql/schema/v2/MIG_2300__restore_map_views.sql` - Current view definition (has gap)
- `sql/schema/v2/MIG_2116__compute_disease_status.sql` - Disease computation (works)
- `sql/schema/v2/MIG_2110__disease_tracking_v2.sql` - Disease types setup

---

*Generated by V1→V2 migration audit, Feb 14 2026*
