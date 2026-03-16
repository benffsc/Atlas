# Place Context Tagging System

This document describes the place context tagging system that transforms SoT Places into comprehensive address profiles with relevance tagging.

## Overview

Places in Atlas can have multiple contextual tags that describe their relevance to FFSC operations:

- **Colony sites** - Active or historical locations with feral/community cats
- **Foster homes** - Locations where cats are temporarily fostered
- **Adopter residences** - Homes where adopted cats live
- **Volunteer locations** - Volunteer home bases
- **Clinics** - Veterinary facilities
- And more...

This enables powerful queries like:
- "Show me foster homes in Petaluma"
- "List colony sites in West County"
- "How many cats has Jane Smith fostered?"

## Database Schema

### place_context_types (Lookup Table)

```sql
CREATE TABLE trapper.place_context_types (
    context_type TEXT PRIMARY KEY,
    display_label TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 100
);
```

**Standard Context Types:**

| context_type | display_label | Description |
|--------------|---------------|-------------|
| `colony_site` | Colony Site | Active or historical colony location |
| `foster_home` | Foster Home | Location where cats are fostered temporarily |
| `adopter_residence` | Adopter Residence | Home where adopted cats live |
| `volunteer_location` | Volunteer Location | Volunteer's home or base of operations |
| `trapper_base` | Trapper Base | Trapper's home or staging location |
| `trap_pickup` | Trap Pickup | Location for trap equipment pickup/dropoff |
| `clinic` | Veterinary Clinic | Vet clinic or medical facility |
| `shelter` | Shelter | Animal shelter or rescue facility |
| `partner_org` | Partner Organization | Partner organization (Sonoma Humane, etc.) |
| `feeding_station` | Feeding Station | Regular feeding location for community cats |

### place_contexts (Main Data Table)

```sql
CREATE TABLE trapper.place_contexts (
    context_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES trapper.places(place_id),
    context_type TEXT NOT NULL REFERENCES trapper.place_context_types(context_type),

    -- Temporal validity
    valid_from DATE,
    valid_to DATE,  -- NULL = currently active

    -- Evidence/provenance
    evidence_type TEXT,  -- 'request', 'appointment', 'outcome', 'manual', 'inferred'
    evidence_entity_id UUID,
    evidence_notes TEXT,

    -- Confidence & tracking
    confidence NUMERIC(3,2) DEFAULT 0.80,
    source_system TEXT,
    source_record_id TEXT,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    is_verified BOOLEAN DEFAULT FALSE,

    UNIQUE NULLS NOT DISTINCT (place_id, context_type, valid_to)
);
```

**Key Fields:**

- `valid_from` / `valid_to` - Temporal validity (NULL valid_to = currently active)
- `evidence_type` - How this context was established
- `confidence` - Confidence level (0.00 to 1.00)
- `is_verified` - Has been manually verified

## Evidence Types

| evidence_type | Description | Typical Confidence |
|---------------|-------------|-------------------|
| `request` | Established via trapping request | 0.85 |
| `appointment` | Established via clinic appointment | 0.80 |
| `outcome` | From ShelterLuv adoption/foster outcome | 0.90 |
| `manual` | Manually assigned by staff | 1.00 |
| `inferred` | Inferred from other data | 0.70 |

## Functions

### assign_place_context()

Idempotently assigns a context to a place. If the context already exists, updates confidence if higher.

```sql
SELECT trapper.assign_place_context(
    p_place_id := '123e4567-e89b-12d3-a456-426614174000',
    p_context_type := 'colony_site',
    p_valid_from := '2024-01-15',
    p_evidence_type := 'request',
    p_evidence_entity_id := '...',  -- Request ID
    p_confidence := 0.85,
    p_source_system := 'web_intake',
    p_source_record_id := 'REQ-001',
    p_assigned_by := 'auto_request_trigger'
);
```

### end_place_context()

Ends an active context by setting the `valid_to` date.

