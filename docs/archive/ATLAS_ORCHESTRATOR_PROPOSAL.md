# Atlas Orchestrator Proposal

**Version:** 1.0
**Created:** 2026-01-28
**Status:** Proposal (pre-implementation)
**Owner:** Engineering

---

## Problem Statement

Atlas has grown organically. Each data source (ClinicHQ, Airtable, ShelterLuv, web intake, VolunteerHub, PetLink, Google Maps) has its own ingestion script with hand-wired routing. Adding a new source today requires:

1. A custom ingest script in `scripts/ingest/`
2. A custom SQL processor function
3. Manual registration in `data_engine_processors`
4. Custom entity-linking logic
5. Knowledge of which `find_or_create_*` functions to call and in what order

The pipeline stages (stage → process → link → enrich → classify) exist but are stitched together with source-specific glue. The Orchestrator makes this **configuration-driven** without rewriting the working engines underneath.

---

## What Already Works (Do Not Replace)

Before proposing anything new, here is what Atlas already has that the Orchestrator **wraps, not replaces**:

| System | Status | What It Does |
|--------|--------|-------------|
| `staged_records` | Production | Immutable audit trail, row-hash dedup, JSONB payloads |
| `processing_jobs` | Production | Job queue with priority, retry, heartbeat, SKIP LOCKED claiming |
| `enqueue_processing()` | Production | Creates jobs from staged records |
| `process_next_job()` | Production | Routes jobs to processor functions by source_system |
| `data_engine_processors` | Production | Registry of 11 processor functions with priority ordering |
| `find_or_create_*()` | Production | Centralized entity creation with dedup (people, places, cats, requests) |
| `data_engine_resolve_identity()` | Production | Multi-signal weighted identity matching with audit trail |
| `run_all_entity_linking()` | Production | Post-processing relationship creation (6 linking operations) |
| `extraction_queue` | Production | AI enrichment pipeline with priority and trigger reasons |
| `assign_place_context()` | Production | Classification with Manual > AI enforcement |
| `POST /api/ingest/process` | Production | Cron endpoint calling `process_next_job()` every 10 min |
| `GET /api/health/processing` | Production | Pipeline health monitoring with degradation detection |

**Key insight:** The processing pipeline is mature. 11 processor functions are registered. The job queue handles claiming, retry, and heartbeat. What's missing is not the engine — it's the **coordination layer** that ties source registration, field mapping, routing decisions, and health checks into a single queryable system.

---

## Proposed Architecture

