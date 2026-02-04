# Atlas — Detailed Reference

This document contains detailed reference material extracted from CLAUDE.md. The main CLAUDE.md file contains critical rules only. Read this when you need implementation details for a specific subsystem.

## Table of Contents

- [Architecture](#architecture)
- [Processing Pipeline](#processing-pipeline)
- [Data Engine](#data-engine)
- [VolunteerHub Integration](#volunteerhub-integration)
- [ShelterLuv Integration](#shelterluv-integration)
- [Multi-Source Data Transparency](#multi-source-data-transparency)
- [Atlas Map (Beacon)](#atlas-map-beacon)
- [Coordinate-Only Places & Reverse Geocoding](#coordinate-only-places--reverse-geocoding)
- [Place Family System](#place-family-system)
- [Google Maps Entry Linking](#google-maps-entry-linking)
- [Place Type Classification](#place-type-classification)
- [Colony Size Tracking](#colony-size-tracking)
- [Colony Classification System](#colony-classification-system)
- [Place Context Tagging](#place-context-tagging)
- [Person-Cat Relationships](#person-cat-relationships)
- [Custom Intake Fields](#custom-intake-fields)
- [Tippy Dynamic Schema Navigation](#tippy-dynamic-schema-navigation)
- [AI Enrichment Scripts](#ai-enrichment-scripts)
- [Views Catalog](#views-catalog)
- [Common Tasks](#common-tasks)
- [Environment Variables](#environment-variables)

---

## Architecture

### Three-Layer Data Model

1. **Raw** (`staged_records`) — Immutable audit trail
2. **Identity Resolution** — Matching via email/phone
3. **Source of Truth** (`sot_*` tables) — Canonical records

### Key Tables (in `trapper` schema)

- `sot_people` — All people
- `sot_cats` — All cats with microchips
- `sot_requests` — All service requests
- `places` — All addresses
- `person_identifiers` — Email/phone for identity matching
- `person_roles` — Role assignments (trapper, volunteer, etc.)
- `request_trapper_assignments` — Many-to-many request-trapper links
- `processing_jobs` — Centralized job queue for data processing
- `place_contexts` — Place relevance tags (colony_site, foster_home, etc.)
- `person_cat_relationships` — Foster/adopter/owner links between people and cats
- `map_annotations` — Lightweight staff map pins (colony sightings, hazards, feeding sites, reference notes)
- `journal_entries` — Polymorphic journal notes linked to any entity (request, cat, person, place, annotation)

---

## Processing Pipeline

### Centralized Processing Pipeline (MIG_312, MIG_313)

All ingested data flows through a unified job queue:

1. **Staging**: CLI/UI/API stages data in `staged_records`
2. **Enqueueing**: `trapper.enqueue_processing()` creates job in queue
3. **Processing**: `trapper.process_next_job()` orchestrates (cron every 10 min)
4. **Entity Linking**: `trapper.run_all_entity_linking()` runs after each batch

**Key Functions:**
- `enqueue_processing(source, table, trigger, batch_id, priority)` — Queue a job
- `process_next_job(batch_size)` — Process next job (claims via `FOR UPDATE SKIP LOCKED`)
- `process_clinichq_owner_info(job_id, batch_size)` — Backfills owner_email, links person_id
- `link_appointments_via_safe_phone()` — Links via phone when uniquely identifying

**Endpoints:**
- `POST /api/ingest/process` — Unified processor (cron every 10 min)
- `GET /api/cron/entity-linking` — Entity linking + catch-up processing (cron every 15 min)
- `GET /api/health/processing` — Monitoring dashboard

### Pipeline Operations

After each ClinicHQ data ingest (especially owner_info):

1. **Upload** owner_info CSV via Admin UI (`/admin/ingest`)
2. **Processing** happens automatically via cron (`POST /api/ingest/process` every 10 min)
3. **Entity linking** runs after each batch via `run_all_entity_linking()` (7 steps)
4. **Verify** via `GET /api/health/processing` or `SELECT * FROM trapper.v_processing_dashboard`

### Post-Ingest Safety Net (MIG_862)

The entity-linking cron (`/api/cron/entity-linking`) runs a **catch-up step** before entity linking:
1. Calls `process_clinichq_cat_info(NULL, 500)` — processes any unprocessed cat_info staged records
2. Calls `process_clinichq_owner_info(NULL, 500)` — processes any unprocessed owner_info staged records
3. Calls `run_all_entity_linking()` — links all entities including Step 7 (person-cat relationships)

**Critical Chain for clinic cats to appear fully linked:**
`process_clinichq_cat_info` (creates cats) → `process_clinichq_owner_info` (creates people, places, links) → `run_all_entity_linking` (cats→places→requests, person-cat relationships)

### Manual Backfill

```sql
-- Queue backfill jobs
SELECT trapper.enqueue_processing('clinichq', 'owner_info', 'backfill', NULL, 10);

-- Process (run repeatedly until no_jobs)
SELECT * FROM trapper.process_next_job(500);

-- Check status
SELECT * FROM trapper.v_processing_dashboard;
```

### If Pipeline Stalls (no processing for 24+ hours)

```sql
-- Check for stuck/failed jobs
SELECT status, COUNT(*) FROM trapper.processing_jobs GROUP BY status;

-- Expire stuck jobs (claimed but not completed)
UPDATE trapper.processing_jobs
SET status = 'expired', completed_at = NOW()
WHERE status = 'processing' AND claimed_at < NOW() - INTERVAL '1 hour';

-- Re-queue failed jobs
SELECT trapper.enqueue_processing('clinichq', 'owner_info', 'backfill', NULL, 10);

-- Process manually
SELECT * FROM trapper.process_next_job(500);
```

**Key diagnostic:** If `owner_email`/`owner_phone` is NULL on recent appointments, the owner_info pipeline hasn't run. Re-upload the owner_info file via `/admin/ingest` to backfill.

---

## Data Engine

### Overview (MIG_314-317)

The Data Engine is Atlas's unified system for identity resolution and entity matching:

1. **Multi-signal weighted scoring** — Combines email, phone, name, and address signals
2. **Household modeling** — Recognizes multiple people at the same address sharing identifiers
3. **Configurable matching rules** — Thresholds stored in database, not code
4. **Review queue** — Uncertain matches go to humans for resolution
5. **Full audit trail** — Every matching decision logged with reasoning

### Key Tables

- `data_engine_matching_rules` — Configurable matching rules with weights/thresholds
- `data_engine_match_decisions` — Full audit trail of all identity decisions
- `households` — Household groupings at addresses
- `household_members` — People belonging to households
- `data_engine_soft_blacklist` — Shared identifiers requiring extra verification

### Key Functions

- `data_engine_resolve_identity(email, phone, first, last, addr, source)` — Main entry point
- `data_engine_score_candidates(email, phone, name, addr)` — Multi-signal scoring
- `data_engine_create_household(place_id, person_ids)` — Household management
- `find_or_create_person()` — Now delegates to Data Engine internally

### Decision Types

| Type | Score Range | Action |
|------|-------------|--------|
| `auto_match` | >= 0.95 | Automatically link to existing person |
| `review_pending` | 0.50 - 0.94 | Create new, flag for human review |
| `household_member` | 0.50+ with low name match | Create new, add to household |
| `new_entity` | < 0.50 | Create new person |
| `rejected` | N/A | Internal account or no identifiers |

### API Endpoints

- `GET /api/health/data-engine` — Health check and statistics
- `GET /api/admin/data-engine/rules` — View matching rules
- `PATCH /api/admin/data-engine/rules` — Update rule thresholds
- `GET /api/admin/data-engine/review` — View pending reviews
- `POST /api/admin/data-engine/review/[id]` — Resolve a review
- `GET /api/admin/data-engine/households` — View households
- `GET /api/admin/data-engine/stats` — Comprehensive statistics

### Views

- `v_data_engine_health` — Quick health metrics
- `v_data_engine_stats` — Decision statistics
- `v_data_engine_review_queue` — Pending reviews
- `v_households_summary` — Household overview

---

## VolunteerHub Integration

### Overview (MIG_809-811)

Atlas syncs volunteer data from VolunteerHub (VH) API to track FFSC volunteer roles, group memberships, and profile data.

### Key Tables

| Table | Purpose |
|-------|---------|
| `volunteerhub_user_groups` | Mirrors VH group hierarchy with `atlas_role` mapping |
| `volunteerhub_group_memberships` | Temporal join/leave tracking (`joined_at`/`left_at`) |
| `volunteerhub_volunteers` | Extended with 17 fields: skills, availability, notes, etc. |

### Role Mapping (VH Groups -> Atlas Roles)

| VH Group | atlas_role | Notes |
|----------|-----------|-------|
| Approved Trappers | trapper (ffsc_trapper) | VH membership = authority for FFSC trapper status |
| Approved Foster Parent | foster | |
| Approved Colony Caretakers | caretaker | |
| Admin/Office | staff | |
| All other approved groups | volunteer | |

### Key Functions

- `process_volunteerhub_group_roles(person_id, vh_id)` — Maps VH groups to person_roles
- `sync_volunteer_group_memberships(vh_id, group_uids[])` — Temporal membership tracking
- `cross_reference_vh_trappers_with_airtable()` — Reconciliation report

### Sync Script

```bash
# Full sync (all users since beginning)
node scripts/ingest/volunteerhub_api_sync.mjs --full-sync --verbose

# Incremental sync (since last sync)
node scripts/ingest/volunteerhub_api_sync.mjs --verbose

# Groups only
node scripts/ingest/volunteerhub_api_sync.mjs --groups-only
```

### Cron

- `/api/cron/volunteerhub-sync` — Every 6h incremental, weekly full sync Sundays
- `/api/health/volunteerhub` — Sync status, group breakdown, trapper reconciliation

---

## ShelterLuv Integration

### Overview (MIG_621)

Atlas syncs data from ShelterLuv via API to supplement clinic data with adoption outcomes, foster placements, and TNR completion tracking.

### Sync Configuration

**Schedule:** Every 6 hours via Vercel Cron (`0 */6 * * *`)

**Endpoints:**
- `GET /api/cron/shelterluv-sync` — Automated sync endpoint
- Admin UI: `/admin/ingest` shows ShelterLuv sync status

### Key Tables

| Table | Purpose |
|-------|---------|
| `shelterluv_sync_state` | Tracks sync progress per entity type (animals, people, events) |
| `v_shelterluv_sync_status` | View showing sync health and pending records |

### Event Processing

| Event Type | Atlas Action |
|------------|--------------|
| `Outcome.Adoption` | Creates adopter relationship, tags place as `adopter_residence` |
| `Outcome.Foster` | Creates foster relationship, tags place as `foster_home` |
| `Outcome.FeralWildlife` (Released to Colony) | Marks cat as TNR complete |
| `Outcome.Euthanasia` | Creates mortality event via `register_mortality_event()` |

### Data Flow

```
ShelterLuv API -> shelterluv_api_sync.mjs -> staged_records -> Data Engine -> SOT Tables
```

---

## Multi-Source Data Transparency

### Overview (MIG_620)

When cats have data from multiple sources (ClinicHQ, ShelterLuv, PetLink), Atlas tracks field-level provenance so staff can see which source reported what.

### Recording Field Sources

All ingest pipelines should call `record_cat_field_sources_batch()`:

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

The `is_current` flag indicates which source's value is displayed:

```
ClinicHQ (highest) -> ShelterLuv -> PetLink -> Airtable -> Legacy (lowest)
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

`name`, `breed`, `sex`, `primary_color`, `secondary_color`, `altered_status`, `coat_pattern`, `estimated_age`, `ownership_type`

---

## Atlas Map (Beacon)

The Atlas Map (`/map`) visualizes all location data with Google Maps-style pins.

### Architecture

| Component | Purpose |
|-----------|---------|
| `AtlasMap.tsx` | Main map component with layers, search, filters (Leaflet.js) |
| `PlaceDetailDrawer.tsx` | Slide-out drawer for place details |
| `map-markers.ts` | Google-style SVG marker factories |
| `atlas-map.css` | Map styling |

Uses `leaflet.markercluster` for atlas pin clustering (chunked loading, animated transitions). Historical pins use canvas renderer (`L.circleMarker` + `L.canvas()`) for performance.

### Map Layers

| Layer | Data Source | Pin Style |
|-------|-------------|-----------|
| `atlas_pins` | `v_map_atlas_pins` view | Google teardrop pins (two tiers) |
| `google_pins` | `google_map_entries` | Drop pins with labels |
| `tnr_priority` | Places needing TNR | Priority-colored pins |
| `volunteers` | Person with trapper role | Star markers |

**Note:** `historical_pins` layer was removed in MIG_820. All Google Maps entries now appear as reference-tier atlas pins.

### Two-Tier Pin System (MIG_820)

| Tier | Criteria | Description |
|------|----------|-------------|
| `active` | Disease risk, cats, requests, active volunteers, intake submissions | Full teardrop pins |
| `reference` | History only, minimal data | Smaller muted pins |

### Pin Styles (by status)

| Style | Color | Icon | Trigger |
|-------|-------|------|---------|
| `disease` | Orange (#ea580c) | Alert | `disease_risk = true` |
| `watch_list` | Purple (#8b5cf6) | Eye | `watch_list = true` |
| `active` | Green (#22c55e) | Cat count | `cat_count > 0` |
| `active_requests` | Blue (#3b82f6) | Request | `request_count > 0` or `intake_count > 0` |
| `has_history` | Indigo (#6366f1) | Document | `google_entry_count > 0` |
| `minimal` | Blue (#3b82f6) | Dot | Default |

### Data Flow (Real-Time)

Map data comes from **SQL views** (not materialized), so it's always current:
1. New intake/request -> Stored in database
2. Processing cron (every 10 min) -> `run_all_entity_linking()`
3. Entity linking includes Google Maps entry linking (steps 10-11)
4. Map API queries `v_map_atlas_pins` -> Always reflects current state

### PlaceDetailDrawer Features

- **Three tabs:** Original Notes | AI Summaries | Journal
- **Notes display:** Uses `original_redacted` (light cleanup) or `original_content`
- **AI summaries:** Uses `ai_summary` field from paraphrase job
- **Watchlist toggle:** Add/remove with reason, updates `places.watch_list`

### Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/beacon/map-data` | All map layer data with filters |
| `GET /api/places/[id]/map-details` | Full place details for drawer |
| `PUT /api/places/[id]/watchlist` | Toggle watchlist status |
| `GET /api/cron/geocode` | Forward + reverse geocoding (cron every 5-10 min) |

### Map Search

- `search_unified()` (MIG_791) returns `lat`/`lng` in metadata for both places and people
  - Place coordinates from `places.location` (PostGIS geography)
  - Person coordinates from most recent linked place via `person_place_relationships`

---

## Coordinate-Only Places & Reverse Geocoding

### Overview (MIG_820-822)

Some places have coordinates but no street address — from Google Maps KML data or "place a pin" UI.

### Place Types by Address Status

| `is_address_backed` | `formatted_address` | Description | Quality |
|---------------------|---------------------|-------------|---------|
| `TRUE` | Set | Full address with `sot_address_id` | A-B |
| `FALSE` | Set | Has address text but no structured address record | C |
| `FALSE` | `NULL` | Coordinate-only, needs reverse geocoding | D |

### Reverse Geocoding Pipeline

1. `get_reverse_geocoding_queue(limit)` — Returns places needing reverse geocoding
2. Google API: `GET /maps/api/geocode/json?latlng={lat},{lng}` -> address
3. `record_reverse_geocoding_result(place_id, success, google_address, error)`:
   - **Match found**: Merges coordinate place into existing address-backed place
   - **No match**: Upgrades place with `formatted_address`, keeps `is_address_backed = FALSE`
   - **Failure**: Exponential backoff (1, 5, 15, 60 min, then permanent fail)

### Key Functions (MIG_821)

| Function | Purpose |
|----------|---------|
| `create_place_from_coordinates(lat, lng, name, source)` | Create coordinate-only place (10m dedup) |
| `get_reverse_geocoding_queue(limit)` | Queue of places needing reverse geocoding |
| `record_reverse_geocoding_result(place_id, success, addr, err)` | Record result with auto-merge |
| `try_match_google_map_entries_to_place(place_id)` | PostGIS-based GM entry matching |

### Cron Integration

`/api/cron/geocode` runs every 5-10 minutes with a shared budget of 50 API calls:
- **Phase 1**: Forward geocoding (address -> coordinates)
- **Phase 2**: Reverse geocoding (coordinates -> address) with remaining budget

### Batch Script

```bash
node scripts/jobs/reverse_geocode_batch.mjs
node scripts/jobs/reverse_geocode_batch.mjs --limit 100
node scripts/jobs/reverse_geocode_batch.mjs --dry-run
```

### Stats View

```sql
SELECT * FROM trapper.v_reverse_geocoding_stats;
-- Returns: coordinate_only_total, pending_reverse, failed_reverse, ready_to_process
```

---

## Place Family System

### Overview (MIG_822)

Multi-unit buildings and co-located places are linked structurally.

**Structural relationships** (via `parent_place_id`):
- `apartment_building` -> parent record (may be empty shell)
- `apartment_unit` -> child with `parent_place_id` and `unit_identifier`
- Auto-created by `find_or_create_place_deduped()` when unit is detected in address

**Co-located detection** (via `get_place_family()`):
- Places within 1m of each other at the same geocoded point
- Catches unclassified groups that predate the apartment hierarchy
- 1m = same physical point (not arbitrary — GPS precision is ~3m)

**How it works in practice:**
- API endpoints use `get_place_family(place_id)` to aggregate GM notes, people, etc.
- `v_map_atlas_pins` filters out empty co-located places (no overlapping pins)
- `backfill_apartment_hierarchy()` classifies units with indicators in their address
- Ongoing: `find_or_create_place_deduped()` handles new unit addresses automatically

---

## Google Maps Entry Linking

### Overview (MIG_733-736)

Historical Google Maps pins are linked to Atlas places through a tiered, safety-conscious system.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Never wrongly merge** | Conservative distance thresholds, multi-unit places never auto-link |
| **Pipeline integrated** | Runs automatically via `run_all_entity_linking()` |
| **Confidence-weighted** | Combines distance, AI signals, place type, and recency decay |
| **Re-evaluates on new places** | Trigger updates nearby unlinked entries when places are created |

### Tiered Distance Thresholds

| Place Type | Auto-Link Threshold | Rationale |
|------------|---------------------|-----------|
| Residential (single_family) | <=15m | Same property |
| Business/commercial | <=20m | Larger footprint |
| Rural/outdoor_site | <=30m | Large properties |
| Multi-unit (apartment, mobile home) | NEVER auto-link | Requires unit selection |
| Unknown | <=10m | Extra conservative |

### Multi-Unit Safety

Multi-unit places (apartments, mobile home parks) NEVER auto-link. They are flagged with `requires_unit_selection = TRUE` for manual review.

Functions:
- `is_multi_unit_place(place_id)` — Returns TRUE for apartments/mobile homes
- `flag_multi_unit_candidates()` — Flags entries near multi-unit places

### Pipeline Integration

The entity linking chain (`run_all_entity_linking()`) includes Google Maps linking as steps 10 & 11:

```sql
-- Step 10: Link Google Maps entries to places
SELECT trapper.link_google_entries_incremental(500);

-- Step 11: Flag multi-unit candidates for manual review
SELECT trapper.flag_multi_unit_candidates();
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `link_google_entries_incremental(limit)` | Runs after each ingest, applies tiered thresholds |
| `link_google_entries_tiered(limit, dry_run)` | Batch tiered linking for cron |
| `link_google_entries_from_ai(limit, dry_run)` | Links high-confidence AI suggestions |
| `calculate_link_confidence(distance, ai_conf, ai_same, place_type, date)` | Confidence scoring |
| `manual_link_google_entry(entry_id, place_id)` | Staff manual linking |
| `unlink_google_entry(entry_id)` | Undo incorrect links |

### Key Columns on google_map_entries

| Column | Purpose |
|--------|---------|
| `linked_place_id` | The place this entry is linked to |
| `link_confidence` | 0.0-1.0 confidence score |
| `link_method` | How linked: 'coordinate_exact', 'ai_entity_link', 'manual', etc. |
| `linked_at` | When the link was created |
| `requires_unit_selection` | TRUE if near multi-unit place |
| `nearest_place_id` | Closest Atlas place (for UI suggestions) |
| `nearest_place_distance_m` | Distance to nearest place |

### Daily Cron

`/api/cron/google-entry-linking` runs daily at 9 AM UTC:
1. Updates `nearest_place_id` for all unlinked entries
2. Runs tiered auto-linking for eligible entries
3. Processes high-confidence AI suggestions
4. Flags multi-unit candidates for review
5. Logs metrics

### Audit Trail

All linking decisions are logged in `google_entry_link_audit`:

| Column | Purpose |
|--------|---------|
| `action` | 'linked', 'unlinked', 'rejected' |
| `link_method` | How the decision was made |
| `confidence` | Confidence score at time of decision |
| `performed_by` | 'system:entity_linking' or staff name |

---

## Place Type Classification

### Overview (MIG_734)

AI classifies place types to improve linking decisions and map display.

### Classification Types

| Type | Description | Linking Behavior |
|------|-------------|------------------|
| `single_family` | Standard house | 15m threshold |
| `apartment_building` | Multi-unit apartment (parent) | Never auto-link |
| `apartment_unit` | Individual apartment unit | Never auto-link |
| `mobile_home_park` | Park with multiple spaces (parent) | Never auto-link |
| `mobile_home_space` | Individual mobile home | Never auto-link |
| `ranch_property` | Large rural property | 30m threshold |
| `commercial` | Business/storefront | 20m threshold |
| `outdoor_site` | Park, field, outdoor area | 30m threshold |
| `unknown` | Needs classification | 10m threshold |

### Running Classification

```bash
node scripts/jobs/classify_place_types.mjs --limit 100 --dry-run
node scripts/jobs/classify_place_types.mjs --limit 500
node scripts/jobs/classify_place_types.mjs --reclassify-all --limit 100
```

### Key Fields on Places

| Field | Purpose |
|-------|---------|
| `place_kind` | Classified type (enum) |
| `ai_classification` | JSONB with full classification details |
| `ai_classified_at` | When last classified |

### Map Clustering

The map view includes clustering fields for zoom-based display:

| Field | Purpose |
|-------|---------|
| `parent_place_id` | Links apartment units to their building |
| `place_kind` | Type for display/filtering |
| `unit_identifier` | Unit designation ("Apt 5", "Space 12") |

Frontend: When zoom < 16, cluster apartment units into parent building. When zoomed in, show individual units.

---

## Colony Size Tracking

### Overview (MIG_209)

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

`v_place_colony_status` — Aggregates all estimates with weighted confidence.

See `docs/architecture/colony-estimation.md` for full methodology.

---

## Colony Classification System

### Overview (MIG_615)

Not all places with cats are the same. The classification system distinguishes between **individual cats** (sporadic neighborhood cats) and **colony sites** (established feeding locations).

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

---

## Place Context Tagging

### Overview (MIG_464)

Places are tagged with contextual relevance. See `docs/PLACE_CONTEXTS.md` for full documentation.

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

- `assign_place_context(place_id, context_type, ...)` — Idempotent assignment
- `end_place_context(place_id, context_type)` — End active context

### Views

- `v_place_active_contexts` — All currently active contexts with labels
- `v_place_context_summary` — Aggregated contexts per place

---

## Person-Cat Relationships

### Overview (MIG_465)

Tracks relationships between people and cats (foster, adopter, owner, caretaker).

### Key Tables

- `person_cat_relationships` — Links people to cats with relationship type

### Views

- `v_person_cat_history` — Person-cat relationships with cat details
- `query_person_cat_history(name, email, type)` — Query function for foster/adopter history

### ShelterLuv Outcomes

```sql
SELECT * FROM trapper.process_shelterluv_outcomes(500);
```

Creates adopter relationships and tags places with `adopter_residence` context.

---

## Custom Intake Fields

### Overview (MIG_238)

Custom intake questions can be added via admin UI without code changes.

**Admin UI:** `/admin/intake-fields`

### Database Table: `trapper.intake_custom_fields`

| Column | Purpose |
|--------|---------|
| `field_key` | Snake_case identifier (e.g., `how_heard_about_us`) |
| `field_label` | Human-readable label |
| `field_type` | text, textarea, number, select, checkbox, date, phone, email |
| `options` | JSONB array of `{value, label}` for select fields |
| `show_for_call_types` | Array of call types to show for (null = all) |
| `is_beacon_critical` | Important for Beacon analytics |

### Airtable Sync

Click "Sync to Airtable" in admin UI to push new fields. After sync: add same question to Jotform and map to new Airtable column.

### Cat Ownership Types

- `unknown_stray` — Stray cat (no apparent owner)
- `community_colony` — Outdoor cat I/someone feeds
- `newcomer` — Newcomer (just showed up recently)
- `neighbors_cat` — Neighbor's cat
- `my_cat` — My own pet

### Feeding Behavior Fields (MIG_236)

- `feeds_cat` — Does requester feed the cat?
- `feeding_frequency` — Daily, few times/week, occasionally, rarely
- `feeding_duration` — How long feeding/aware
- `cat_comes_inside` — Yes regularly, sometimes, never

### Emergency Handling

- `is_emergency` — Flagged as urgent
- `emergency_acknowledged` — User acknowledged FFSC is not a 24hr hospital

Custom field values stored in `web_intake_submissions.custom_fields` as JSONB.

---

## Tippy Dynamic Schema Navigation

### Overview (MIG_517-521)

Tippy uses dynamic schema navigation to query 190+ database views without hardcoded tools. See `docs/TIPPY_VIEWS_AND_SCHEMA.md` for full documentation.

### Key Tables

| Table | Purpose |
|-------|---------|
| `tippy_view_catalog` | Registry of views Tippy can query (31 views) |
| `tippy_proposed_corrections` | Data corrections Tippy proposes for review |
| `tippy_unanswerable_questions` | Questions Tippy couldn't answer (gap tracking) |
| `tippy_view_usage` | Analytics on which views are queried |

### Admin Pages

- `/admin/tippy-corrections` — Review and apply data corrections
- `/admin/tippy-gaps` — Review unanswerable questions to identify schema gaps

### Adding Views to Tippy

```sql
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES ('v_my_view', 'stats', 'Description', ARRAY['col1'], ARRAY['filter_col'], ARRAY['Example question?']);
```

---

## AI Enrichment Scripts

### Scripts (`scripts/jobs/`)

| Script | Purpose | Output Table |
|--------|---------|--------------|
| `ai_classification_backfill.mjs` | Multi-source classification suggestions | `sot_requests`, `places` |
| `classify_place_types.mjs` | AI classifies place types | `places.place_kind` |
| `populate_birth_events_from_appointments.mjs` | Birth events from lactating/pregnant appointments | `cat_birth_events` |
| `populate_mortality_from_clinic.mjs` | Mortality events from euthanasia notes | `cat_mortality_events` |
| `parse_quantitative_data.mjs` | AI extracts cat counts, colony sizes from notes | `place_colony_estimates` |
| `paraphrase_google_map_entries.mjs` | Light cleanup of Google Maps notes | `google_map_entries.ai_summary` |

### Usage

```bash
export $(grep -v '^#' .env | xargs)
node scripts/jobs/ai_classification_backfill.mjs --limit 100 --dry-run
node scripts/jobs/parse_quantitative_data.mjs --source google_maps --limit 100
node scripts/jobs/populate_birth_events_from_appointments.mjs --dry-run
```

**Cron Endpoint:** `/api/cron/beacon-enrich` runs daily at 10 AM PT

### Reusable AI Enrichment Pattern

The `ai_classification_backfill.mjs` script demonstrates the standard pattern:

1. **Data Collection** — Gather all relevant data for an entity from multiple sources
2. **Prompt Construction** — Build structured prompt with gathered data
3. **AI Analysis** — Claude returns structured JSON with classification + confidence
4. **Application** — Save results, auto-apply at high confidence thresholds

---

## Views Catalog

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
| `v_map_atlas_pins` | Consolidated map pins: two-tier, filters empty shells |
| `v_reverse_geocoding_stats` | Coordinate-only place geocoding progress |
| `v_data_flow_status` | Unified data flow monitoring |
| `v_data_engine_coverage` | Data Engine coverage statistics |
| `v_people_without_data_engine` | People missing Data Engine audit trail |
| `v_potential_duplicate_people` | Possible duplicate people records |
| `v_potential_duplicate_places` | Possible duplicate place records |
| `v_person_dedup_candidates` | 5-tier person duplicate detection |
| `v_person_dedup_summary` | Aggregate person dedup counts by tier |
| `place_dedup_candidates` | Materialized place duplicate pairs (PostGIS + trigram) |
| `v_shelterluv_sync_status` | ShelterLuv sync health |
| `v_cat_field_sources_summary` | Multi-source field values per cat |
| `v_cat_field_conflicts` | Cats where sources disagree |
| `v_journal_entries` | Journal entries with joined entity names |

---

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

### Cat-Place Linking (MIG_235)

Cats from clinic appointments are linked to places via owner contact info:
1. Find cat via microchip in `cat_identifiers`
2. Match owner email/phone from appointment to `person_identifiers`
3. Get place from `person_place_relationships`
4. Create `cat_place_relationships` with type `'appointment_site'`

Re-link: `SELECT * FROM trapper.link_appointment_cats_to_places();`

### Trapper-Appointment Linking (MIG_238)

- `sot_appointments.trapper_person_id` — Direct link to trapper
- Use `v_trapper_appointment_stats` for clinic stats
- Re-link: `SELECT * FROM trapper.link_appointments_to_trappers();`

---

## Environment Variables

Required in `.env`:

- `DATABASE_URL` — Postgres connection string
- `AIRTABLE_PAT` — Airtable Personal Access Token
- `GOOGLE_PLACES_API_KEY` — For geocoding
- `SHELTERLUV_API_KEY` — ShelterLuv API key
- `VOLUNTEERHUB_API_KEY` — VolunteerHub API key
