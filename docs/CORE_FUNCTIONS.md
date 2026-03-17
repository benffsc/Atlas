# Atlas Core Functions Reference

This document provides a quick reference for all centralized database functions used in Atlas. These functions are **mandatory** for entity creation and relationship management - never use direct INSERT statements.

> **Canonical Reference:** MIG_2801 consolidates documentation for heavily-redefined functions.
> See also: CLAUDE.md "MANDATORY: Centralized Functions" section.

---

## Entity Creation Functions

### `sot.find_or_create_person()`

Creates or finds a person record via the Data Engine.

```sql
SELECT sot.find_or_create_person(
  p_email        TEXT,       -- Primary identifier (nullable)
  p_phone        TEXT,       -- Secondary identifier (nullable)
  p_first_name   TEXT,       -- First name
  p_last_name    TEXT,       -- Last name
  p_address      TEXT,       -- Address string (optional)
  p_source       TEXT        -- Source system: 'clinichq', 'airtable', etc.
) RETURNS UUID;
```

**Key Rules:**
- Requires email OR phone - rejects if both are NULL
- Uses `classify_owner_name()` to detect pseudo-profiles
- Soft-blacklisted identifiers are filtered out

**Canonical Migration:** MIG_2090 (V1 wrapper)

---

### `sot.find_or_create_cat_by_microchip()`

Creates or finds a cat record by microchip.

```sql
SELECT sot.find_or_create_cat_by_microchip(
  p_microchip             TEXT,  -- Microchip number (primary key)
  p_name                  TEXT,  -- Display name
  p_sex                   TEXT,  -- 'M', 'F', 'U'
  p_breed                 TEXT,  -- Breed description
  p_altered_status        TEXT,  -- 'altered', 'intact', 'unknown'
  p_primary_color         TEXT,  -- Primary coat color
  p_secondary_color       TEXT,  -- Secondary coat color
  p_ownership_type        TEXT,  -- Ownership classification
  p_clinichq_animal_id    TEXT,  -- ClinicHQ number (e.g., "21-118")
  p_shelterluv_animal_id  TEXT,  -- ShelterLuv ID
  p_source_system         TEXT   -- Source system identifier
) RETURNS UUID;
```

**Key Rules:**
- Always pass animal IDs when available (INV-39)
- Uses `NULLIF(field, '')` to handle empty strings
- Creates `cat_identifiers` entries for all IDs

**Canonical Migration:** MIG_2340

---

### `sot.find_or_create_place_deduped()`

Creates or finds a place with deduplication.

```sql
SELECT sot.find_or_create_place_deduped(
  p_address      TEXT,       -- Formatted address
  p_name         TEXT,       -- Display name (optional)
  p_lat          FLOAT,      -- Latitude
  p_lng          FLOAT,      -- Longitude
  p_source       TEXT        -- Source system
) RETURNS UUID;
```

**Key Rules:**
- Deduplicates within 10 meters for coordinate-only places
- Exact address match for address-backed places
- Never creates duplicate places at same location

**Canonical Migration:** MIG_797

---

### `ops.find_or_create_request()`

Creates or finds a request record.

```sql
SELECT ops.find_or_create_request(
  p_source_system      TEXT,
  p_source_record_id   TEXT,
  p_source_created_at  TIMESTAMPTZ,
  -- ... additional fields
) RETURNS UUID;
```

**Canonical Migration:** MIG_797

---

## Relationship Functions

### `sot.link_cat_to_place()`

Links a cat to a place with evidence tracking.

```sql
SELECT sot.link_cat_to_place(
  p_cat_id          UUID,
  p_place_id        UUID,
  p_relationship    TEXT,     -- 'home', 'residence', 'colony_member', etc.
  p_evidence_type   TEXT,     -- 'appointment', 'manual', 'inferred'
  p_source_system   TEXT,
  p_confidence      FLOAT DEFAULT 1.0
) RETURNS UUID;
```

**Key Rules:**
- Always use this function, never direct INSERT
- A cat should have max 2-3 links of same type (pollution check)

**Canonical Migration:** MIG_889

---

### `sot.link_person_to_cat()`

Links a person to a cat with relationship type.

```sql
SELECT sot.link_person_to_cat(
  p_person_id       UUID,
  p_cat_id          UUID,
  p_relationship    TEXT,     -- 'owner', 'adopter', 'foster', 'caretaker'
  p_evidence_type   TEXT,
  p_source_system   TEXT
) RETURNS UUID;
```

**Canonical Migration:** MIG_797

---

## Entity Linking Pipeline Functions

### `sot.link_cats_to_places()`

Batch links cats to places via appointments and person relationships.

```sql
SELECT * FROM sot.link_cats_to_places();
-- Returns: cats_linked_home, cats_linked_appointment, cats_skipped, total_edges
```

**Key Implementation Details:**
1. Uses `appointment.inferred_place_id` (highest priority)
2. LIMIT 1 per person (prevents address pollution)
3. Excludes non-residential place kinds (business, clinic, etc.)

**Canonical Migration:** MIG_2601 (11 versions consolidated)

---

### `sot.link_cats_to_appointment_places()`

Links cats to places via appointment data.

```sql
SELECT * FROM sot.link_cats_to_appointment_places();
```

**Key Rules:**
- Uses `inferred_place_id` from appointments
- Called internally by `link_cats_to_places()`

**Canonical Migration:** MIG_889

---

## Classification Functions

### `sot.classify_owner_name()`

Classifies owner name strings for identity resolution.

```sql
SELECT sot.classify_owner_name('John Smith');        -- 'likely_person'
SELECT sot.classify_owner_name('World Of Carpets');  -- 'organization'
SELECT sot.classify_owner_name('1234 Main St');      -- 'address'

-- Two-parameter overload
SELECT sot.classify_owner_name('John', 'Carpenter'); -- 'likely_person'
```

