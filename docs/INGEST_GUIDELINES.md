# Atlas Data Ingestion Guidelines

This document defines the **required patterns** for all data ingestion into Atlas. All ingest scripts, sync functions, API routes, and migrations MUST follow these rules.

## Core Principle: Centralized Functions

**NEVER create inline INSERT statements for core entities.** Always use the centralized SQL functions.

### Required SQL Functions

| Entity | Function | Purpose |
|--------|----------|---------|
| Person | `sot.find_or_create_person()` | Creates/finds person with identity matching |
| Place | `sot.find_or_create_place_deduped()` | Creates/finds place with deduplication |
| Cat | `sot.find_or_create_cat_by_microchip()` | Creates/finds cat by microchip |

---

## Person Creation: `find_or_create_person()`

### Function Signature

```sql
sot.find_or_create_person(
    p_email TEXT,           -- Email address (normalized automatically)
    p_phone TEXT,           -- Phone number (normalized via norm_phone_us)
    p_first_name TEXT,      -- First name
    p_last_name TEXT,       -- Last name
    p_address TEXT,         -- Address (optional)
    p_source_system TEXT    -- Source system identifier
) RETURNS UUID
```

### What It Does

1. **Normalizes identifiers** - Email lowercased, phone via `norm_phone_us()`
2. **Checks blacklist** - Won't create blacklisted identities
3. **Identity matching** - Finds existing person by email OR phone
4. **Creates identifiers** - Adds email/phone to `person_identifiers`
5. **Returns canonical ID** - Handles merged persons automatically

### Usage Examples

```javascript
// JavaScript (ingest script)
const personResult = await client.query(`
  SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, $5) AS person_id
`, [email, phone, firstName, lastName, 'airtable']);
const personId = personResult.rows[0]?.person_id;
```

```sql
-- SQL (migration or stored function)
v_person_id := sot.find_or_create_person(
    v_email, v_phone, v_first_name, v_last_name, NULL, 'clinichq'
);
```

### Rules

- **NEVER match persons by name alone** - Too many false positives
- **Require email OR phone** - At least one identifier needed
- **Pass raw phone** - Function handles normalization
- **Use consistent source_system** - See Source System Values below

---

## Place Creation: `find_or_create_place_deduped()`

### Function Signature

```sql
sot.find_or_create_place_deduped(
    p_formatted_address TEXT,   -- Full address string
    p_display_name TEXT,        -- Optional place name
    p_lat DOUBLE PRECISION,     -- Latitude (NULL triggers geocoding queue)
    p_lng DOUBLE PRECISION,     -- Longitude
    p_source_system TEXT        -- Source system identifier
) RETURNS UUID
```

### What It Does

1. **Normalizes address** - Via `normalize_address()` function
2. **Deduplicates** - Matches existing places by normalized address
3. **Queues geocoding** - If lat/lng NULL, sets `geocode_next_attempt`
4. **Handles merges** - Returns canonical place_id if place was merged

### Usage Examples

```javascript
// With geocoded coordinates
const placeResult = await client.query(`
  SELECT sot.find_or_create_place_deduped($1, NULL, $2, $3, $4) AS place_id
`, [geocodedAddress, lat, lng, 'airtable']);

// Without coordinates (will be geocoded later)
const placeResult = await client.query(`
  SELECT sot.find_or_create_place_deduped($1, NULL, NULL, NULL, $2) AS place_id
`, [rawAddress, 'web_intake']);
```

### Rules

- **Prefer geocoded addresses** - Improves deduplication accuracy
- **Pass raw address if no geocode** - Function queues for later geocoding
- **Don't manually normalize** - Function handles it
- **Check for merged places** in API responses (see Merged Entity Handling)

---

## Cat Creation: `find_or_create_cat_by_microchip()`

### Function Signature

```sql
sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
) RETURNS UUID
```

### What It Does

1. **Validates microchip** - Must be at least 9 characters
2. **Deduplicates** - Finds existing cat by microchip in `cat_identifiers`
3. **Creates identifier** - Adds microchip to `cat_identifiers` table
4. **Updates existing cats** - Uses COALESCE to preserve existing data

### Usage Example

```sql
v_cat_id := sot.find_or_create_cat_by_microchip(
    v_rec.microchip,
    v_rec.animal_name,
    v_rec.sex,
    v_rec.breed,
    v_rec.altered_status,
    v_rec.primary_color,
    v_rec.secondary_color,
    v_rec.ownership_type,
    'clinichq'
);
```

### Rules

- **NEVER create cats without microchip** via this function
- **ALWAYS use for clinic data** - Clinic data always has microchips
- **Returns NULL** for invalid microchips (< 9 chars)

---

## Source System Values

Use these **exact values** for `source_system`:

| Source | Value | Description |
|--------|-------|-------------|
| Airtable | `'airtable'` | All Airtable data (Center Base, Atlas Base) |
| ClinicHQ | `'clinichq'` | Clinic appointment/visit data |
| Web Intake | `'web_intake'` | Online intake form submissions |
| Web App | `'web_app'` | Manual entries from Atlas web interface |

### Wrong Examples (DO NOT USE)

```
❌ 'airtable_staff'        → Use 'airtable'
❌ 'airtable_project75'    → Use 'airtable'
❌ 'clinichq_visits'       → Use 'clinichq'
❌ 'web_intake_receptionist' → Use 'web_intake'
```

