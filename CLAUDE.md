# Atlas Project - Claude Development Rules

This file contains rules and context for AI-assisted development on the Atlas project.

## Project Overview

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County (FFSC).

## CORE MISSION: Every Entity is Real and Distinct

**Atlas is the single source of truth for every real entity FFSC has ever interacted with:**

| Entity | Description | Rule |
|--------|-------------|------|
| **Person** | Every human who has requested help, brought cats to clinic, volunteered | Distinct records. Identity via email/phone only, NEVER name alone. |
| **Place** | Every address where cats have been reported, trapped, or owners live | Each physical location is distinct. Units are separate places. |
| **Cat** | Every cat seen at clinic (microchip) or documented in field | Distinct records. Microchip is gold standard. |

### The Fundamental Promise

> **When you search an address, you see ONLY data at that address.**

- Cats linked to "101 Fisher Lane" are cats actually AT 101 Fisher Lane
- Multi-unit complexes: units are children with their own data
- Data from other addresses does NOT pollute the view

### Two Complementary Layers

**Layer 1: Clean Data Organization**
- Centralized `find_or_create_*` functions for deduplication
- Identity resolution via email/phone
- Audit trail for all changes
- Places remain individualized

**Layer 2: Ecological Predictions (Computed)**
- Uses Layer 1 data + qualitative sources (Google Maps, Project 75, surveys)
- Calculations in VIEWS, not stored on places
- Colony estimates in separate `place_colony_estimates` table
- Beacon visualizes predictions on a map

See `docs/ATLAS_MISSION_CONTRACT.md` for full alignment with Beacon's requirements.

## TWO TRACKS: Workflow Data vs Beacon/Ecological Data

Atlas manages two distinct data tracks with different enrichment rules:

### Track 1: Workflow Data (Be Careful)

**What:** Source-of-truth tables that drive operational workflows
- `sot_people` - Identity data (names, contact info)
- `sot_requests` - Request lifecycle and status
- `sot_cats` - Cat records linked to clinic visits
- `web_intake_submissions` - Raw form submissions
- `request_trapper_assignments` - Staff assignments

**Enrichment Rules:**
- ⚠️ Do NOT infer or cluster data into SOT tables
- AI can ASSIST display (summarize for UI) but not MODIFY records
- Changes require audit trail in `entity_edits`
- Identity resolution ONLY via email/phone, never names
- Keep source attribution intact (`source_system`, `source_record_id`)

**Why:** These tables drive real business processes. Wrong merges = confused staff.

### Track 2: Beacon/Ecological Data (More Freedom)

**What:** Population modeling and ecological estimates
- `place_colony_estimates` - Colony size estimates (multi-source)
- `cat_birth_events` - Litter records for reproduction modeling
- `cat_mortality_events` - Death records for survival rates
- `google_map_entries` - Historical context (qualitative)
- `site_observations` - Mark-resight data for Chapman estimator

**Enrichment Rules:**
- ✅ AI can freely infer colony sizes from informal notes
- ✅ Can cluster nearby places for site-level estimates
- ✅ Can estimate birth dates from lactating appointments
- All AI-parsed data clearly labeled (`source_type = 'ai_parsed'`)
- Stored in separate enrichment tables, not core SOT tables
- Beacon visualizations clearly show confidence levels

**Why:** This is statistical inference for population modeling. Being approximately right helps more than being precisely incomplete.

### Summary: The Two Mindsets

| Aspect | Workflow (Track 1) | Beacon (Track 2) |
|--------|-------------------|------------------|
| Goal | Accurate records | Population estimates |
| AI Role | Display assist only | Active inference |
| Merging | Forbidden without proof | Encouraged for sites |
| Uncertainty | Preserve it | Model it |
| Source | Must be explicit | Can be "ai_parsed" |

## Clinic Data Processing Rules

**Clinic data flows directly to Cats, Places, and Appointments - NOT necessarily to People.**

See `docs/CLINIC_DATA_STRUCTURE.md` for full documentation.

### Key Rules

1. **Cats are booked under locations, not trappers**
   - Trappers bring cats from various locations
   - The cat's link is to the PLACE, not the trapper
   - If someone books using a trapper's email, the cat still links to the address