```
                        ATLAS ORCHESTRATOR
                        (Coordination Layer)
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Source Registry   │  │ Routing Rules    │  │ Health       │  │
│  │ (orchestrator_    │  │ (orchestrator_   │  │ Dashboard    │  │
│  │  sources)         │──│  routing_rules)  │──│ (views +     │  │
│  │                   │  │                  │  │  functions)  │  │
│  │ What sources      │  │ Field → Surface  │  │              │  │
│  │ exist, their      │  │ mappings         │  │ Throughput,  │  │
│  │ schemas, how      │  │                  │  │ errors,      │  │
│  │ to parse them     │  │ Provenance       │  │ anomalies,   │  │
│  │                   │  │ templates        │  │ "why missing" │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│           │                      │                     │         │
│           ▼                      ▼                     ▼         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Orchestrator Job Log                         │   │
│  │   (orchestrator_job_log)                                  │   │
│  │   Every routing decision debuggable:                      │   │
│  │   routed / skipped / merged / rejected / anomaly_flagged  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           │ WRAPS (does not replace)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXISTING ENGINES                               │
│                                                                   │
│  staged_records → processing_jobs → processor functions           │
│       ↓               ↓                    ↓                      │
│  enqueue_         process_next_     find_or_create_*()           │
│  processing()     job()             data_engine_resolve_identity()│
│       ↓               ↓                    ↓                      │
│  extraction_      run_all_entity_   assign_place_context()       │
│  queue            linking()                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Source Registry

### What It Is

A single table that declares every data source Atlas has ever ingested, with metadata about schema, parsing rules, and expected entity types.

### Why We Need It

Today, to answer "what sources feed Atlas?" you must grep through:
- 15+ ingest scripts in `scripts/ingest/`
- 11 processor registrations in `data_engine_processors`
- `staged_records` source_system values
- Various migration comments

The Source Registry makes this one query.

### Schema

```sql
CREATE TABLE trapper.orchestrator_sources (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    source_system TEXT NOT NULL,         -- 'clinichq', 'airtable', 'shelterluv', etc.
    source_table TEXT NOT NULL,          -- 'cat_info', 'trapping_requests', etc.
    display_name TEXT NOT NULL,          -- 'ClinicHQ Cat Records'

    -- Schema declaration
    expected_fields JSONB,              -- [{field: "microchip", type: "text", required: true}, ...]
    id_field_candidates TEXT[],         -- ['appointment_number', 'id'] for source_row_id extraction

    -- Pipeline configuration
    entity_types_produced TEXT[],       -- ['cat', 'person', 'place']
    processor_name TEXT,                -- FK to data_engine_processors.processor_name
    ingest_method TEXT NOT NULL,        -- 'file_upload', 'api_sync', 'webhook', 'manual_entry'
    ingest_frequency TEXT,              -- 'daily', 'weekly', 'on_demand', 'realtime'

    -- Health tracking
    last_ingest_at TIMESTAMPTZ,
    last_ingest_record_count INT,
    total_records_ingested BIGINT DEFAULT 0,
    total_entities_created BIGINT DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (source_system, source_table)
);
```

### Initial Population

```sql
INSERT INTO trapper.orchestrator_sources
    (source_system, source_table, display_name, entity_types_produced, processor_name, ingest_method, ingest_frequency)
VALUES
    ('clinichq', 'cat_info', 'ClinicHQ Cat Records', '{cat}', 'clinichq_cat', 'file_upload', 'weekly'),
    ('clinichq', 'owner_info', 'ClinicHQ Owner Records', '{person,place}', 'clinichq_owner', 'file_upload', 'weekly'),
    ('clinichq', 'appointment_info', 'ClinicHQ Appointments', '{appointment}', 'clinichq_appointment', 'file_upload', 'weekly'),
    ('airtable', 'trapping_requests', 'Airtable Trapping Requests', '{request,person,place}', 'airtable_trapping_request', 'api_sync', 'daily'),
    ('airtable', 'appointment_requests', 'Airtable Appointment Requests', '{request,person,place}', 'airtable_appointment_request', 'api_sync', 'daily'),
    ('shelterluv', 'animals', 'ShelterLuv Animals', '{cat}', 'shelterluv_animal', 'api_sync', 'daily'),
    ('shelterluv', 'people', 'ShelterLuv People', '{person}', 'shelterluv_person', 'api_sync', 'daily'),
    ('shelterluv', 'outcomes', 'ShelterLuv Outcomes', '{relationship}', 'shelterluv_outcome', 'api_sync', 'daily'),
    ('petlink', 'pets', 'PetLink Pets', '{cat}', 'petlink_pet', 'file_upload', 'monthly'),
    ('petlink', 'owners', 'PetLink Owners', '{person}', 'petlink_owner', 'file_upload', 'monthly'),
    ('volunteerhub', 'users', 'VolunteerHub Users', '{person}', 'volunteerhub_user', 'api_sync', 'weekly'),
    ('web_intake', 'submissions', 'Web Intake Submissions', '{person,place,request}', NULL, 'realtime', 'realtime'),
    ('atlas_ui', 'manual_entry', 'Staff Manual Entry', '{person,place,cat,request}', NULL, 'manual_entry', 'realtime');
```

### Queries It Enables

```sql
-- What sources feed Atlas?
SELECT source_system, source_table, display_name, is_active, last_ingest_at
FROM trapper.orchestrator_sources ORDER BY source_system;

