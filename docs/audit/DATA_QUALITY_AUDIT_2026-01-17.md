# Data Quality Audit - 2026-01-17

## Executive Summary

Found critical data quality issues causing incorrect person-place relationships. Three "mega-persons" were linked to hundreds of places due to organizational identifiers being assigned to individual person records.

## Root Cause

The `reingest-clinichq-week.mjs` script (lines 265-278) creates person-place relationships by matching ClinicHQ owner records to people via email/phone. When organizational identifiers (FFSC office phone, FFSC email, placeholder values like "none") are stored as person identifiers, the script incorrectly links hundreds of places to those individuals.

## Affected Records

### 1. John Davenport (person_id: `6e54a784-8b0c-43ef-a7b2-663b7a944d5f`)
- **Issue**: Linked to 328 places (should have ~0-2)
- **Cause**: Has FFSC office phone `7075767999` as identifier
- **Matches**: 4,053 ClinicHQ owner_info records with this phone
- **Also has**: email = "none" which matches 95 ClinicHQ records
- **Note**: There are 5 "John Davenport" records total - only 1 has real requests

### 2. Tippy Cat (person_id: `ce0f7ed1-739b-4030-9ff8-9aa370d1609e`)
- **Issue**: Linked to 47 places
- **Cause**: Has FFSC email `info@forgottenfelines.com` as identifier
- **Matches**: 2,830 ClinicHQ owner_info records with this email
- **Note**: "Tippy Cat" is clearly a cat name, not a person

### 3. Crystal Furtado (person_id: `033dc673-7f59-4c6f-9664-286e8aded34d`)
- **Issue**: Linked to 13 places
- **Status**: May be legitimate (has 2 requests, 2 roles) - needs review

## Problematic Identifiers

| Identifier | Type | Matches | Issue |
|------------|------|---------|-------|
| `7075767999` | phone | 4,053 | FFSC office phone |
| `info@forgottenfelines.com` | email | 2,830 | FFSC generic email |
| `none` | email | 95 | Invalid placeholder |

## Duplicate People Issue

Also discovered 5 "John Davenport" records that should be reviewed:

| person_id | places | requests | notes |
|-----------|--------|----------|-------|
| `5cc82e88-c70b-483e-adbd-493ab3ca82ef` | 2 | 2 | THE REAL ONE |
| `6e54a784-8b0c-43ef-a7b2-663b7a944d5f` | 328 | 0 | Has FFSC identifiers - BAD |
| `c6217477-8af4-48d3-8723-da0185be6ca9` | 1 | 0 | Duplicate |
| `a63adfd3-cae8-4224-b92d-6b05eff8d3e7` | 0 | 0 | Duplicate |
| `28128968-dac6-413d-9b9d-c88b10292a9a` | 0 | 0 | Duplicate |

## Recommended Fixes

### Immediate (Data Cleanup)

1. **Delete invalid person_identifiers**:
   ```sql
   -- Remove placeholder emails
   DELETE FROM trapper.person_identifiers
   WHERE id_type = 'email' AND id_value_norm IN ('none', 'n/a', 'na', 'null', '');

   -- Remove FFSC organizational identifiers from person records
   DELETE FROM trapper.person_identifiers
   WHERE id_value_norm IN ('7075767999', 'info@forgottenfelines.com', 'ffsteph@sonic.net')
     AND source_system != 'organization';  -- Keep if explicitly org-linked
   ```

2. **Delete incorrect person_place_relationships**:
   ```sql
   -- Remove relationships for the mega-persons
   DELETE FROM trapper.person_place_relationships
   WHERE person_id IN (
     '6e54a784-8b0c-43ef-a7b2-663b7a944d5f',  -- John Davenport (bad)
     'ce0f7ed1-739b-4030-9ff8-9aa370d1609e'   -- Tippy Cat
   )
   AND source_system = 'clinichq';
   ```

3. **Merge or delete duplicate John Davenport records**:
   - Keep `5cc82e88-c70b-483e-adbd-493ab3ca82ef` (has real requests)
   - Delete the others (or merge if they have unique data)

### Prevention (Code Changes)

1. **Add blocklist to identifier matching**:
   ```javascript
   const BLOCKED_IDENTIFIERS = [
     '7075767999',           // FFSC office phone
     'info@forgottenfelines.com',
     'ffsteph@sonic.net',
     'none', 'n/a', 'null'
   ];
   ```

2. **Add validation to `find_or_create_person()`**:
   - Reject emails that are clearly invalid (none, n/a, etc.)
   - Flag phone numbers that match >100 records as "organizational"

3. **Add guard to `reingest-clinichq-week.mjs`**:
   - Skip matching on identifiers that match >50 staged_records
   - Log a warning when this happens

## Verification Queries

```sql
-- Check for mega-persons (should return 0 after fix)
SELECT p.person_id, p.display_name, COUNT(*) as place_count
FROM trapper.sot_people p
JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
GROUP BY p.person_id, p.display_name
HAVING COUNT(*) > 20;

-- Check for invalid identifiers (should return 0 after fix)
SELECT * FROM trapper.person_identifiers
WHERE id_value_norm IN ('none', 'n/a', 'na', 'null', '7075767999', 'info@forgottenfelines.com');
```

## Timeline

- **Discovered**: 2026-01-17
- **Root cause identified**: reingest-clinichq-week.mjs matching on org identifiers
- **Data affected**: 320 incorrect person_place_relationships for John Davenport, 47 for Tippy Cat