2. **Never create People from names alone**
   - Email OR phone required to create/match a person
   - Names are too unreliable (misspellings, duplicates)
   - `data_engine_resolve_identity()` returns NULL without identifiers

3. **Places are the anchor**
   - Appointments ALWAYS link to a place (via owner address)
   - Cats link to places via appointments
   - Requests link to places
   - This is what Beacon uses for visualization

### Data Engine Behavior

```sql
-- With email/phone: Find or create person
data_engine_resolve_identity(email, phone, name, address)
→ Returns person_id, links to place

-- Without email/phone: No person created
data_engine_resolve_identity(NULL, NULL, name, address)
→ Returns NULL, decision_type = 'no_identifiers'
→ Cat links directly to place, not to a person
```

### Processing Flow

| Has Email/Phone? | Person Created? | Cat Links To |
|------------------|-----------------|--------------|
| ✅ Yes | ✅ Yes | Place (via person) |
| ❌ No | ❌ No | Place (directly) |

## Beacon / Ground Truth Principle

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.**

- FFSC clinic data = **verified alterations (ground truth)**
- External alteration rate ≈ 2% (negligible)
- All alteration calculations use FFSC clinic records as the numerator

**Key Equation (Chapman Mark-Recapture):**
```
N̂ = ((M+1)(C+1)/(R+1)) - 1

Where:
  M = Marked cats (FFSC verified alterations - ground truth)
  C = Total cats observed
  R = Ear-tipped cats observed
```

**Population Model Parameters:** Configurable via `ecology_config` table (MIG_220, MIG_288). Defaults from Boone et al. 2019.

## Architecture

### Three-Layer Data Model
1. **Raw** (`staged_records`) - Immutable audit trail
2. **Identity Resolution** - Matching via email/phone
3. **Source of Truth** (`sot_*` tables) - Canonical records

### Key Tables (in `trapper` schema)
- `sot_people` - All people
- `sot_cats` - All cats with microchips
- `sot_requests` - All service requests
- `places` - All addresses
- `person_identifiers` - Email/phone for identity matching
- `person_roles` - Role assignments (trapper, volunteer, etc.)
- `request_trapper_assignments` - Many-to-many request-trapper links
- `processing_jobs` - Centralized job queue for data processing
- `place_contexts` - Place relevance tags (colony_site, foster_home, etc.)
- `person_cat_relationships` - Foster/adopter/owner links between people and cats

### Centralized Processing Pipeline (MIG_312, MIG_313)

All ingested data flows through a unified job queue:

1. **Staging**: CLI/UI/API stages data in `staged_records`
2. **Enqueueing**: `trapper.enqueue_processing()` creates job in queue
3. **Processing**: `trapper.process_next_job()` orchestrates (cron every 10 min)
4. **Entity Linking**: `trapper.run_all_entity_linking()` runs after each batch

**Key Functions:**
- `enqueue_processing(source, table, trigger, batch_id, priority)` - Queue a job
- `process_next_job(batch_size)` - Process next job (claims via `FOR UPDATE SKIP LOCKED`)
- `process_clinichq_owner_info(job_id, batch_size)` - Backfills owner_email, links person_id
- `link_appointments_via_safe_phone()` - Links via phone when uniquely identifying

**Endpoints:**
- `POST /api/ingest/process` - Unified processor (cron)
- `GET /api/health/processing` - Monitoring dashboard

**Manual Backfill:**
```sql
-- Queue backfill jobs
SELECT trapper.enqueue_processing('clinichq', 'owner_info', 'backfill', NULL, 10);

-- Process (run repeatedly until no_jobs)
SELECT * FROM trapper.process_next_job(500);

-- Check status
SELECT * FROM trapper.v_processing_dashboard;
```

### Data Engine (MIG_314-317)

The **Data Engine** is Atlas's unified system for identity resolution and entity matching. It provides:

1. **Multi-signal weighted scoring** - Combines email, phone, name, and address signals
2. **Household modeling** - Recognizes multiple people at the same address sharing identifiers
3. **Configurable matching rules** - Thresholds stored in database, not code
4. **Review queue** - Uncertain matches go to humans for resolution
5. **Full audit trail** - Every matching decision logged with reasoning

