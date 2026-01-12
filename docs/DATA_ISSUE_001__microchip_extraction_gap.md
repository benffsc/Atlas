# DATA_ISSUE_001: Microchip Extraction Gap

**Severity:** CRITICAL
**Discovered:** 2026-01-10
**Status:** Documented, solution pending

## Summary

~32,311 valid microchips exist in staged data but are NOT searchable because they are not being extracted to canonical tables.

## Investigation

A search for microchip `981020053524791` (cat "Pricilla", owner "Daniel Figueroa", appt 4/2/2025) returned no results despite the data existing in the database.

### Root Cause

The cat extraction pipeline ONLY processes `clinichq.cat_info` records. However, microchip data exists in three source tables:

| Source | Unique Microchips | In Canonical | MISSING |
|--------|-------------------|--------------|---------|
| clinichq.cat_info | 8,011 | 8,011 | 0 |
| clinichq.appointment_info | 31,952 | 7,906 | **24,046** |
| petlink.pets | 8,280 | 15 | **8,265** |

### Why the Specific Microchip is Missing

1. `981020053524791` exists in:
   - `clinichq.appointment_info` (Appt #25-1139, 4/2/2025)
   - `petlink.pets` (registered to Daniel Figueroa)

2. It does NOT exist in `clinichq.cat_info`

3. Therefore the extraction pipeline never created a canonical cat or microchip identifier for it

### Data Quality Notes from ClinicHQ Record

The appointment record for Pricilla shows:
```
Internal Medical Notes: "Already altered, done in 2021. Had MC 981020039929054, gave another MC by mistake"
```
This indicates the cat had a previous microchip and received a second one at some point.

## Impact

- ~32,311 microchips cannot be found via search
- Cats seen at appointments but not registered in cat_info are invisible
- Petlink registration data (8,280 verified microchips) is completely unused
- Shelter adoption data (shelterluv.animals) may also have unextracted microchips

## Proposed Solution

### Phase 1: Extract cats from petlink.pets (HIGH VALUE)
- All 8,280 records have verified microchips
- Has owner contact info (email, address)
- Clean, structured data from microchip registry

### Phase 2: Extract microchips from clinichq.appointment_info
- 24,046 unique microchips not in cat_info
- May indicate cats seen at clinic but not formally registered
- Lower data quality (name often includes microchip in string like "Pricilla 981020053524791")

### Phase 3: Evaluate shelterluv.animals
- 3,134 animal records
- May contain additional microchips from shelter transfers

## Technical Notes

### Current Extraction Architecture

The cat extraction pipeline is defined in:
- `sql/migrations/MIG_019__upsert_cats_and_views.sql` - defines `upsert_cats_from_clinichq()`
- `scripts/post_ingest/atlas_012_upsert_cats.sh` - runner script

The function currently ONLY processes `clinichq.cat_info` records (lines 60-61 in MIG_019):
```sql
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'cat_info'
```

### Current Extraction Sources
```sql
SELECT source_system, source_table, COUNT(*)
FROM cat_identifiers
GROUP BY source_system, source_table;

-- Result:
-- clinichq | cat_info | 8629 (animal_id)
-- clinichq | cat_info | 8011 (microchip)
```

### Finding Microchip Data
```sql
-- Petlink pets (field: "Microchip")
SELECT payload->>'Microchip', payload->>'Name'
FROM staged_records WHERE source_system = 'petlink' AND source_table = 'pets';

-- ClinicHQ appointment_info (field: "Microchip Number")
SELECT payload->>'Microchip Number', payload->>'Animal Name'
FROM staged_records WHERE source_system = 'clinichq' AND source_table = 'appointment_info';
```

### Petlink Data Structure
```json
{
  "ID": "12657600",
  "Microchip": "981020053524791",
  "Name": "Pricilla 981020053524791",
  "Breed": "Domestic Mediumhair",
  "Owner": "18200020",
  "First Name": "Daniel",
  "Name_2": "Figueroa",
  "Email": "guidodaniela@yahoo.com",
  "City": "Santa Rosa",
  "State": "US.CA",
  "Zip Code": "95403",
  "Status": "Paid"
}
```

## Implementation Plan

### MIG_020: upsert_cats_from_petlink()

Create new function to extract cats from petlink.pets:
- Use microchip as primary identifier
- Parse name (often includes microchip like "Pricilla 981020053524791")
- Extract breed info
- Create person records for owners if not exists
- Link cat to owner via petlink Owner ID

### MIG_021: Extract microchips from appointment_info

Extend pipeline to capture microchips from appointments:
- For each appointment with a microchip, check if cat exists
- If microchip not in cat_identifiers, either:
  - Create new cat if no match
  - Or add microchip to existing cat matched by name

### Data Quality Considerations

1. **Petlink**: High quality, verified microchip registry
2. **Appointment_info**: Lower quality, may have duplicate cats under different names
3. **Name parsing**: Many names include microchip (e.g., "Pricilla 981020053524791")

## Search Ranking Rule (Related)

Empty person records (like "William Broyles" with no cats, places, or contact info) should not rank highly in search results unless exact match. See pending task for search ranking implementation.