-- Which sources haven't ingested in 7 days?
SELECT display_name, last_ingest_at, ingest_frequency
FROM trapper.orchestrator_sources
WHERE is_active AND last_ingest_at < NOW() - INTERVAL '7 days'
  AND ingest_frequency != 'on_demand';

-- What entity types does each source produce?
SELECT source_system, source_table, unnest(entity_types_produced) AS entity_type
FROM trapper.orchestrator_sources WHERE is_active;
```

---

## Component 2: Routing Rules

### What It Is

A declarative mapping from source fields to canonical surfaces. Instead of hard-coding "when clinichq_owner_info has an email, call find_or_create_person()" inside a processor function, the routing is declared as data.

### Why We Need It

Today, routing logic is embedded in:
- `process_clinichq_owner_info()` (240+ lines of PL/pgSQL)
- `process_clinichq_cat_info()` (150+ lines)
- `process_shelterluv_person()` (200+ lines)
- Each new source needs a new function

The Routing Rules table captures the **intent** (field X maps to surface Y) separately from the **execution** (the processor function). This means:
1. You can see all routing in one table
2. You can add simple field mappings without writing PL/pgSQL
3. Complex mappings still use processor functions (the rules point to them)

### Schema

```sql
CREATE TABLE trapper.orchestrator_routing_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source declaration
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,

    -- Field mapping
    source_field TEXT NOT NULL,              -- JSON path in staged_records.payload
    target_surface TEXT NOT NULL,            -- 'sot_people', 'person_identifiers', 'places', etc.
    target_field TEXT,                       -- Column name on target surface (NULL = complex routing)
    target_function TEXT,                    -- Function to call (e.g., 'find_or_create_person')

    -- Routing behavior
    routing_type TEXT NOT NULL DEFAULT 'direct',  -- 'direct', 'transform', 'function_call'
    transform_expression TEXT,               -- SQL expression for transforms (e.g., 'norm_phone_us($1)')
    is_required BOOLEAN DEFAULT FALSE,       -- Fail if field missing?
    skip_if_empty BOOLEAN DEFAULT TRUE,      -- Skip routing if source field is NULL/empty?

    -- Provenance
    provenance_template JSONB,              -- How to construct provenance record

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    FOREIGN KEY (source_system, source_table)
        REFERENCES trapper.orchestrator_sources(source_system, source_table)
);
```

### Example Mappings

```sql
-- ClinicHQ owner_info field mappings
INSERT INTO trapper.orchestrator_routing_rules
    (source_system, source_table, source_field, target_surface, target_field, routing_type, target_function)
VALUES
    -- Person creation
    ('clinichq', 'owner_info', 'owner_email', 'sot_people', 'email', 'function_call', 'find_or_create_person'),
    ('clinichq', 'owner_info', 'owner_phone', 'person_identifiers', 'phone', 'transform', 'norm_phone_us($1)'),
    ('clinichq', 'owner_info', 'owner_first_name', 'sot_people', 'first_name', 'direct', NULL),
    ('clinichq', 'owner_info', 'owner_last_name', 'sot_people', 'last_name', 'direct', NULL),

    -- Place creation
    ('clinichq', 'owner_info', 'owner_address', 'places', 'formatted_address', 'function_call', 'find_or_create_place_deduped'),

    -- Hypothetical new source
    ('client_survey', 'responses', 'cat_count', 'place_colony_estimates', 'total_cats', 'direct', NULL),
    ('client_survey', 'responses', 'address', 'places', 'formatted_address', 'function_call', 'find_or_create_place_deduped');