**Key Tables:**
- `data_engine_matching_rules` - Configurable matching rules with weights/thresholds
- `data_engine_match_decisions` - Full audit trail of all identity decisions
- `households` - Household groupings at addresses
- `household_members` - People belonging to households
- `data_engine_soft_blacklist` - Shared identifiers requiring extra verification

**Key Functions:**
- `data_engine_resolve_identity(email, phone, first, last, addr, source)` - Main entry point
- `data_engine_score_candidates(email, phone, name, addr)` - Multi-signal scoring
- `data_engine_create_household(place_id, person_ids)` - Household management
- `find_or_create_person()` - Now delegates to Data Engine internally

**Decision Types:**
| Type | Score Range | Action |
|------|-------------|--------|
| `auto_match` | ≥ 0.95 | Automatically link to existing person |
| `review_pending` | 0.50 - 0.94 | Create new, flag for human review |
| `household_member` | 0.50+ with low name match | Create new, add to household |
| `new_entity` | < 0.50 | Create new person |
| `rejected` | N/A | Internal account or no identifiers |

**API Endpoints:**
- `GET /api/health/data-engine` - Health check and statistics
- `GET /api/admin/data-engine/rules` - View matching rules
- `PATCH /api/admin/data-engine/rules` - Update rule thresholds
- `GET /api/admin/data-engine/review` - View pending reviews
- `POST /api/admin/data-engine/review/[id]` - Resolve a review
- `GET /api/admin/data-engine/households` - View households
- `GET /api/admin/data-engine/stats` - Comprehensive statistics

**Views:**
- `v_data_engine_health` - Quick health metrics
- `v_data_engine_stats` - Decision statistics
- `v_data_engine_review_queue` - Pending reviews
- `v_households_summary` - Household overview

## Critical Rules

### MANDATORY: Centralized Functions for Entity Creation

**NEVER create inline INSERT statements for core entities.** Always use these SQL functions:

| Entity | Function | Usage |
|--------|----------|-------|
| Person | `trapper.find_or_create_person(email, phone, first, last, addr, source)` | For all person creation |
| Place | `trapper.find_or_create_place_deduped(address, name, lat, lng, source)` | For all place creation |
| Cat | `trapper.find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` | For all cat creation |
| Request | `trapper.find_or_create_request(source, record_id, source_created_at, ...)` | For all request creation (MIG_297) |

**Why:**
- These functions handle normalization, deduplication, identity matching, merged entities, and geocoding queue
- Direct INSERTs bypass critical business logic and create duplicates
- For requests: Properly sets source_created_at for attribution windows, auto-creates places/people from raw data

**source_system values (use EXACTLY):**
- `'airtable'` - All Airtable data (not 'airtable_staff' or 'airtable_project75')
- `'clinichq'` - All ClinicHQ data
- `'shelterluv'` - ShelterLuv API data (animals, people, events)
- `'web_intake'` - Web intake form submissions
- `'petlink'` - PetLink microchip data

**See `docs/INGEST_GUIDELINES.md` for complete documentation.**

### Attribution Windows (MIG_208)

When linking cats to requests, use the **rolling window system**:

```sql
-- Legacy requests (before May 2025): Fixed window
WHEN source_created_at < '2025-05-01' THEN source_created_at + '6 months'

-- Resolved requests: Buffer after completion
WHEN resolved_at IS NOT NULL THEN resolved_at + '3 months'

-- Active requests: Rolling to future
ELSE NOW() + '6 months'
```

**DO NOT** create custom time window logic. Always use `v_request_alteration_stats` view.

### Identity Matching

- **Email**: Exact match via `person_identifiers.id_value_norm`
- **Phone**: Use `trapper.norm_phone_us()` for normalization
- **Never match by name alone** - Too many false positives

### Trapper Types

| Type | Is FFSC? | Description |
|------|----------|-------------|
| `coordinator` | Yes | FFSC staff coordinator |
| `head_trapper` | Yes | FFSC head trapper |
| `ffsc_trapper` | Yes | FFSC trained volunteer (completed orientation) |
| `community_trapper` | No | Signed contract only, limited, does NOT represent FFSC |

**"Legacy Trapper"** in Airtable = `ffsc_trapper` (grandfathered FFSC volunteer)

### Data Provenance

