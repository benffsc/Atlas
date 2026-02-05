# Atlas Centralized Entity Functions

This document details the mandatory functions for creating entities in Atlas. **Direct INSERT statements to SOT tables are prohibited.**

## Why Centralized Functions?

These functions enforce:
1. **Deduplication** - Prevent duplicate records
2. **Identity Resolution** - Match to existing entities via Data Engine
3. **Normalization** - Standardize data formats
4. **Audit Trail** - Track all decisions
5. **Geocoding Queue** - Auto-queue addresses for geocoding
6. **Merged Entity Handling** - Follow merge chains

---

## find_or_create_person()

Creates or finds a person using the Data Engine for identity resolution.

### Signature

```sql
trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_source_id TEXT DEFAULT NULL
) RETURNS UUID
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `p_email` | Email address (normalized internally) | No* |
| `p_phone` | Phone number (normalized to 10 digits) | No* |
| `p_first_name` | First name | No |
| `p_last_name` | Last name | No |
| `p_address` | Address for matching context | No |
| `p_source_system` | Origin system ('clinichq', 'airtable', 'web_intake', 'atlas_ui') | No |
| `p_source_id` | External system ID for fast matching | No |

*At least email OR phone should be provided for proper identity resolution.

### What It Does

1. **Checks known organizations** - Matches names like "Sonoma County Animal Services"
2. **Validates input** - Rejects junk names and internal accounts
3. **Normalizes contact info** - Email lowercase, phone to 10 digits
4. **Calls Data Engine** - `data_engine_resolve_identity()` for scoring
5. **Returns existing or new** - Based on match confidence

### Data Engine Scoring

| Signal | Weight | Example |
|--------|--------|---------|
| Email | 40% | `john@example.com` matches existing |
| Phone | 25% | `7075551234` matches existing |
| Name | 25% | "John Smith" fuzzy match |
| Address | 10% | Same address context |

### Decision Matrix

| Score | Decision | Action |
|-------|----------|--------|
| >= 0.95 | auto_match | Return existing person_id |
| 0.50-0.94 | review_pending | Create new, flag for review |
| < 0.50 | new_entity | Create new person |

### Example Usage

```sql
-- Find or create a person
SELECT trapper.find_or_create_person(
    p_email := 'jane@example.com',
    p_phone := '707-555-1234',
    p_first_name := 'Jane',
    p_last_name := 'Smith',
    p_source_system := 'atlas_ui'
);
-- Returns: person_id UUID
```

### Returns NULL When

- Name is junk (test, xxx, 123, etc.)
- Email is @forgottenfelines.org (internal account)
- Name matches internal account pattern

---

## find_or_create_place_deduped()

Creates or finds a place with address normalization and deduplication.

### Signature

```sql
trapper.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
) RETURNS UUID
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `p_formatted_address` | Full street address | Yes |
| `p_display_name` | Friendly name (e.g., "Smith Residence") | No |
| `p_lat` | Latitude if known | No |
| `p_lng` | Longitude if known | No |
| `p_source_system` | Origin system | No |

### What It Does

1. **Validates address** - Rejects junk addresses (PO Box, too short, etc.)
2. **Normalizes address** - Standardizes format for matching
3. **Checks for existing** - By normalized address or Google Place ID
4. **Queues for geocoding** - If coordinates not provided
5. **Returns existing or new** - Based on address match

### Address Normalization

```
Input:  "123 Main St., Santa Rosa, CA 95401"
Output: "123 MAIN ST SANTA ROSA CA 95401"
```

### Junk Address Detection

Returns NULL for:
- Too short (< 10 characters)
- Test addresses ("123 Main", "test", "sample")
- PO Boxes
- City/state only (no street)
- No house number (unless named place)

### Example Usage

```sql
-- Find or create a place
SELECT trapper.find_or_create_place_deduped(
    p_formatted_address := '123 Main St, Santa Rosa, CA 95401',
    p_display_name := 'Smith Residence',
    p_source_system := 'web_intake'
);
-- Returns: place_id UUID
```

---

## find_or_create_cat_by_microchip()