```

### Key Design Decisions

1. **Routing rules don't replace processor functions.** Complex processors (like `process_clinichq_appointment_info` with its 250+ lines of business logic) keep running. The routing rules document their behavior and enable simpler sources to be wired without writing PL/pgSQL.

2. **Rules are descriptive first, prescriptive later.** Phase 1 populates rules to match existing processor behavior (documentation). Phase 2 adds a generic router that can execute simple `direct` and `transform` rules without a custom function.

3. **Complex routing uses `routing_type = 'function_call'`** which delegates to existing processor functions. The orchestrator doesn't try to replicate their logic.

---

## Component 3: Job Log (Debuggable Routing)

### What It Is

An append-only log of every routing decision the orchestrator makes: what was routed, where, why, and what happened.

### Why We Need It

Today, when data is missing, the debugging process is:
1. Check `staged_records` — was it ingested? (Often yes)
2. Check `processing_jobs` — was it processed? (Often stuck in `queued`)
3. If processed, check entities — was it linked? (Need to manually trace)
4. If not linked, why? (Need to read processor function source code)

The job log makes step 4 a single query.

### Schema

```sql
CREATE TABLE trapper.orchestrator_job_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID,                            -- FK to processing_jobs (NULL for non-job operations)

    -- What happened
    action TEXT NOT NULL,                    -- 'routed', 'skipped', 'merged', 'rejected', 'anomaly_flagged', 'error'
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_record_id TEXT,                  -- Original ID in source system

    -- Where it went
    target_surface TEXT,                    -- 'sot_people', 'places', 'sot_cats', etc.
    target_entity_id UUID,                 -- ID of created/matched entity
    routing_rule_id UUID,                  -- Which rule was applied

    -- Decision context
    decision_reason TEXT,                   -- Human-readable: 'matched existing person via email'
    decision_details JSONB,                -- Machine-readable: {match_score: 0.97, matched_person_id: '...'}

    -- Timing
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for debugging: "what happened to this source record?"
CREATE INDEX idx_orchestrator_job_log_source
    ON trapper.orchestrator_job_log(source_system, source_table, source_record_id);

-- Index for entity provenance: "where did this entity come from?"
CREATE INDEX idx_orchestrator_job_log_target
    ON trapper.orchestrator_job_log(target_entity_id)
    WHERE target_entity_id IS NOT NULL;

-- Index for health: "what errors happened today?"
CREATE INDEX idx_orchestrator_job_log_errors
    ON trapper.orchestrator_job_log(logged_at DESC)
    WHERE action IN ('error', 'anomaly_flagged', 'rejected');
```

### Queries It Enables

```sql
-- Why is this person missing from the system?
SELECT * FROM trapper.orchestrator_job_log
WHERE source_record_id = 'airtable_rec123'
ORDER BY logged_at;

-- Where did this entity come from?
SELECT * FROM trapper.orchestrator_job_log
WHERE target_entity_id = 'some-person-uuid'
ORDER BY logged_at;

-- What anomalies were flagged today?
SELECT * FROM trapper.orchestrator_job_log
WHERE action = 'anomaly_flagged'
  AND logged_at > NOW() - INTERVAL '24 hours'
ORDER BY logged_at DESC;

-- Routing success rate by source
SELECT source_system, source_table,
    COUNT(*) FILTER (WHERE action = 'routed') AS routed,
    COUNT(*) FILTER (WHERE action = 'skipped') AS skipped,
    COUNT(*) FILTER (WHERE action = 'error') AS errors,
    COUNT(*) FILTER (WHERE action = 'anomaly_flagged') AS anomalies
