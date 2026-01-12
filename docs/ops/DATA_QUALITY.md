# Data Quality Rules

Atlas implements data quality safeguards to ensure clean, trustworthy identity linking.

## The Problem

Historical ClinicHQ data has:
1. **Shared phones** - FFSC's main line (707-576-7999) used across 132+ client accounts
2. **Non-person names** - Programs ("FFSC Barn Cat"), locations ("15999 Coast Hwy"), placeholders ("rebooking")
3. **Duplicate places** - Same location with multiple spellings ("15999 Hwy 1" vs "15999 CA-1")

Without safeguards, these create "mega-persons" with thousands of incorrectly linked cats.

## Solutions

### Identity Phone Blacklist

**Table:** `trapper.identity_phone_blacklist`

Phones shared by 5+ distinct client names are blacklisted from identity linking:

| Phone | Clients | Reason |
|-------|---------|--------|
| 707-576-7999 | 132 | FFSC main line |
| 707-350-4401 | 27 | Shared voicemail |
| ... | ... | ... |

**Function:** `trapper.is_phone_blacklisted(phone)` - returns TRUE if phone should be excluded

### Identity Name Exclusions

**Table:** `trapper.identity_name_exclusions`

Patterns that indicate non-person records:

| Type | Pattern | Field | Reason |
|------|---------|-------|--------|
| contains | ffsc | both | FFSC program account |
| contains | barn cat | both | FFSC program |
| contains | hotel | both | Location name |
| regex | ^[0-9]+\s | first | Address used as name |
| ... | ... | ... | ... |

**Function:** `trapper.is_person_name(first, last)` - returns TRUE if likely a real person

### Place Exclusions

**Table:** `trapper.place_exclusion_patterns`

Patterns for non-place records:

| Type | Pattern | Reason |
|------|---------|--------|
| equals | unknown | Placeholder |
| contains | ffsc | Internal code |
| regex | ^[a-z]+ [a-z]+$ | Person name, not address |
| ... | ... | ... |

**Function:** `trapper.is_valid_place(name)` - returns TRUE if likely a real place

## Migrations

| Migration | Purpose |
|-----------|---------|
| MIG_156__deduplicate_places | `merge_places()` and `pick_canonical_place()` functions |
| MIG_157__clean_identity_linking | Phone blacklist, name exclusions, person rebuild |
| MIG_158__clean_places | Place exclusions, coordinate/address deduplication |

## Results

After cleanup (MIG_157):
- **People**: 8,792 (down from 9,479)
- **No mega-persons**: Previously had people with 2,000+ cats
- **Cat-person links**: 26,518 (clean, trustworthy)
- **Appointment-person links**: 37,813 (89% coverage)

After cleanup (MIG_158):
- **Places merged**: Duplicates consolidated
- **Appointment-place links**: 47,199 (99.97% coverage)

## Backup & Recovery

All migrations create backup tables:
- `trapper.backup_sot_people_mig157`
- `trapper.backup_person_identifiers_mig157`
- `trapper.backup_places_mig158`

If incorrect exclusions are discovered, data can be recovered from backups.

## Adding New Exclusions

### Add a phone to blacklist:
```sql
INSERT INTO trapper.identity_phone_blacklist (phone_norm, reason, distinct_client_count)
VALUES ('7075551234', 'New shared line identified', 10);
```

### Add a name pattern:
```sql
INSERT INTO trapper.identity_name_exclusions (pattern_type, pattern_value, field, reason)
VALUES ('contains', 'new_program', 'both', 'New FFSC program');
```

### Add a place pattern:
```sql
INSERT INTO trapper.place_exclusion_patterns (pattern_type, pattern_value, reason)
VALUES ('contains', 'test_location', 'Test data');
```

## Trust Architecture

Atlas is a **search index** pointing back to authoritative sources:

```
User searches Atlas
       ↓
Atlas shows linked records
       ↓
User clicks through to ClinicHQ/Airtable for authoritative data
```

This "reverse trust tier" approach means Atlas provides discovery while ClinicHQ remains the source of truth for detailed records.

---

*See MIG_157 and MIG_158 source files for implementation details.*