Always track:
- `source_system` - Where data came from ('airtable', 'clinichq', 'web_app')
- `source_record_id` - Original ID in source system
- `source_created_at` - Original creation timestamp (important for windows!)
- Log changes to `entity_edits` table

### Request Lifecycle

```
new → triaged → scheduled → in_progress → completed
                    ↓
                on_hold (with hold_reason)
                    ↓
                cancelled
```

When setting `status = 'completed'` or `'cancelled'`, also set `resolved_at = NOW()`.

## Common Tasks

### Adding a New Ingest Script

1. Create `scripts/ingest/{source}_{table}_sync.mjs`
2. Stage raw records in `staged_records`
3. Use `find_or_create_*` functions
4. Log changes to `data_changes` or `entity_edits`
5. Update `docs/DATA_INGESTION_RULES.md`

### Creating a New Migration

1. Name: `sql/schema/sot/MIG_{NNN}__{description}.sql`
2. Start with `\echo` banner
3. Use `IF NOT EXISTS` for creates
4. Add `COMMENT ON` for documentation
5. End with summary `\echo`

### Adding API Endpoints

1. Location: `apps/web/src/app/api/{resource}/route.ts`
2. Use `queryOne` / `queryRows` from `@/lib/db`
3. Return JSON with proper error handling
4. Validate inputs before database calls

## File Locations

```
/apps/web/          - Next.js web application
/scripts/ingest/    - Data sync scripts
/scripts/jobs/      - Enrichment and parsing jobs (AI-powered)
/sql/schema/sot/    - Database migrations
/docs/              - Documentation
```

### Key Documentation Files

| File | Purpose |
|------|---------|
| `docs/DATA_FLOW_ARCHITECTURE.md` | Complete data flow from external sources to Beacon |
| `docs/CENTRALIZED_FUNCTIONS.md` | Mandatory entity creation functions reference |
| `docs/ATLAS_MISSION_CONTRACT.md` | Core mission and entity principles |
| `docs/INGEST_GUIDELINES.md` | Data ingestion rules and patterns |
| `docs/TIPPY_VIEWS_AND_SCHEMA.md` | Tippy schema navigation documentation |
| `docs/TIPPY_DATA_QUALITY_REFERENCE.md` | Data quality fixes for Tippy context |

## AI Enrichment Scripts (`scripts/jobs/`)

These scripts use Claude AI to extract quantitative data from informal notes:

| Script | Purpose | Output Table |
|--------|---------|--------------|
| `populate_birth_events_from_appointments.mjs` | Create birth events from lactating/pregnant appointments | `cat_birth_events` |
| `populate_mortality_from_clinic.mjs` | Create mortality events from clinic euthanasia notes | `cat_mortality_events` |
| `parse_quantitative_data.mjs` | AI extracts cat counts, colony sizes from notes | `place_colony_estimates` |
| `paraphrase_google_map_entries.mjs` | Light cleanup of Google Maps notes with TNR context | `google_map_entries.ai_summary` |

**Usage:**
```bash
# Run with environment variables
export $(grep -v '^#' .env | xargs)
node scripts/jobs/parse_quantitative_data.mjs --source google_maps --limit 100
node scripts/jobs/populate_birth_events_from_appointments.mjs --dry-run
```

**Cron Endpoint:** `/api/cron/beacon-enrich` runs daily at 10 AM PT

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - Postgres connection string
- `AIRTABLE_PAT` - Airtable Personal Access Token
- `GOOGLE_PLACES_API_KEY` - For geocoding
- `SHELTERLUV_API_KEY` - ShelterLuv API key (for automated sync)

## Tippy Dynamic Schema Navigation (MIG_517-521)

Tippy uses dynamic schema navigation to query 190+ database views without hardcoded tools.

### Key Tables
| Table | Purpose |
|-------|---------|
| `tippy_view_catalog` | Registry of views Tippy can query (31 views) |
| `tippy_proposed_corrections` | Data corrections Tippy proposes for review |
| `tippy_unanswerable_questions` | Questions Tippy couldn't answer (gap tracking) |
| `tippy_view_usage` | Analytics on which views are queried |

### Admin Pages
- `/admin/tippy-corrections` - Review and apply data corrections
- `/admin/tippy-gaps` - Review unanswerable questions to identify schema gaps

