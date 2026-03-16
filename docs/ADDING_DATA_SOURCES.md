# Adding New Data Sources to Atlas

This guide explains how to integrate a new external data source into Atlas while maintaining the unified data architecture.

## Overview

Atlas uses a three-layer data model for external data sources:

1. **Raw Layer** (`ops.staged_records`) - Immutable audit trail of all incoming data
2. **Identity Resolution Layer** - Matching via email/phone/microchip using normalized identifiers
3. **Source of Truth Layer** (`sot.*` tables) - Canonical entities with the best data from all sources

When adding a new data source, you need to integrate with all three layers.

## Prerequisites

Before starting, understand:
- What entity types the source provides (people, cats, places, appointments, etc.)
- What identifiers the source provides (emails, phones, microchips, names)
- How reliable/authoritative the source is compared to existing sources
- Whether the source provides real-time webhooks or requires batch sync

## Step-by-Step Integration

### Step 1: Define Source Confidence Levels

First, register the new source's confidence levels for identity matching.

```sql
-- File: sql/schema/sot/MIG_XXX__add_newsource_confidence.sql

\echo '=============================================='
\echo 'MIG_XXX: Add NewsSource confidence levels'
\echo '=============================================='

-- Define how much we trust this source's identifiers for matching
INSERT INTO ops.source_identity_confidence (
  source_system,
  email_confidence,    -- How reliable are emails from this source? (0-1)
  phone_confidence,    -- How reliable are phone numbers? (0-1)
  name_only_confidence, -- Can we match by name alone? (usually 0.40)
  source_id_confidence, -- How reliable are internal IDs? (0-1)
  data_quality_tier    -- 'high', 'medium', or 'low'
) VALUES (
  'newsource',         -- Use snake_case, all lowercase
  0.85,                -- Email confidence
  0.80,                -- Phone confidence
  0.40,                -- Name-only confidence (keep low to prevent false matches)
  0.80,                -- Source ID confidence
  'medium'             -- Data quality tier
);

COMMENT ON TABLE ops.source_identity_confidence IS
  'newsource: [Description of the source and why these confidence levels]';
```

**Confidence Level Guidelines:**
- `0.95-1.00` - Verified identity provider (OAuth, verified email)
- `0.80-0.95` - Professional system with data validation (ClinicHQ, ShelterLuv)
- `0.60-0.80` - User-submitted with some validation (web forms with email confirm)
- `0.40-0.60` - User-submitted without validation (intake forms, manual entry)
- `<0.40` - Unreliable or partial data

### Step 2: Define Survivorship Priority

When the same field exists in multiple sources, define which source "wins":

```sql
-- File: sql/schema/sot/MIG_XXX__add_newsource_survivorship.sql

-- For each field that newsource provides, define priority
INSERT INTO ops.survivorship_priority (entity_type, field_name, priority_order)
VALUES
  -- For cats, microchip from ClinicHQ is most authoritative
  ('cat', 'microchip', ARRAY['clinichq', 'petlink', 'newsource', 'shelterluv', 'airtable']),

  -- For people, email from verified sources wins
  ('person', 'email', ARRAY['clinichq', 'newsource', 'shelterluv', 'airtable', 'web_intake'])
ON CONFLICT (entity_type, field_name) DO UPDATE
SET priority_order = EXCLUDED.priority_order;
```

### Step 3: Create Extension Table

Each source gets its own extension table to store source-specific fields that don't fit the canonical schema.

```sql
-- File: sql/schema/sot/MIG_XXX__newsource_extension_tables.sql

\echo '=============================================='
\echo 'MIG_XXX: Create NewsSource extension tables'
\echo '=============================================='

-- Extension table for cats from this source
CREATE TABLE IF NOT EXISTS source.newsource_cat_ext (
  -- Primary key from source system
  newsource_id TEXT PRIMARY KEY,

  -- Raw source fields (preserve exactly as received)
  animal_name TEXT,
  microchip TEXT,
  breed TEXT,
  color TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  -- Add all source-specific fields here
  custom_field_1 TEXT,
  custom_field_2 TEXT,

  -- Generated normalized fields for matching (CRITICAL for identity resolution)
  microchip_norm TEXT GENERATED ALWAYS AS (
    REGEXP_REPLACE(microchip, '[^0-9]', '', 'g')
  ) STORED,
  email_norm TEXT GENERATED ALWAYS AS (
    LOWER(TRIM(owner_email))
  ) STORED,
  phone_norm TEXT GENERATED ALWAYS AS (
    sot.norm_phone_us(owner_phone)
  ) STORED,

  -- Atlas linking (filled by processor)
  matched_cat_id UUID REFERENCES sot.cats(cat_id),
  matched_owner_id UUID REFERENCES sot.people(person_id),
  match_confidence NUMERIC,
  match_method TEXT,  -- 'microchip', 'email', 'phone', 'manual', etc.

  -- Processing status
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'processed', 'error', 'skipped')),
  error_message TEXT,

  -- Metadata
  raw_data JSONB,           -- Full original record
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient matching
CREATE INDEX IF NOT EXISTS idx_newsource_cat_microchip ON source.newsource_cat_ext(microchip_norm)
  WHERE microchip_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsource_cat_email ON source.newsource_cat_ext(email_norm)
  WHERE email_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsource_cat_status ON source.newsource_cat_ext(sync_status);

-- Create similar extension tables for people, places, appointments as needed
```