Creates or finds a cat using microchip as the primary identifier.

### Signature

```sql
trapper.unified_find_or_create_cat(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_source_id TEXT DEFAULT NULL
) RETURNS UUID
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `p_microchip` | Microchip number (cleaned internally) | Yes |
| `p_name` | Cat name | No |
| `p_sex` | male, female, unknown | No |
| `p_breed` | Breed description | No |
| `p_altered_status` | spayed, neutered, intact, unknown | No |
| `p_primary_color` | Primary coat color | No |
| `p_secondary_color` | Secondary coat color | No |
| `p_ownership_type` | stray, owned, community, etc. | No |
| `p_source_system` | Origin system | No |
| `p_source_id` | External animal ID | No |

### What It Does

1. **Cleans microchip** - Removes non-alphanumeric, uppercase
2. **Validates microchip** - Rejects junk chips (too short, test patterns)
3. **Validates name** - Ignores junk names but still creates cat
4. **Checks cat_identifiers** - Finds existing by microchip
5. **Applies survivorship** - Updates existing with better data
6. **Returns existing or new** - Based on microchip match

### Microchip Validation

Returns NULL for:
- Too short (< 9 characters)
- All zeros or nines
- Test patterns (123456789, "test", "fake")
- Sequential patterns (12345...)

### Survivorship Rules

When updating existing cats, source confidence determines which value wins:

| Source | Confidence |
|--------|------------|
| clinichq | 0.95 |
| shelterluv | 0.90 |
| airtable | 0.70 |
| web_intake | 0.60 |

### Example Usage

```sql
-- Find or create a cat
SELECT trapper.unified_find_or_create_cat(
    p_microchip := '985112012345678',
    p_name := 'Whiskers',
    p_sex := 'female',
    p_altered_status := 'spayed',
    p_source_system := 'clinichq'
);
-- Returns: cat_id UUID
```

---

## find_or_create_request()

Creates or finds a request with proper attribution window support.

### Signature

```sql
trapper.find_or_create_request(
    p_source_system TEXT,
    p_source_record_id TEXT,
    p_source_created_at TIMESTAMP,
    p_place_id UUID DEFAULT NULL,
    p_requester_person_id UUID DEFAULT NULL,
    p_raw_address TEXT DEFAULT NULL,
    p_raw_requester_email TEXT DEFAULT NULL,
    p_raw_requester_phone TEXT DEFAULT NULL,
    p_raw_requester_name TEXT DEFAULT NULL,
    p_summary TEXT DEFAULT NULL,
    p_status TEXT DEFAULT 'new',
    p_priority TEXT DEFAULT 'normal'
) RETURNS UUID
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `p_source_system` | Origin system | Yes |
| `p_source_record_id` | ID in source system (for dedup) | Yes |
| `p_source_created_at` | Original creation timestamp | Yes |
| `p_place_id` | Existing place_id if known | No |
| `p_requester_person_id` | Existing person_id if known | No |
| `p_raw_address` | Address to resolve | No |
| `p_raw_requester_*` | Contact info to resolve | No |
| `p_summary` | Request description | No |
| `p_status` | Initial status | No |
| `p_priority` | Initial priority | No |

### What It Does

1. **Checks for existing** - By source_system + source_record_id
2. **Resolves person** - Uses `find_or_create_person()` if raw contact provided
3. **Resolves place** - Uses `find_or_create_place_deduped()` if raw address provided
4. **Sets source_created_at** - Critical for attribution windows
5. **Returns existing or new** - Based on source ID match

### Attribution Windows

The `source_created_at` field is critical for linking cats to requests:

```sql
-- Legacy requests (before May 2025): Fixed window
WHEN source_created_at < '2025-05-01' THEN source_created_at + '6 months'

-- Resolved requests: Buffer after completion
WHEN resolved_at IS NOT NULL THEN resolved_at + '3 months'

-- Active requests: Rolling to future
ELSE NOW() + '6 months'
```

### Example Usage