### Adding Views to Tippy
```sql
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES ('v_my_view', 'stats', 'Description', ARRAY['col1'], ARRAY['filter_col'], ARRAY['Example question?']);
```

See `docs/TIPPY_VIEWS_AND_SCHEMA.md` for full documentation.

## Views to Know

| View | Purpose |
|------|---------|
| `v_request_alteration_stats` | Per-request cat attribution with windows |
| `v_trapper_full_stats` | Comprehensive trapper statistics |
| `v_trapper_appointment_stats` | Trapper stats from direct appointment links |
| `v_place_alteration_history` | Per-place TNR progress over time |
| `v_request_current_trappers` | Current trapper assignments |
| `v_processing_dashboard` | Job queue status by source system/table |
| `v_data_engine_health` | Data Engine health metrics |
| `v_data_engine_review_queue` | Pending identity reviews |
| `v_households_summary` | Household statistics by place |
| `v_place_active_contexts` | Active place context tags |
| `v_place_context_summary` | Aggregated contexts per place |
| `v_person_cat_history` | Person-cat relationships with details |
| `v_tippy_view_popularity` | Which views Tippy queries most |
| `v_tippy_pending_corrections` | Data corrections awaiting review |
| `v_tippy_gaps_review` | Unanswerable questions for gap analysis |
| `v_data_flow_status` | Unified data flow monitoring across all sources |
| `v_data_engine_coverage` | Summary statistics of Data Engine coverage |
| `v_people_without_data_engine` | People missing Data Engine audit trail |
| `v_potential_duplicate_people` | Possible duplicate people records |
| `v_potential_duplicate_places` | Possible duplicate place records |
| `v_shelterluv_sync_status` | ShelterLuv API sync health and pending records |
| `v_cat_field_sources_summary` | Multi-source field values per cat |
| `v_cat_field_conflicts` | Cats where sources disagree on field values |

## Key Tables

| Table | Purpose |
|-------|---------|
| `intake_custom_fields` | Admin-configured custom intake questions |
| `web_intake_submissions` | All intake form submissions (has `custom_fields` JSONB) |

## Custom Intake Fields (MIG_238)

Custom intake questions can be added via admin UI without code changes.

### Admin UI
- Path: `/admin/intake-fields`
- Features: Add/edit/delete custom questions, sync to Airtable

### Database Table: `trapper.intake_custom_fields`
| Column | Purpose |
|--------|---------|
| `field_key` | Snake_case identifier (e.g., `how_heard_about_us`) |
| `field_label` | Human-readable label |
| `field_type` | text, textarea, number, select, checkbox, date, phone, email |
| `options` | JSONB array of `{value, label}` for select fields |
| `show_for_call_types` | Array of call types to show for (null = all) |
| `is_beacon_critical` | Important for Beacon analytics |
| `airtable_synced_at` | When last synced to Airtable |

### Airtable Sync
Click "Sync to Airtable" in admin UI to push new fields to Airtable table.
After sync: add same question to Jotform and map to new Airtable column.

### Custom Field Values
Stored in `web_intake_submissions.custom_fields` as JSONB.

### Cat Ownership Types
Standard options for `ownership_status`:
- `unknown_stray` - Stray cat (no apparent owner)
- `community_colony` - Outdoor cat I/someone feeds
- `newcomer` - Newcomer (just showed up recently)
- `neighbors_cat` - Neighbor's cat
- `my_cat` - My own pet

### Feeding Behavior Fields (MIG_236)
- `feeds_cat` - Does requester feed the cat?
- `feeding_frequency` - Daily, few times/week, occasionally, rarely
- `feeding_duration` - How long feeding/aware
- `cat_comes_inside` - Yes regularly, sometimes, never

### Emergency Handling
- `is_emergency` - Flagged as urgent
- `emergency_acknowledged` - User acknowledged FFSC is not a 24hr hospital

## Colony Size Tracking (MIG_209)

Colony size != cats caught. Colony size is an estimate of total cats at a location.

### Adding Colony Data

```sql
-- 1. Add source confidence (if new source type)
INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
VALUES ('new_source', 0.65, 'Description');

-- 2. Insert estimate
INSERT INTO trapper.place_colony_estimates (
  place_id, total_cats, source_type, observation_date, source_system, source_record_id
) VALUES (...);
```