### Step 4: Register Data Engine Processor

Register a processor function that the data engine will call:

```sql
-- File: sql/schema/sot/MIG_XXX__newsource_processor.sql

INSERT INTO ops.data_engine_processors (
  processor_name,
  source_system,
  source_table,
  entity_type,
  processor_function,
  priority,          -- Lower = runs first (50-100 for normal sources)
  is_active
) VALUES (
  'newsource_cat',
  'newsource',
  'cats',
  'cat',
  'process_newsource_cat',
  60,
  true
);
```

### Step 5: Create Processor Function

The processor function handles identity resolution and entity creation:

```sql
-- File: sql/schema/sot/MIG_XXX__newsource_processor_function.sql

CREATE OR REPLACE FUNCTION ops.process_newsource_cat(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_cat_id UUID;
  v_owner_id UUID;
  v_result JSONB;
BEGIN
  -- Get the staged record
  SELECT * INTO v_record
  FROM ops.staged_records
  WHERE staged_record_id = p_staged_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Record not found');
  END IF;

  -- Extract data from raw_data JSONB
  -- Use COALESCE and NULLIF for clean handling

  -- 1. Find or create the owner (if owner info present)
  IF (v_record.raw_data->>'owner_email') IS NOT NULL OR
     (v_record.raw_data->>'owner_phone') IS NOT NULL THEN

    -- ALWAYS use centralized function - NEVER inline INSERT
    SELECT person_id INTO v_owner_id
    FROM sot.find_or_create_person(
      p_email := NULLIF(TRIM(v_record.raw_data->>'owner_email'), ''),
      p_phone := NULLIF(TRIM(v_record.raw_data->>'owner_phone'), ''),
      p_first_name := NULLIF(TRIM(v_record.raw_data->>'owner_first_name'), ''),
      p_last_name := NULLIF(TRIM(v_record.raw_data->>'owner_last_name'), ''),
      p_address := NULL,
      p_source_system := 'newsource'
    );
  END IF;

  -- 2. Find or create the cat
  -- ALWAYS use centralized function - NEVER inline INSERT
  SELECT cat_id INTO v_cat_id
  FROM sot.find_or_create_cat_by_microchip(
    p_microchip := NULLIF(TRIM(v_record.raw_data->>'microchip'), ''),
    p_name := NULLIF(TRIM(v_record.raw_data->>'animal_name'), ''),
    p_sex := NULLIF(TRIM(v_record.raw_data->>'sex'), ''),
    p_breed := NULLIF(TRIM(v_record.raw_data->>'breed'), ''),
    p_color := NULLIF(TRIM(v_record.raw_data->>'color'), ''),
    p_source_system := 'newsource',
    p_source_record_id := v_record.raw_data->>'newsource_id'
  );

  -- 3. Link cat to owner if both exist
  IF v_cat_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    INSERT INTO sot.person_cat (
      person_id, cat_id, relationship_type, source_system, source_record_id
    ) VALUES (
      v_owner_id, v_cat_id, 'owner', 'newsource', v_record.raw_data->>'newsource_id'
    ) ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;
  END IF;

  -- 4. Update extension table with matched IDs
  UPDATE source.newsource_cat_ext
  SET
    matched_cat_id = v_cat_id,
    matched_owner_id = v_owner_id,
    match_confidence = 0.85,  -- Based on source confidence
    match_method = CASE
      WHEN v_record.raw_data->>'microchip' IS NOT NULL THEN 'microchip'
      WHEN v_record.raw_data->>'owner_email' IS NOT NULL THEN 'email'
      ELSE 'name'
    END,
    sync_status = 'processed',
    processed_at = NOW()
  WHERE newsource_id = v_record.raw_data->>'newsource_id';

  -- 5. Update staged record status
  UPDATE ops.staged_records
  SET
    processing_status = 'processed',
    processed_at = NOW(),
    result_entity_id = v_cat_id,
    result_entity_type = 'cat'
  WHERE staged_record_id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'cat_id', v_cat_id,
    'owner_id', v_owner_id
  );

EXCEPTION WHEN OTHERS THEN
  -- Log error and continue
  UPDATE ops.staged_records
  SET
    processing_status = 'error',
    error_message = SQLERRM
  WHERE staged_record_id = p_staged_record_id;

  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
```