```sql
-- Find or create a request (from Airtable sync)
SELECT trapper.find_or_create_request(
    p_source_system := 'airtable',
    p_source_record_id := 'rec123ABC',
    p_source_created_at := '2024-06-15 10:30:00',
    p_raw_address := '123 Main St, Santa Rosa, CA',
    p_raw_requester_email := 'jane@example.com',
    p_raw_requester_name := 'Jane Smith',
    p_summary := 'TNR request for 5 cats'
);
-- Returns: request_id UUID
```

---

## Source System Values

Use these exact values for `p_source_system`:

| Value | Usage |
|-------|-------|
| `'airtable'` | All Airtable data |
| `'clinichq'` | All ClinicHQ data |
| `'web_intake'` | Web intake form submissions |
| `'atlas_ui'` | Native Atlas UI creation |
| `'shelterluv'` | ShelterLuv imports |
| `'volunteerhub'` | VolunteerHub imports |

---

## What NOT To Do

```sql
-- WRONG: Direct insert bypasses all validation
INSERT INTO trapper.sot_people (display_name, primary_email)
VALUES ('John Smith', 'john@example.com');

-- RIGHT: Use centralized function
SELECT trapper.find_or_create_person(
    p_email := 'john@example.com',
    p_first_name := 'John',
    p_last_name := 'Smith',
    p_source_system := 'atlas_ui'
);
```

```sql
-- WRONG: Custom source system value
SELECT trapper.find_or_create_person(
    p_source_system := 'my_custom_import'  -- NO!
);

-- RIGHT: Use approved source system
SELECT trapper.find_or_create_person(
    p_source_system := 'atlas_ui'  -- YES!
);
```

---

## Monitoring & Debugging

### Data Engine Review Queue

```sql
-- View pending identity reviews
SELECT * FROM trapper.v_data_engine_review_queue;
```

### Match Decisions Audit

```sql
-- See all identity decisions for an email
SELECT * FROM trapper.data_engine_match_decisions
WHERE input_data->>'email' = 'jane@example.com'
ORDER BY created_at DESC;
```

### Entity Edit History

```sql
-- See changes to a person
SELECT * FROM trapper.entity_edits
WHERE entity_type = 'person'
AND entity_id = 'your-person-uuid'
ORDER BY created_at DESC;
```

---

## TypeScript UI Utilities

These functions are in `apps/web/src/lib/formatters.ts` and are used for **display only** — they do not modify stored data.

### Phone Formatting

```typescript
import { formatPhone, isValidPhone, extractPhone } from "@/lib/formatters";

// Format phone for display
formatPhone("7075551234")  // "(707) 555-1234"
formatPhone("+17075551234") // "(707) 555-1234"
formatPhone("555-1234")     // "555-1234" (unchanged if not 10 digits)

// Validate phone format (10 digits, or 11 starting with 1)
isValidPhone("7075551234")  // true
isValidPhone("555-1234")    // false (only 7 digits)

// Extract valid phone from malformed input
extractPhone("(7073967923) 7073967923") // "7073967923"
extractPhone("(95492) 7077122660")      // "7077122660"
extractPhone("(707) 858817")            // null (only 9 digits)
```

**When to use which:**

| Layer | Function | Purpose |
|-------|----------|---------|
| SQL (L2 Identity) | `norm_phone_us()` | Normalize for identity matching, storage |
| TypeScript (L6 UI) | `formatPhone()` | Display formatting only |
| TypeScript (L6 UI) | `isValidPhone()` | Show warning badges on invalid phones |
| TypeScript (L6 UI) | `extractPhone()` | Suggest corrections for malformed input |

**Important:** These functions do NOT modify database values. They are display-layer utilities. The SQL function `norm_phone_us()` remains the authoritative normalizer for identity resolution.

---

## Related Documentation

- [DATA_FLOW_ARCHITECTURE.md](./DATA_FLOW_ARCHITECTURE.md) - Overall data flow
- [INGEST_GUIDELINES.md](./INGEST_GUIDELINES.md) - Data ingestion rules
- [ATLAS_MISSION_CONTRACT.md](./ATLAS_MISSION_CONTRACT.md) - Core mission principles