---

## Phone Normalization: `norm_phone_us()`

### What It Does

```sql
sot.norm_phone_us(p_phone TEXT) RETURNS TEXT
```

1. Strips all non-digits
2. Removes leading '1' if 11 digits
3. Returns 10-digit US phone or NULL

### Rules

- **Pass raw phone to SQL functions** - They normalize internally
- **Use for lookups** - When searching `person_identifiers`

```sql
-- Correct lookup
SELECT person_id FROM sot.person_identifiers
WHERE id_type = 'phone' AND id_value_norm = sot.norm_phone_us('(707) 555-1234');
```

---

## Address Normalization: `normalize_address()`

### What It Does

1. Lowercases
2. Removes country suffixes (USA, United States)
3. **Abbreviates** street types: Street→St, Avenue→Ave, Drive→Dr
4. **Abbreviates** directions: North→N, South→S
5. **Abbreviates** unit prefixes: Apartment→Apt, Suite→Ste
6. Normalizes whitespace

### Rules

- **DON'T call directly** - Use `find_or_create_place_deduped()` instead
- **Uses ABBREVIATION approach** - Industry standard for geocoding

---

## Merged Entity Handling

Entities can be merged. Always handle this.

### In API Routes

```typescript
// Check if place was merged
const mergeCheck = await queryOne<{ merged_into_place_id: string | null }>(
  `SELECT merged_into_place_id FROM sot.places WHERE place_id = $1`,
  [id]
);

// Use canonical ID
const placeId = mergeCheck?.merged_into_place_id || id;

// Include redirect info in response
if (mergeCheck?.merged_into_place_id) {
  return NextResponse.json({
    ...place,
    _merged_from: id,
    _canonical_id: placeId,
  });
}
```

### In SQL Functions

The `find_or_create_*` functions handle this automatically via `canonical_person_id()` and similar.

---

## Creating New Ingest Scripts

### Template

```javascript
#!/usr/bin/env node
/**
 * source_table_sync.mjs
 * Description of what this syncs
 */

import pg from 'pg';
const { Client } = pg;

// ALWAYS use consistent source_system
const SOURCE_SYSTEM = 'airtable';  // or 'clinichq', 'web_intake'

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const record of records) {
    // 1. Find or create person (if contact info exists)
    let personId = null;
    if (email || phone) {
      const personResult = await client.query(`
        SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, $5) AS person_id
      `, [email, phone, firstName, lastName, SOURCE_SYSTEM]);
      personId = personResult.rows[0]?.person_id;
    }

    // 2. Find or create place (if address exists)
    let placeId = null;
    if (address) {
      const placeResult = await client.query(`
        SELECT sot.find_or_create_place_deduped($1, $2, $3, $4, $5) AS place_id
      `, [address, displayName, lat, lng, SOURCE_SYSTEM]);
      placeId = placeResult.rows[0]?.place_id;
    }

    // 3. Create relationships if both exist
    if (personId && placeId) {
      await client.query(`
        INSERT INTO sot.person_place (
          person_id, place_id, role, confidence, source_system
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (person_id, place_id, role) DO NOTHING
      `, [personId, placeId, 'requester', 'high', SOURCE_SYSTEM]);
    }

    // 4. Insert domain-specific records
    // ...
  }

  await client.end();
}
```

---

## Creating New Migrations

### Template

```sql
-- MIG_XXXX: Description
--
-- Problem: What issue this fixes
--
-- Fix: What this migration does

\echo ''
\echo '=============================================='
\echo 'MIG_XXXX: Description'
\echo '=============================================='
\echo ''

-- Use centralized functions for entity creation
-- Example: Creating a new processing function

CREATE OR REPLACE FUNCTION sot.process_something()
RETURNS void AS $$
DECLARE
    v_person_id UUID;
    v_place_id UUID;
BEGIN
    -- CORRECT: Use centralized function
    v_person_id := sot.find_or_create_person(
        p_email, p_phone, p_first_name, p_last_name, NULL, 'airtable'
    );

    -- WRONG: Direct INSERT
    -- INSERT INTO sot.people (...) VALUES (...);
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo '=== MIG_XXXX Complete ==='
\echo ''
```

---

## Checklist for Code Review

When reviewing ingest code, verify:

- [ ] Uses `find_or_create_person()` for person creation
- [ ] Uses `find_or_create_place_deduped()` for place creation
- [ ] Uses `find_or_create_cat_by_microchip()` for cat creation
- [ ] Uses correct `source_system` value ('airtable', 'clinichq', 'web_intake')
- [ ] Passes raw phone (not pre-normalized)
- [ ] Handles merged entities in API responses
- [ ] Creates relationships via proper tables (`sot.person_place`, etc.)
- [ ] NO direct INSERT into sot.people, sot.places, or sot.cats

---

## Summary

| Do This | Don't Do This |
|---------|---------------|
| `find_or_create_person()` | Direct INSERT into sot.people |
| `find_or_create_place_deduped()` | Custom address matching logic |
| `find_or_create_cat_by_microchip()` | Direct INSERT into sot.cats |
| `source_system = 'airtable'` | `source_system = 'airtable_staff'` |
| Pass raw phone to SQL functions | Pre-normalize phone in JS |
| Check `merged_into_place_id` | Return 404 for merged entities |