### Source Confidence Levels
- `verified_cats`: 100% (ground truth)
- `post_clinic_survey`: 85% (Project 75)
- `trapper_site_visit`: 80%
- `trapping_request`: 60%
- `intake_form`: 55%
- `appointment_request`: 50%

### Key View
`v_place_colony_status` - Aggregates all estimates with weighted confidence

## Colony Classification System (MIG_615)

Not all places with cats are the same. The classification system distinguishes between **individual cats** (sporadic neighborhood cats) and **colony sites** (established feeding locations).

### The Problem

Consider two scenarios:
1. **Crystal's situation**: She reports 1 cat, then 2 cats total. These are specific neighborhood cats she can count exactly.
2. **Jean Worthey's site**: An established feeding station with many cats. Ecological estimation (Chapman mark-recapture) is appropriate.

Without classification, the system would treat both the same, potentially showing inflated estimates for individual cat situations.

### Classification Types

| Classification | Description | Estimation Behavior |
|----------------|-------------|---------------------|
| `unknown` | Default, needs staff classification | Normal weighted estimation |
| `individual_cats` | Sporadic cats, exact counts known | Uses authoritative count only, NO clustering |
| `small_colony` | Small established group (3-10 cats) | Light estimation |
| `large_colony` | Large colony (10+ cats) | Full ecological estimation |
| `feeding_station` | Known feeding location | Clustering enabled, attracts nearby appointments |

### Key Fields on Places

| Field | Purpose |
|-------|---------|
| `colony_classification` | How to treat this place for estimation |
| `authoritative_cat_count` | Staff-confirmed exact count (overrides ALL estimates) |
| `allows_clustering` | Whether nearby appointments cluster here |
| `clustering_radius_meters` | Custom radius (NULL = system default) |

### Setting Classification

```sql
-- Set a place as individual cats with exact count of 2
SELECT trapper.set_colony_classification(
  'place-uuid-here',
  'individual_cats',
  'Single requester reporting specific neighborhood cats',
  'staff_name',
  2  -- authoritative count
);
```

### How Classification Affects Estimates

| Scenario | colony_size_estimate | estimation_method |
|----------|---------------------|-------------------|
| `authoritative_cat_count` set | Uses authoritative count | "Authoritative Count" |
| `individual_cats` classification | Uses verified_cat_count only | "Individual Cats (Verified Only)" |
| `colony` classifications | Weighted estimate from all sources | "Estimated" |
| Legacy override | Uses `colony_override_count` | "Manual Override" |

### Clustering Behavior

- `individual_cats`: `allows_clustering = FALSE` (auto-set)
- Colony types: `allows_clustering = TRUE`
- When `allows_clustering = FALSE`, nearby appointments are NOT attributed to this place

### UI Flow

1. **Place Detail Page**: Shows current classification and allows staff to change it
2. **Colony Estimates Component**: Displays classification badge and authoritative count if set
3. **Set Classification Modal**: Allows staff to set classification with reason and optional count

## Cat Count Semantic Distinction (MIG_534)

**IMPORTANT:** The field `estimated_cat_count` on requests has a specific meaning that differs from colony size.

### Two Concepts, Two Fields

| Field | Meaning | Purpose |
|-------|---------|---------|
| `estimated_cat_count` | Cats still needing TNR | Request progress tracking |
| `total_cats_reported` | Total cats at location | Colony size for Beacon modeling |
| `cat_count_semantic` | 'needs_tnr' or 'legacy_total' | Indicates field meaning |

### Why This Matters

**Example:** A request shows "3 cats"
- **If semantic = 'needs_tnr':** 3 cats still need to be fixed (progress tracking)
- **If semantic = 'legacy_total':** 3 cats total at location (colony estimate)

Legacy requests (before MIG_534) have `cat_count_semantic = 'legacy_total'`. New requests use `'needs_tnr'`.

### UI Labels

Always use **"Cats Needing TNR"** (not "Estimated Cats" or "Cat Count") in:
- Request detail pages
- Handoff modal
- Redirect modal
- Intake forms

Add helper text: "Still unfixed (not total)"

### Colony Estimates

For colony estimation (Beacon), use `total_cats_reported` for new requests. The function `add_colony_estimate_from_request()` handles this automatically based on `cat_count_semantic`.

### Legacy Request Upgrade

