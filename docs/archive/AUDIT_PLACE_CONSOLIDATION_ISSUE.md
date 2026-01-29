# AUDIT: Place Consolidation Affecting Cat Counts

**Date**: January 2026
**Issue**: Addresses like "101 Fisher Lane" and "1008 Bellevue Ave" showing 100+ cats
**Root Cause**: Aggressive place consolidation merges cat data inappropriately

## Problem Summary

The system has a **place deduplication mechanism** (MIG_214) that merges places with similar normalized addresses. When places merge, ALL related data cascades to the "keep" place:

- `cat_place_relationships` → all cats from merged places go to one place
- `person_place_relationships` → all people from merged places link to one place
- `place_colony_estimates` → all colony estimates merge together

**Result**: A single address shows 100+ cats when in reality they may come from:
- Different units at the same building (apt #1, #2, #3 merged into building address)
- Different time periods (cats no longer there still linked)
- Different people's cats at the same street address

## How Cats Get Linked to Places

1. **Clinic Appointment Chain** (MIG_235):
   ```
   Cat (microchip) → Appointment owner email → Person → Person's address → Place
   ```

2. **Request Matching** (MIG_217):
   ```
   Cat matched to request → Request's place
   ```

3. **Internal Accounts** (MIG_304):
   ```
   Cat from "Forgotten Felines Foster" → FOSTER_ADOPT org (NOT to a place)
   ```

## Where Consolidation Happens

### 1. Address Normalization (MIG_214)
```sql
-- normalize_address() converts:
-- "101 Fisher Lane" → "101 fisher ln"
-- "101 FISHER LANE" → "101 fisher ln"
-- "101 Fisher Ln"   → "101 fisher ln"
```
This is **correct behavior** for deduping the same address.

### 2. Place Merging (MIG_256)
When duplicates are detected, `merge_places()` cascades ALL FK references:
```sql
UPDATE trapper.cat_place_relationships SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
UPDATE trapper.person_place_relationships SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
UPDATE trapper.place_colony_estimates SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
```

This is the **problem** - ecological data should NOT automatically consolidate.

### 3. Person-Place Creation (MIG_160)
People get linked to places by matching normalized addresses:
```sql
-- If multiple people have addresses normalizing to same value, they all link to same place
-- "101 Fisher Lane #4" and "101 Fisher Lane #5" → same normalized address → same place
```

## User's Intent (Clarified)

> "I never wanted it to directly change places, I wanted places to be very individualized,
> I wanted the formulas to act upon the data in a different table to get colonies,
> but these should be linked to places not made into places themselves"

**Translation**:
1. Places should remain individualized (no aggressive merging)
2. Colony/ecological calculations should work on SEPARATE data
3. Cats should be linked to places, but place merging shouldn't consolidate cat counts
4. Ecological statistics should be computed dynamically, not stored on places

## Current Design vs Intended Design

| Aspect | Current Design | Intended Design |
|--------|---------------|-----------------|
| Place deduplication | Merges places with same normalized address | Keep places separate, use normalized_address for matching only |
| Cat-place links | Follow place merges | Stay with original place, don't cascade |
| Colony estimates | Stored per place, merge together | Computed dynamically, not merged |
| Ecology stats | View aggregates by place_id | View should handle multi-place scenarios |

## Recommended Fixes

### 1. Stop Auto-Merging Places (Critical)
The `find_or_create_place_deduped()` function should:
- Find existing place by normalized address
- Return existing place_id for LINKAGE purposes
- NOT merge cat/person relationships automatically

### 2. Preserve Original Location in Relationships
Add `original_place_id` to `cat_place_relationships`:
```sql
ALTER TABLE trapper.cat_place_relationships
ADD COLUMN original_place_id UUID REFERENCES trapper.places(place_id);
```
This preserves where the cat was actually seen even if places get consolidated.

### 3. Ecology View Uses Original Locations
Update `v_place_ecology_stats` to use `original_place_id` when computing stats.

### 4. Colony Estimates Stay Independent
The `place_colony_estimates` table should NOT cascade when places merge.

## Immediate Investigation

Need to check these specific addresses:
- `101 Fisher Lane, Sonoma, CA 95476`
- `1008 Bellevue Ave, Santa Rosa, CA 95407`

Query to run:
```sql
-- Find cats linked to these places
SELECT p.formatted_address, COUNT(DISTINCT cpr.cat_id) as cat_count,
       array_agg(DISTINCT cpr.source_system) as sources
FROM trapper.places p
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.formatted_address ILIKE '%101 Fisher%' OR p.formatted_address ILIKE '%1008 Bellevue%'
GROUP BY p.place_id, p.formatted_address;

-- Check if these have merged places pointing to them
SELECT p.formatted_address,
       COUNT(merged.place_id) as merged_from_count,
       array_agg(merged.formatted_address) as merged_addresses
FROM trapper.places p
LEFT JOIN trapper.places merged ON merged.merged_into_place_id = p.place_id
WHERE p.formatted_address ILIKE '%101 Fisher%' OR p.formatted_address ILIKE '%1008 Bellevue%'
GROUP BY p.place_id, p.formatted_address;
```

## Files to Modify

| File | Change |
|------|--------|
| `MIG_305__preserve_original_places.sql` | Add original_place_id, stop cascading on merge |
| `MIG_214` | (Review) Ensure not over-merging |
| `MIG_256` | (Modify) Don't cascade cat_place_relationships |
| `v_place_ecology_stats` | Use original locations for stats |
