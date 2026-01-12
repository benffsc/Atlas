# Site vs Person Data Model Proposal

## Problem

In ClinicHQ, "clients" can be:
1. **Actual people**: "Corrine Hodges", "Mary Schollmann"
2. **Sites/businesses**: "Cal Eggs FFSC", "Chevron Todd Rd"
3. **Addresses as names**: "323 Anteeo Way Anteeo Way"

These all get imported as `sot_people` which causes confusion:
- Staff search for "Cal Eggs" expecting a site, find a "person"
- Duplicate accounts when same site gets different names
- No way to show "Corrine Hodges lives at Cal Eggs property"

## Current State

- 40+ "FFSC" entries in sot_people are sites, not people
- Names ending in addresses or business patterns are likely sites
- No way to link multiple people to the same site

## Proposed Solution

### 1. Add `entity_type` to sot_people

```sql
ALTER TABLE trapper.sot_people
ADD COLUMN entity_type TEXT DEFAULT 'person'
CHECK (entity_type IN ('person', 'business', 'site', 'unknown'));
```

This allows marking records as sites vs people without restructuring.

### 2. Create site_aliases table

```sql
CREATE TABLE trapper.site_aliases (
    alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID REFERENCES trapper.places(place_id),
    alias_name TEXT NOT NULL,
    alias_type TEXT DEFAULT 'name', -- 'name', 'account_name', 'historical'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This allows "Cal Eggs" place to have aliases:
- "Cal Eggs"
- "Cal Eggs FFSC"
- "Hodges Property"
- "Cal Eggs Farm"

### 3. Link people to sites

The existing `person_place_relationships` already supports this with roles:
- Corrine Hodges → Cal Eggs Place (role: 'resident')
- FFSC Contact → Cal Eggs Place (role: 'contact')

### 4. Detection heuristics

Auto-detect likely sites based on patterns:
- Name ends in "FFSC"
- First name = Last name (and looks like address/business)
- Name contains street suffixes (Rd, Ave, Ln, etc.)
- Name matches known business patterns

## Migration Path

1. **Add entity_type column** (safe, additive)
2. **Create site_aliases table** (safe, new table)
3. **Batch classify obvious sites** (FFSC pattern, etc.)
4. **UI updates** to show entity type badge
5. **Search updates** to allow filtering by type

## Staff Workflow

When staff recognizes "Cal Eggs" situation:
1. Search for "Cal Eggs"
2. See all related entities (sites, people, cats)
3. Mark appropriate record as "site" type
4. Add aliases if needed
5. Link people (Corrine Hodges) to the site

## UI Changes

- Person detail page shows entity type badge
- Sites get different styling (building icon vs person icon)
- Site pages show associated people
- Search results indicate type

## Example: Cal Eggs

After migration:
- **Place**: Cal Eggs Farm (address: actual location)
  - Aliases: "Cal Eggs", "Cal Eggs FFSC", "Hodges Property"
- **Person**: "Cal Eggs FFSC" marked as entity_type='business' (legacy account)
- **Person**: Corrine Hodges
  - Linked to Cal Eggs place as 'resident'
  - Has her own contact info
- **Cats**: Linked to place, associated with Corrine via clinic visits