### Step 6: Create Ingest Script

Create a Node.js script to fetch and stage data:

```javascript
// File: scripts/ingest/newsource_sync.mjs

import { createClient } from '@supabase/supabase-js';

const SOURCE_SYSTEM = 'newsource';
const BATCH_SIZE = 100;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Fetch records from NewsSource API
 */
async function fetchFromNewsource(cursor = null) {
  const response = await fetch('https://api.newsource.com/animals', {
    headers: {
      'Authorization': `Bearer ${process.env.NEWSOURCE_API_KEY}`,
    },
    body: JSON.stringify({ cursor, limit: BATCH_SIZE }),
  });

  if (!response.ok) {
    throw new Error(`NewsSource API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Stage a record for processing
 */
async function stageRecord(record) {
  // Check for existing record
  const { data: existing } = await supabase
    .from('staged_records')
    .select('staged_record_id')
    .eq('source_system', SOURCE_SYSTEM)
    .eq('source_record_id', record.id)
    .single();

  if (existing) {
    console.log(`Skipping existing record: ${record.id}`);
    return null;
  }

  // Stage the record
  const { data, error } = await supabase
    .from('staged_records')
    .insert({
      source_system: SOURCE_SYSTEM,
      source_record_id: record.id,
      entity_type: 'cat',
      raw_data: record,
      processing_status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error(`Error staging record ${record.id}:`, error);
    return null;
  }

  // Also insert into extension table
  await supabase.from('newsource_cat_ext').upsert({
    newsource_id: record.id,
    animal_name: record.name,
    microchip: record.microchip,
    breed: record.breed,
    color: record.color,
    owner_email: record.owner?.email,
    owner_phone: record.owner?.phone,
    raw_data: record,
    sync_status: 'pending',
  });

  return data;
}

/**
 * Process staged records through data engine
 */
async function processStaged() {
  const { data: pending } = await supabase
    .from('staged_records')
    .select('staged_record_id')
    .eq('source_system', SOURCE_SYSTEM)
    .eq('processing_status', 'pending')
    .limit(BATCH_SIZE);

  for (const record of pending || []) {
    // Call processor function
    const { error } = await supabase.rpc('process_newsource_cat', {
      p_staged_record_id: record.staged_record_id,
    });

    if (error) {
      console.error(`Error processing ${record.staged_record_id}:`, error);
    }
  }
}

/**
 * Main sync function
 */
async function main() {
  console.log(`Starting ${SOURCE_SYSTEM} sync...`);

  let cursor = null;
  let totalStaged = 0;

  do {
    const response = await fetchFromNewsource(cursor);

    for (const record of response.data) {
      const staged = await stageRecord(record);
      if (staged) totalStaged++;
    }

    cursor = response.next_cursor;
  } while (cursor);

  console.log(`Staged ${totalStaged} new records`);

  // Process staged records
  await processStaged();

  console.log('Sync complete');
}

main().catch(console.error);
```

### Step 7: Update Tippy Lookups

Add the new source to Tippy's comprehensive lookup tools:

```sql
-- File: sql/schema/sot/MIG_XXX__update_tippy_lookups.sql

-- Update comprehensive_cat_lookup to include newsource
CREATE OR REPLACE FUNCTION sot.comprehensive_cat_lookup(p_cat_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'cat', row_to_json(c),
    'identifiers', (SELECT jsonb_agg(row_to_json(i)) FROM sot.cat_identifiers i WHERE i.cat_id = p_cat_id),
    'appointments', (SELECT jsonb_agg(row_to_json(a)) FROM ops.appointments a WHERE a.cat_id = p_cat_id),
    'relationships', (SELECT jsonb_agg(row_to_json(r)) FROM sot.person_cat r WHERE r.cat_id = p_cat_id),
    'places', (SELECT jsonb_agg(row_to_json(p)) FROM sot.cat_place p WHERE p.cat_id = p_cat_id),
    -- Add newsource extension data
    'newsource_data', (SELECT row_to_json(n) FROM source.newsource_cat_ext n WHERE n.matched_cat_id = p_cat_id),
    -- Add shelterluv extension data
    'shelterluv_data', (SELECT row_to_json(s) FROM source.shelterluv_cat_ext s WHERE s.matched_cat_id = p_cat_id)
  ) INTO v_result
  FROM sot.cats c
  WHERE c.cat_id = p_cat_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Also update query_source_extension to handle the new source
-- (in apps/web/src/app/api/tippy/tools.ts - add to EXTENSION_TABLES map)
```

### Step 8: Add Tippy Tool Handler

Update the Tippy tools to handle the new source:

```typescript
// File: apps/web/src/app/api/tippy/tools.ts

// Add to EXTENSION_TABLES map
const EXTENSION_TABLES: Record<string, string> = {
  clinichq: 'clinichq_appointment_ext',
  shelterluv: 'shelterluv_cat_ext',
  airtable: 'airtable_request_ext',
  newsource: 'newsource_cat_ext',  // Add new source
};

// Update query_source_extension handler
case 'query_source_extension': {
  const { source_system, entity_type, entity_id } = args;
  const table = EXTENSION_TABLES[source_system];

  if (!table) {
    return { error: `Unknown source system: ${source_system}` };
  }

  // Query extension table...
}
```

### Step 9: Create E2E Tests

Add tests to verify the integration:

```typescript
// File: apps/web/e2e/newsource-integration.spec.ts

import { test, expect } from '@playwright/test';

test.describe('NewsSource Integration', () => {
  test('Source appears in confidence table', async ({ request }) => {
    const response = await request.post('/api/tippy/chat', {
      data: {
        messages: [{ role: 'user', content: 'What is the confidence level for newsource data?' }],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.response).toContain('newsource');
  });

  test('Tippy can query newsource extension data', async ({ request }) => {
    const response = await request.post('/api/tippy/chat', {
      data: {
        messages: [{ role: 'user', content: 'Show me newsource-specific data for any cat' }],
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('Comprehensive lookup includes newsource', async ({ request }) => {
    const response = await request.post('/api/tippy/chat', {
      data: {
        messages: [{ role: 'user', content: 'Get comprehensive data for any cat including all source systems' }],
      },
    });

    expect(response.ok()).toBeTruthy();
  });
});
```

### Step 10: Documentation

Update the main documentation:

```markdown
// Add to CLAUDE.md

### Source Systems

| Source | Confidence | Description |
|--------|------------|-------------|
| clinichq | high | ClinicHQ veterinary management |
| shelterluv | high | ShelterLuv adoption/intake |
| airtable | medium | Airtable legacy data |
| web_intake | medium | Web intake form submissions |
| newsource | medium | [Description of new source] |
```

## Checklist

When adding a new data source, ensure you have:

- [ ] Defined source confidence levels in `source_identity_confidence`
- [ ] Defined survivorship priority for conflicting fields
- [ ] Created extension table(s) with normalized columns
- [ ] Registered processor in `data_engine_processors`
- [ ] Created processor function using centralized `find_or_create_*` functions
- [ ] Created ingest script in `scripts/ingest/`
- [ ] Updated Tippy comprehensive lookups
- [ ] Updated `query_source_extension` tool handler
- [ ] Created E2E tests
- [ ] Updated documentation

## Common Mistakes to Avoid

1. **Direct INSERTs into sot.* tables** - Always use `find_or_create_*` functions
2. **Custom source_system values** - Use approved values only
3. **Missing normalized columns** - Always create `*_norm` columns for matching
4. **Forgetting extension table indexes** - Index all columns used for matching
5. **Not handling merged entities** - Check `merged_into_*` columns
6. **Hardcoded confidence values** - Use values from `source_identity_confidence`

## Troubleshooting

### Records Not Matching

Check that normalized columns are populated:
```sql
SELECT newsource_id, email_norm, phone_norm, microchip_norm
FROM source.newsource_cat_ext
WHERE sync_status = 'pending';
```

### Processor Errors

Check ops.staged_records for errors:
```sql
SELECT source_record_id, error_message
FROM ops.staged_records
WHERE source_system = 'newsource'
  AND processing_status = 'error';
```

### Tippy Not Finding Data

Verify extension table is in EXTENSION_TABLES map in `tools.ts`.

## Related Documentation

- `docs/DATA_INGESTION_RULES.md` - General ingestion guidelines
- `docs/IDENTITY_RESOLUTION.md` - How identity matching works
- `CLAUDE.md` - Development rules and conventions