FROM trapper.orchestrator_job_log
WHERE logged_at > NOW() - INTERVAL '7 days'
GROUP BY source_system, source_table;
```

---

## Component 4: Data Health Checks

### What It Is

Views and functions that surface data quality issues, explain why data is missing, and detect anomalies — built on top of the orchestrator tables and existing system data.

### Why We Need It

Atlas has 41,800 people, 36,600 cats, 11,400 places. When something is wrong (a person has no phone, a cat has no place, a colony estimate seems implausible), staff and engineers need to find and fix it. Today this requires ad-hoc SQL queries by someone who knows the schema.

### Proposed Views

#### `v_orchestrator_health` — Pipeline Throughput

```sql
CREATE OR REPLACE VIEW trapper.v_orchestrator_health AS
SELECT
    os.source_system,
    os.source_table,
    os.display_name,
    os.ingest_frequency,
    os.last_ingest_at,
    os.total_records_ingested,
    os.total_entities_created,

    -- Processing pipeline status
    pj.queued_count,
    pj.processing_count,
    pj.completed_24h,
    pj.failed_24h,

    -- Staleness check
    CASE
        WHEN os.ingest_frequency = 'daily' AND os.last_ingest_at < NOW() - INTERVAL '2 days' THEN 'stale'
        WHEN os.ingest_frequency = 'weekly' AND os.last_ingest_at < NOW() - INTERVAL '10 days' THEN 'stale'
        WHEN pj.failed_24h > 0 THEN 'errors'
        WHEN pj.queued_count > 1000 THEN 'backlogged'
        ELSE 'healthy'
    END AS health_status

FROM trapper.orchestrator_sources os
LEFT JOIN (
    SELECT source_system, source_table,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') AS completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours') AS failed_24h
    FROM trapper.processing_jobs
    GROUP BY source_system, source_table
) pj ON pj.source_system = os.source_system AND pj.source_table = os.source_table
WHERE os.is_active;
```

#### `v_data_why_missing` — Missing Data Diagnostics

```sql
-- This view identifies entities that SHOULD have data but DON'T.
-- Each row explains what's missing and suggests a fix.

CREATE OR REPLACE VIEW trapper.v_data_why_missing AS

-- People without identifiers (can't be found, will be duplicated)
SELECT
    'person_no_identifiers' AS issue_type,
    sp.person_id::TEXT AS entity_id,
    COALESCE(sp.display_name, sp.first_name || ' ' || sp.last_name) AS entity_label,
    'Person has no email or phone — will be duplicated on next encounter' AS explanation,
    'Cross-reference staged_records for original email/phone' AS suggested_fix
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id
  )

UNION ALL

-- Cats without microchips (can't be deduped)
SELECT
    'cat_no_microchip',
    sc.cat_id::TEXT,
    COALESCE(sc.name, 'Unnamed cat'),
    'Cat has no microchip — same cat may appear as multiple records',
    'Check clinic records for microchip scan'
FROM trapper.sot_cats sc
WHERE sc.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci WHERE ci.cat_id = sc.cat_id
  )

UNION ALL

-- Places without geometry (invisible to Beacon maps)
SELECT
    'place_no_geometry',
    p.place_id::TEXT,
    COALESCE(p.formatted_address, p.display_name, 'Unknown place'),
    'Place has no lat/lng — invisible on Beacon map',
    'Re-geocode via Google Places API'
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NULL

UNION ALL

-- Merge chain black holes (people)
SELECT
    'person_merge_chain',
    sp.person_id::TEXT,
    COALESCE(sp.display_name, sp.first_name || ' ' || sp.last_name),
    'Person is merged into another merged person — data falls into black hole',
    'Run get_canonical_person_id() and flatten chain'
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NOT NULL
  AND sp.merged_into_person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
  )

UNION ALL

-- Merge chain black holes (places)
SELECT
    'place_merge_chain',
    p.place_id::TEXT,
    COALESCE(p.formatted_address, p.display_name),
    'Place is merged into another merged place — data falls into black hole',
    'Run get_canonical_place_id() and flatten chain'
FROM trapper.places p
WHERE p.merged_into_place_id IS NOT NULL
  AND p.merged_into_place_id IN (
    SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL
  );
```

#### `v_routing_anomalies` — Suspicious Data

```sql
-- Flags data that is technically valid but suspiciously wrong.
-- Staff reviews these to catch data quality issues.

CREATE OR REPLACE VIEW trapper.v_routing_anomalies AS

-- Colony estimates that seem implausible
SELECT
    'implausible_colony_size' AS anomaly_type,
    pce.place_id::TEXT AS entity_id,
    p.formatted_address AS entity_label,
    'Colony estimate of ' || pce.total_cats || ' cats at a single address' AS description,
    pce.source_type,
    pce.created_at AS detected_at