When upgrading legacy requests via LegacyUpgradeWizard, staff can clarify:
- "This number is total cats" → Prompts for TNR count
- "This number is cats needing TNR" → Keep as-is

## Place Context Tagging (MIG_464)

Places are tagged with contextual relevance (colony site, foster home, adopter residence, etc.). This enables queries like "show me foster homes in Petaluma" or "list colony sites in West County."

### Key Tables
- `place_context_types` - Lookup table for context types (colony_site, foster_home, etc.)
- `place_contexts` - Tags places with context types (temporal validity, evidence tracking)

### Context Types
| Type | Description |
|------|-------------|
| `colony_site` | Active or historical colony location |
| `foster_home` | Location where cats are fostered |
| `adopter_residence` | Home where adopted cats live |
| `volunteer_location` | Volunteer's home/base |
| `trapper_base` | Trapper's home/staging location |
| `clinic` | Veterinary clinic |
| `shelter` | Animal shelter |
| `partner_org` | Partner organization |

### Functions
- `assign_place_context(place_id, context_type, ...)` - Idempotent context assignment
- `end_place_context(place_id, context_type)` - End active context

### Views
- `v_place_active_contexts` - All currently active contexts with labels
- `v_place_context_summary` - Aggregated contexts per place

### Auto-Assignment
When requests are created with a place, `colony_site` context is auto-assigned via trigger.

## Person-Cat Relationships (MIG_465)

Tracks relationships between people and cats (foster, adopter, owner, caretaker).

### Key Tables
- `person_cat_relationships` - Links people to cats with relationship type

### Views
- `v_person_cat_history` - Shows person-cat relationships with cat details
- `query_person_cat_history(name, email, type)` - Query function for foster/adopter history

### ShelterLuv Outcomes
ShelterLuv adoption/return outcomes are processed via:
```sql
SELECT * FROM trapper.process_shelterluv_outcomes(500);
```
This creates adopter relationships and tags places with `adopter_residence` context.

## ShelterLuv API Integration (MIG_621)

Atlas syncs data from ShelterLuv via API to supplement clinic data with adoption outcomes, foster placements, and TNR completion tracking.

### Sync Configuration

**Schedule:** Every 6 hours via Vercel Cron (`0 */6 * * *`)

**Endpoints:**
- `GET /api/cron/shelterluv-sync` - Automated sync endpoint
- Admin UI: `/admin/ingest` shows ShelterLuv sync status

### Key Tables

| Table | Purpose |
|-------|---------|
| `shelterluv_sync_state` | Tracks sync progress per entity type (animals, people, events) |
| `v_shelterluv_sync_status` | View showing sync health and pending records |

### Event Processing

ShelterLuv events are processed to extract outcomes:

| Event Type | Atlas Action |
|------------|--------------|
| `Outcome.Adoption` | Creates adopter relationship, tags place as `adopter_residence` |
| `Outcome.Foster` | Creates foster relationship, tags place as `foster_home` |
| `Outcome.FeralWildlife` (Released to Colony) | Marks cat as TNR complete |
| `Outcome.Euthanasia` | Creates mortality event via `register_mortality_event()` |

### Data Flow

```
ShelterLuv API → shelterluv_api_sync.mjs → staged_records → Data Engine → SOT Tables
```

### Environment Variables

Required in `.env`:
- `SHELTERLUV_API_KEY` - ShelterLuv API key

## Multi-Source Data Transparency (MIG_620)

When cats have data from multiple sources (ClinicHQ, ShelterLuv, PetLink), Atlas tracks field-level provenance so staff can see which source reported what.

### The Problem

A cat might have:
- `breed = "DSH Black"` from ClinicHQ
- `breed = "DSH White with Black"` from ShelterLuv

Without transparency, staff don't know which value to trust or why they differ.

### The Solution

The `cat_field_sources` table stores ALL values from each source:

```sql
-- Record a field value from a source
SELECT trapper.record_cat_field_source(
  cat_id, 'breed', 'DSH Black', 'clinichq', 'chq_123'
);

-- Batch record multiple fields
SELECT trapper.record_cat_field_sources_batch(
  cat_id, 'shelterluv', 'sl_456',
  p_breed => 'DSH White with Black',
  p_sex => 'female'
);
```