**Return Values:**
- `likely_person` - Real person name
- `address` - Street address pattern
- `apartment_complex` - Multi-unit housing name
- `organization` - Business/org name
- `known_org` - Known organization pattern
- `garbage` - Unusable text
- `unknown` - Cannot classify

**Uses Lookup Tables:**
- `ref.common_first_names` - SSA baby names
- `ref.occupation_surnames` - Carpenter, Baker, Mason, etc.
- `ref.business_service_words` - Surgery, Carpets, Market, etc.

**Canonical Migration:** MIG_2547 (11 versions consolidated)

---

### `sot.should_be_person()`

Gate function to prevent pseudo-profiles from becoming person records.

```sql
SELECT sot.should_be_person('John', 'Smith');     -- TRUE (create person)
SELECT sot.should_be_person('Silveira Ranch', ''); -- FALSE (route to clinic_owner_accounts)
```

**Usage Pattern:**
```sql
IF sot.should_be_person(owner_first, owner_last) THEN
  person_id := sot.find_or_create_person(...);
ELSE
  -- Route to ops.clinic_owner_accounts
END IF;
```

**Canonical Migration:** MIG_2801

---

## Identity Resolution

### `sot.data_engine_resolve_identity()`

Core identity resolution via multi-signal weighted scoring.

```sql
SELECT * FROM sot.data_engine_resolve_identity(
  p_email        TEXT,
  p_phone        TEXT,
  p_first_name   TEXT,
  p_last_name    TEXT,
  p_address      TEXT,
  p_source       TEXT
);
-- Returns: person_id, decision_type, match_confidence, decision_reason
```

**Decision Types:**
- `matched` - Found existing person
- `created` - Created new person
- `review_pending` - Sent to manual review queue
- `rejected` - Invalid input (no identifiers, garbage name)

**Match Tiers:**
1. Email match (highest confidence)
2. Phone + name match
3. Phone only
4. Name + address (often review_pending)

**Note:** Prefer `sot.find_or_create_person()` for most use cases.

**Canonical Migration:** V1 (MIG_564), accessed via MIG_2090 wrapper

---

## Place Functions

### `sot.create_place_from_coordinates()`

Creates a coordinate-only place with 10m deduplication.

```sql
SELECT sot.create_place_from_coordinates(
  p_lat           FLOAT,
  p_lng           FLOAT,
  p_display_name  TEXT,
  p_source_system TEXT
) RETURNS UUID;
```

**Canonical Migration:** MIG_797

---

### `sot.get_place_family()`

Returns UUID[] of parent, children, siblings, and co-located places.

```sql
SELECT sot.get_place_family('place-uuid-here');
-- Returns: UUID[] of related places (within 1m)
```

**Key Rule:** Never use arbitrary distance radius for cross-place aggregation - use this function.

**Canonical Migration:** MIG_2206

---

### `sot.merge_place_into()`

Merges one place into another with audit trail.

```sql
SELECT sot.merge_place_into(
  p_loser_id    UUID,
  p_winner_id   UUID,
  p_reason      TEXT,
  p_changed_by  TEXT
);
```

**Key Rules:**
- Always use `place_safe_to_merge()` first
- Relinks all relationships to winner
- Sets `merged_into_place_id` on loser

**Canonical Migration:** MIG_797

---

## Utility Functions

### `sot.norm_phone_us()`

Normalizes US phone numbers to 10-digit format.

```sql
SELECT sot.norm_phone_us('(707) 555-1234');  -- '7075551234'
SELECT sot.norm_phone_us('707.555.1234');    -- '7075551234'
```

---

### `sot.norm_email()`

Normalizes email addresses (lowercase, trim).

```sql
SELECT sot.norm_email('  John@Example.COM  ');  -- 'john@example.com'
```

---

### `sot.is_positive_value()`

Checks if a string represents a positive/true value.

```sql
SELECT sot.is_positive_value('Yes');      -- TRUE
SELECT sot.is_positive_value('TRUE');     -- TRUE
SELECT sot.is_positive_value('Checked');  -- TRUE
SELECT sot.is_positive_value('No');       -- FALSE
```

**Handles:** Yes, TRUE, Y, Checked, Positive, 1, Left, Right, Bilateral (case-insensitive)

**Canonical Migration:** MIG_900

---

## Source System Values

Always use these exact values for `source_system` parameters:

| Value | Description |
|-------|-------------|
| `airtable` | All Airtable data |
| `clinichq` | ClinicHQ data |
| `shelterluv` | ShelterLuv API data |
| `volunteerhub` | VolunteerHub API data |
| `web_intake` | Web intake form submissions |
| `petlink` | PetLink microchip data |
| `google_maps` | Google Maps KML data |
| `atlas_ui` | Atlas web app (manual edits) |

---

## Quick Reference: What NOT to Do

❌ **Never INSERT directly** into `sot.people`, `sot.places`, `sot.cats`, `ops.requests`

❌ **Never INSERT directly** into `sot.cat_place`, `sot.person_cat`, `sot.person_place`

❌ **Never match people by name alone** - require email or phone

❌ **Never use arbitrary distance radius** - use `get_place_family()`

❌ **Never use custom source_system values** - use the exact values above

❌ **Never hardcode boolean checks** - use `is_positive_value()`

---

## See Also

- `CLAUDE.md` - System invariants and rules
- `docs/CENTRALIZED_FUNCTIONS.md` - Detailed parameter signatures with examples
- `docs/DATA_FLOW_ARCHITECTURE.md` - Pipeline documentation