```sql
SELECT trapper.end_place_context(
    p_place_id := '123e4567-e89b-12d3-a456-426614174000',
    p_context_type := 'colony_site',
    p_end_date := '2024-06-30'  -- Optional, defaults to today
);
```

### infer_place_contexts_from_data()

Backfills contexts from existing data (requests, appointments, roles).

```sql
SELECT * FROM trapper.infer_place_contexts_from_data();
-- Returns counts of contexts created by type
```

## Views

### v_place_active_contexts

All currently active place contexts with labels.

```sql
SELECT * FROM trapper.v_place_active_contexts
WHERE context_type = 'colony_site';
```

### v_place_context_summary

Aggregated context information per place.

```sql
SELECT
    place_id,
    formatted_address,
    active_contexts,     -- Array of context types
    context_labels,      -- Array of display labels
    active_context_count
FROM trapper.v_place_context_summary
WHERE 'colony_site' = ANY(active_contexts);
```

## Auto-Assignment

### On Request Creation

When a request is created with a place, the `colony_site` context is automatically assigned via trigger:

```sql
CREATE TRIGGER trg_assign_colony_context_on_request
    AFTER INSERT ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_assign_colony_context_on_request();
```

### ShelterLuv Outcomes

When ShelterLuv adoption/return outcomes are processed, `adopter_residence` contexts are assigned to adopter addresses.

## Query Examples

### Find colony sites in a specific area

```sql
SELECT p.formatted_address, p.display_name
FROM trapper.places p
JOIN trapper.place_contexts pc ON pc.place_id = p.place_id
WHERE pc.context_type = 'colony_site'
  AND pc.valid_to IS NULL
  AND p.merged_into_place_id IS NULL
  AND p.formatted_address ILIKE '%Petaluma%';
```

### Find all contexts for a place

```sql
SELECT
    pct.display_label,
    pc.valid_from,
    pc.evidence_type,
    pc.confidence
FROM trapper.place_contexts pc
JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
WHERE pc.place_id = '...'
  AND pc.valid_to IS NULL;
```

### Count places by context type

```sql
SELECT
    context_type,
    COUNT(*) as active_count
FROM trapper.place_contexts
WHERE valid_to IS NULL
GROUP BY context_type
ORDER BY active_count DESC;
```

## Person-Cat Relationships

The system also tracks person-cat relationships (foster, adopter, owner, caretaker).

### person_cat_relationships Table

```sql
CREATE TABLE trapper.person_cat_relationships (
    person_id UUID REFERENCES trapper.sot_people(person_id),
    cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    relationship_type TEXT,  -- 'foster', 'adopter', 'owner', 'caretaker'
    confidence TEXT,
    source_system TEXT,
    source_table TEXT,
    PRIMARY KEY (person_id, cat_id, relationship_type, source_system, source_table)
);
```

### Query Foster/Adopter History

```sql
-- Find how many cats a person has adopted
SELECT * FROM trapper.query_person_cat_history(
    p_person_name := 'Smith',
    p_email := NULL,
    p_relationship_type := 'adopter'
);
```

### Process ShelterLuv Outcomes

```sql
-- Process adoption/return outcomes (creates relationships + place contexts)
SELECT * FROM trapper.process_shelterluv_outcomes(500);
```

## Data Quality

### Duplicate Detection

Run the duplicate detection script to check for issues:

```bash
node scripts/data-quality/check_duplicates.mjs --verbose
```

### Fix Orphaned Relationships

```bash
node scripts/data-quality/check_duplicates.mjs --fix
```

### Test Suite

Run the Tippy tools test suite to verify data integrity:

```bash
node scripts/testing/test_tippy_tools.mjs
```

## Tippy Integration

Tippy has tools to query place contexts and person-cat relationships:

- `query_places_by_context` - Find places by context type and area
- `query_person_cat_relationships` - Get foster/adopter history for a person
- `query_cat_journey` - Track a cat's journey through FFSC

Example Tippy queries:
- "Show me foster homes in Petaluma"
- "How many cats has Jane Smith fostered?"
- "What is the journey of cat with microchip 985112345678901?"