### Survivorship Priority

The `is_current` flag indicates which source's value is displayed. Priority is determined by `survivorship_priority` table:

```
ClinicHQ (highest) → ShelterLuv → PetLink → Airtable → Legacy (lowest)
```

### UI Display

Cat detail page shows:
- Primary value with source badge: `DSH Black (ClinicHQ)`
- Alternate values below: `Also: "DSH White with Black" (ShelterLuv)`
- Conflict indicator when sources disagree

### Key Tables and Views

| Table/View | Purpose |
|------------|---------|
| `cat_field_sources` | Stores all field values per source |
| `v_cat_field_sources_summary` | Aggregated field sources per cat (for API) |
| `v_cat_field_conflicts` | Shows cats where sources disagree |

### Tracked Fields

- `name`, `breed`, `sex`, `primary_color`, `secondary_color`
- `altered_status`, `coat_pattern`, `estimated_age`, `ownership_type`

### Recording Field Sources

All ingest pipelines should call `record_cat_field_sources_batch()`:

```sql
-- In process_shelterluv_animal()
PERFORM trapper.record_cat_field_sources_batch(
  v_cat_id, 'shelterluv', p_shelterluv_id,
  p_name => p_name,
  p_breed => p_breed,
  p_sex => p_sex,
  p_primary_color => p_color
);
```

## Cat-Place Linking (MIG_235)

Cats from clinic appointments are linked to places via owner contact info:
1. Find cat via microchip in `cat_identifiers`
2. Match owner email/phone from appointment to `person_identifiers`
3. Get place from `person_place_relationships`
4. Create `cat_place_relationships` with type `'appointment_site'`

Run to re-link: `SELECT * FROM trapper.link_appointment_cats_to_places();`

## Trapper-Appointment Linking (MIG_238)

Trappers are linked to appointments directly for accurate stats:
- `sot_appointments.trapper_person_id` - Direct link to trapper
- Use `v_trapper_appointment_stats` for clinic stats
- Run to re-link: `SELECT * FROM trapper.link_appointments_to_trappers();`

## Don't Do

- **Don't INSERT directly into sot_people** - Use `find_or_create_person()`
- **Don't INSERT directly into places** - Use `find_or_create_place_deduped()`
- **Don't INSERT directly into sot_cats** - Use `find_or_create_cat_by_microchip()`
- **Don't INSERT directly into sot_requests** - Use `find_or_create_request()`
- **Don't use custom source_system values** - Use 'airtable', 'clinichq', 'web_intake', or 'atlas_ui'
- Don't match people by name only - Email/phone only
- Don't create fixed time windows for new features
- Don't skip `entity_edits` logging for important changes
- Don't hardcode phone/email patterns (use normalization functions)
- Don't assume single trapper per request (use `request_trapper_assignments`)
- Don't confuse colony size (estimate) with cats caught (verified clinic data)
- Don't return 404 for merged entities - Check `merged_into_place_id` and redirect
- Don't hardcode place context types - Use `place_context_types` table
- Don't INSERT directly into place_contexts - Use `assign_place_context()` function

## Tippy Documentation Requirements

**IMPORTANT:** When making data quality fixes or significant changes, update the Tippy reference documentation so Tippy (the AI assistant) can explain changes to staff.

### After Data Quality Fixes

Update `docs/TIPPY_DATA_QUALITY_REFERENCE.md` with:

1. **Data Quality Fix Log entry:**
   ```markdown
   ### YYYY-MM-DD: Brief Title

   **Problem:** What was wrong or missing
   **Investigation:** How discovered, what analysis done
   **Solution:** Which migrations/code changes
   **Result:** Quantified outcome (X records fixed)
   ```

2. **Update statistics** if appointment linking status changed

3. **Add staff guidance** if new scenarios need explanation

### After Significant Development Sessions

Add a Development Session Log entry:
```markdown
### Session: YYYY-MM-DD - Topic

**Context:** Why this work was initiated
**Key Discoveries:** What was learned
**Changes Made:** Brief list of migrations/features
**Staff Impact:** How this affects staff workflows
```

### Why This Matters

Tippy uses this documentation to:
- Explain data discrepancies to staff
- Provide context on why certain records can't be linked
- Help staff understand system limitations
- Answer questions about recent changes
