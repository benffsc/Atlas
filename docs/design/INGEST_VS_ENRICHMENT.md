# Ingest vs Enrichment: Protecting Manual Corrections

## The Problem

When we re-ingest ClinicHQ data:
- Should `entity_type = 'site'` be preserved?
- Should manual corrections survive?
- What if ClinicHQ renames an account?

## The Solution: Field Classification

### Source-Derived Fields (CAN be overwritten by re-ingest)
These come directly from source systems and should be updated when source changes:
- `display_name` (from ClinicHQ name)
- `sex`, `altered_status` (from ClinicHQ)
- `microchip`, `breed`, `color` (from ClinicHQ)

### Enrichment Fields (MUST be preserved)
These are Atlas-only additions that don't exist in source:
- `entity_type` (person/site/business)
- `quality_tier` (data quality assessment)
- `verified_at`, `verified_by` (manual verification)
- Manual relationships (person-place links added by staff)
- Journal entries
- Notes

## Implementation

### 1. Ingest Process Rules

```sql
-- When re-ingesting, use UPSERT that preserves enrichments:
INSERT INTO sot_people (person_id, display_name, data_source, ...)
VALUES (...)
ON CONFLICT (person_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,  -- Source field: overwrite
    data_source = EXCLUDED.data_source,    -- Source field: overwrite
    updated_at = NOW()
    -- entity_type NOT updated (enrichment: preserve)
    -- verified_at NOT updated (enrichment: preserve)
;
```

### 2. Identity Matching

The key to stable data is IDENTITY, not name:
- Match by EMAIL first (strongest identifier)
- Match by PHONE if no email
- Match by NAME + ADDRESS as last resort

When ClinicHQ renames "Cal Eggs FFSC" to "Cal Eggs Farm":
- If same phone (7075767999), it's the SAME entity
- Update display_name, preserve entity_type

### 3. Column Classification Table

```sql
CREATE TABLE IF NOT EXISTS trapper.field_classifications (
    table_name TEXT,
    column_name TEXT,
    classification TEXT CHECK (classification IN ('source', 'enrichment', 'computed')),
    PRIMARY KEY (table_name, column_name)
);

INSERT INTO trapper.field_classifications VALUES
    ('sot_people', 'display_name', 'source'),
    ('sot_people', 'data_source', 'source'),
    ('sot_people', 'entity_type', 'enrichment'),
    ('sot_people', 'verified_at', 'enrichment'),
    ('sot_cats', 'display_name', 'source'),
    ('sot_cats', 'sex', 'source'),
    ('sot_cats', 'quality_tier', 'enrichment'),
    -- etc.
;
```

## Workflow for Manual Fixes

1. **Safe to do in Atlas:**
   - Set entity_type (preserved)
   - Add journal notes (preserved)
   - Create person-place relationships (preserved)
   - Verify/flag records (preserved)

2. **Should do in ClinicHQ instead:**
   - Rename accounts (source field)
   - Merge duplicate accounts (affects identity)
   - Fix misspellings (source field)

3. **Requires coordination:**
   - Account merges (fix in ClinicHQ, then re-ingest)
   - Major data corrections (fix source, let Atlas update)

## Cal Eggs Example

**Current state:**
- ClinicHQ has "Cal Eggs FFSC" (phone: 7075767999)
- Atlas doesn't have it (no email = not created)

**Solution:**
1. In Atlas: Create person from phone identifier (expand ingest)
2. Mark entity_type = 'site' (enrichment, preserved)
3. If ClinicHQ renames to "Cal Eggs Farm":
   - Re-ingest matches by phone
   - display_name updates to "Cal Eggs Farm"
   - entity_type = 'site' stays

## Future: Native Atlas Workflows

When staff creates a request natively in Atlas:
- Person/site is created with Atlas as data_source
- Full control over all fields
- Links cats manually to requests
- No dependency on ClinicHQ account structure