FROM trapper.place_colony_estimates pce
JOIN trapper.places p ON p.place_id = pce.place_id
WHERE pce.total_cats > 100

UNION ALL

-- People with suspiciously many identifiers (possible shared accounts)
SELECT
    'many_identifiers',
    pi.person_id::TEXT,
    (SELECT display_name FROM trapper.sot_people WHERE person_id = pi.person_id),
    'Person has ' || COUNT(*) || ' identifiers — possible shared account',
    'person_identifiers',
    MAX(pi.created_at)
FROM trapper.person_identifiers pi
GROUP BY pi.person_id
HAVING COUNT(*) > 5

UNION ALL

-- Staged records sitting unprocessed for more than 7 days
SELECT
    'stale_staged_records',
    sr.source_system || '/' || sr.source_table,
    COUNT(*)::TEXT || ' records unprocessed for 7+ days',
    'Staged records may need manual processing or pipeline investigation',
    sr.source_system,
    MAX(sr.staged_at)
FROM trapper.staged_records sr
WHERE sr.processed_at IS NULL
  AND sr.staged_at < NOW() - INTERVAL '7 days'
GROUP BY sr.source_system, sr.source_table
HAVING COUNT(*) > 10;
```

---

## How It Stays Additive

The Orchestrator is designed with a strict additive-only contract:

| Principle | How It's Enforced |
|-----------|-------------------|
| **No existing table changes** | All orchestrator state lives in new `orchestrator_*` tables |
| **No processor function rewrites** | Existing processors keep running unchanged. Orchestrator wraps them. |
| **No trigger changes** | All 55 existing triggers remain untouched |
| **No view replacements** | Health views are new views, not replacements of `v_processing_dashboard` etc. |
| **No API endpoint changes** | New `/api/admin/orchestrator/*` endpoints. Existing ones unchanged. |
| **Backward compatible removal** | `DROP TABLE orchestrator_*` removes everything with zero side effects |

### The "Shadow Mode" Pattern

Phase 1 (ORCH_001) creates the tables and populates them **in parallel** with existing pipelines:

```
EXISTING FLOW (unchanged):
  ingest script → staged_records → enqueue_processing() → process_next_job()

SHADOW FLOW (new, observes only):
  orchestrator_sources ← populated from existing data_engine_processors
  orchestrator_routing_rules ← populated by documenting existing processor behavior
  orchestrator_job_log ← populated by wrapping process_next_job() with logging
  v_orchestrator_health ← reads from both orchestrator_sources and processing_jobs
```

The shadow flow **reads from existing tables** and **writes only to new orchestrator tables**. If the Orchestrator is removed, existing pipelines continue without interruption.

---

## ACTIVE Flow Safety Analysis

The Orchestrator does **not touch any ACTIVE flow surface** listed in `docs/ACTIVE_FLOW_SAFETY_GATE.md`:

| Active Surface | Orchestrator Impact |
|---------------|-------------------|
| `web_intake_submissions` | None (Orchestrator doesn't touch intake) |
| `sot_requests` | None |
| `journal_entries` | None |
| `sot_people` | None (Orchestrator reads, never writes) |
| `places` | None (Orchestrator reads, never writes) |
| `staff` / `staff_sessions` | None |
| `v_intake_triage_queue` | None |
| `v_request_list` | None |
| All intake/request/journal triggers | None |

The Orchestrator operates entirely in the **L1 RAW** and **L2 IDENTITY** layers (background processing). It has zero interaction with **L6 WORKFLOWS** (active staff-facing flows).

---

## Implementation Phases

### ORCH_001: Minimal Backbone (see TASK_LEDGER.md)

**Creates:**
- `orchestrator_sources` table
- `orchestrator_routing_rules` table
- `orchestrator_job_log` table
- Basic indexes

**Populates:**
- All 13 known sources registered
- Routing rules for clinichq (documenting existing processor behavior)

**Validates:**
- Can register a source
- Can create a routing rule
- Can log a routing decision
- All Active Flow Safety Gate checks pass

### ORCH_002: Source Registry + Onboarding (see TASK_LEDGER.md)

**Adds:**
- `register_source()` helper function
- `map_source_field()` helper function
- Field mappings for all existing sources
- Demonstrates new source onboarding (client_survey example)

**Validates:**
- All existing sources registered with correct metadata
- Field mappings for clinichq match current processor behavior
- New source registration works end-to-end

### ORCH_003: Data Health Checks (see TASK_LEDGER.md)

**Creates:**
- `v_orchestrator_health` view
- `v_data_why_missing` view
- `v_routing_anomalies` view
- Optional: `/admin/data-health` page

**Validates:**
- Health view returns correct counts
- "Why missing" correctly identifies known gaps (986 people, 1,608 cats, 93 places)
- Anomaly detection flags implausible values

---

## Future Phases (Not in Current Scope)

These are documented for architectural clarity but are **not proposed for implementation now**:

### ORCH_004: Generic Router (Future)

A `route_staged_record()` function that reads routing rules and executes simple mappings without a custom processor function. This would allow new simple sources (surveys, CSV imports) to be wired with zero PL/pgSQL.

```sql
-- Future: Generic routing for simple sources
SELECT trapper.route_staged_record(staged_record_id)
-- Reads routing_rules for the source_system/source_table
-- Executes direct/transform mappings
-- Falls back to function_call for complex ones
-- Logs everything to orchestrator_job_log
```

### ORCH_005: Cross-Source Dependencies (Future)

Declare that source A must be processed before source B (e.g., clinichq_owner must run before clinichq_appointment so person_ids exist).

Today this is handled by processor priority ordering in `data_engine_processors.priority`. The Orchestrator could make this explicit and enforce it.

### ORCH_006: Source Confidence Scoring (Future)

Per-source reliability scoring that feeds into Beacon's confidence calculations. A clinic record has higher confidence than an intake form self-report. This is partially implemented in `colony_source_confidence` but not generalized.

---

## What This Is NOT

To be explicit about scope:

1. **Not a data warehouse or ETL tool.** Atlas already has a working ingestion pipeline. The Orchestrator adds coordination, not computation.

2. **Not a replacement for processor functions.** The 11 existing processor functions contain critical business logic (dedup rules, entity linking, identity resolution). The Orchestrator wraps them.

3. **Not a scheduler.** Atlas uses Vercel Cron to call `POST /api/ingest/process` every 10 minutes. The Orchestrator doesn't change this. It adds observability to what happens when the cron runs.

4. **Not an AI system.** The Orchestrator routes data and logs decisions. AI enrichment continues through the existing `extraction_queue` pipeline.

5. **Not touching ACTIVE flows.** The Orchestrator operates in L1-L2 (background processing). Staff-facing workflows (L6) are completely untouched.

---

## Success Criteria

The Orchestrator is successful when:

1. **"What sources feed Atlas?"** is answered by one query (`SELECT * FROM orchestrator_sources WHERE is_active`)
2. **"Why is this data missing?"** is answered by one view (`v_data_why_missing`)
3. **"Where did this entity come from?"** is answered by one query on `orchestrator_job_log`
4. **Adding a new source** requires SQL INSERT into `orchestrator_sources` and `orchestrator_routing_rules`, not a new processor function (for simple sources)
5. **Pipeline health** is visible at a glance via `v_orchestrator_health`
6. **Zero ACTIVE flows are affected** — all Safety Gate checks pass after implementation

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/ATLAS_NORTH_STAR.md` | System layers, invariants, data zones |
| `docs/ACTIVE_FLOW_SAFETY_GATE.md` | Validation checklist for active flows |
| `docs/TASK_LEDGER.md` | Task cards including ORCH_001/002/003 |
| `CLAUDE.md` | Developer rules, centralized functions, API patterns |
