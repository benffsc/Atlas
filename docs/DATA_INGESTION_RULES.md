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
- `sot_people` - canonical person records
- `sot_cats` - canonical cat records
- `sot_requests` - all service requests
- `places` - all addresses/locations

---

## Rules for Each Entity Type

### People (`sot_people`)

**ALWAYS add to SoT if:**
- Has valid email OR phone number
- Name passes `is_valid_person_name()` validation
- Is not an internal/program account

**Identity matching priority:**
1. Email (exact match via `person_identifiers`)
2. Phone (last 10 digits via `person_identifiers`)
3. Never match by name alone (too many false positives)

**Required fields:**
- `display_name` - human-readable name

**Automatic behaviors:**
- Phone blacklist checked (shared phones like FFSC main line excluded)
- Organization prefixes stripped (LMFM, etc.)
- `is_canonical` flag set for primary record in merge groups

**Use this function:**
```sql
SELECT trapper.find_or_create_person(
  p_email,      -- email address
  p_phone,      -- phone number
  p_first_name, -- first name (for display_name)
  p_last_name,  -- last name (for display_name)
  p_address,    -- optional address
  p_source_system -- 'airtable', 'clinichq', etc.
);
```

### Cats (`sot_cats`)

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
SELECT trapper.find_or_create_cat_by_microchip(
  p_microchip,
  p_name,
  p_source_system
);
```

### Places (`places`)

**ALWAYS add to SoT if:**
- Has a parseable street address
- Can be geocoded (lat/lng)

**Identity matching:**
- Match by normalized address
- Match by Google Place ID
- Match by coordinates (within threshold)

**Deduplication:**
- Same building, different units = separate records with `parent_place_id`
- Exact duplicates merged via `merged_into_place_id`

### Requests (`sot_requests`)

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
INSERT INTO trapper.staged_records (
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
  'SELECT trapper.find_or_create_person($1, $2, $3, $4, $5, $6)',
  [email, phone, firstName, lastName, address, sourceSystem]
);

// 3. Add role/relationship
await db.query(
  'INSERT INTO person_roles (...) ON CONFLICT DO UPDATE ...'
);
```

---

## Source System Handling

### Airtable
- Personal Access Token in `AIRTABLE_PAT`
- Paginate with `offset` parameter
- Record ID = `record.id`
- Fields in `record.fields`

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

---

## Logging & Audit Trail

### All changes must be logged:
```sql
INSERT INTO trapper.data_changes (
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
INSERT INTO trapper.ingest_runs (
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
| Person | Email, Phone | Has email OR phone | `sot_people` |
| Cat | Microchip | Has microchip | `sot_cats` |
| Place | Address, Coords | Has street address | `places` |
| Request | Source ID | Any service request | `sot_requests` |

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
