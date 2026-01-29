# Atlas Task Ledger

**Version:** 1.0
**Created:** 2026-01-28
**Owner:** Engineering

---

## Rules

1. **No task may touch ACTIVE flow surfaces without a "Surgical Change" annotation** and passing the Active Flow Safety Gate (`docs/ACTIVE_FLOW_SAFETY_GATE.md`).
2. Every task card has: scope, touched surfaces, ACTIVE impact (Yes/No), validation steps, rollback notes, and a stop point.
3. Tasks execute in numbered order. Do not skip ahead unless explicitly unblocked.
4. Status values: `Planned` | `In Progress` | `Done` | `Blocked`

---

## TASK_001: System Inventory + Fragmentation Map

**Status:** Done (captured in NORTH_STAR + this ledger)
**ACTIVE Impact:** No
**Scope:** Read-only exploration. No schema changes.

### Layer Mapping

| Layer | Tables (key) | Functions (key) | Views (key) | Count |
|-------|-------------|-----------------|-------------|-------|
| **L1 RAW** | staged_records, ingest_run_records, ingest_runs, file_uploads, raw_intake_*, raw_airtable_* | enqueue_processing, process_next_job | v_staged_records_latest_run, v_ingest_run_summary | ~15 tables |
| **L2 IDENTITY** | person_identifiers, cat_identifiers, data_engine_match_decisions, data_engine_matching_rules, households, household_members, person_merges, potential_person_duplicates | find_or_create_person, find_or_create_place_deduped, find_or_create_cat_by_microchip, data_engine_resolve_identity, data_engine_score_candidates | v_data_engine_health, v_data_engine_review_queue, v_households_summary | ~20 tables |
| **L3 ENRICHMENT** | entity_attributes, entity_attribute_definitions, extraction_queue, extraction_status, attribute_extraction_jobs | classify_place_from_extractions, extract_observations_from_staged | v_extraction_queue_status, v_ai_extraction_status, v_extraction_coverage | ~8 tables |
| **L4 CLASSIFICATION** | place_contexts, place_context_types, known_organizations, organization_place_mappings, google_map_entries | assign_place_context, set_place_classification, infer_place_contexts_from_data, infer_place_kind | v_place_active_contexts, v_place_classifications, v_place_context_summary | ~10 tables |
| **L5 SoT** | sot_people, sot_cats, sot_requests, sot_appointments, places, sot_addresses | find_or_create_request, convert_intake_to_request, build_clinichq_visits_v2 | v_canonical_people, v_canonical_cats, v_canonical_places | ~10 core tables |
| **L6 WORKFLOWS** | web_intake_submissions, journal_entries, request_trapper_assignments, communication_logs, staff, staff_sessions, trapper_onboarding, email_*, clinic_days, clinic_day_entries | compute_intake_triage, add_journal_entry, assign_trapper_to_request, convert_intake_to_request | v_intake_triage_queue, v_request_list, v_request_journal, v_pending_intake | ~30 tables |
| **L7 BEACON** | place_colony_estimates, cat_birth_events, cat_mortality_events, cat_movement_events, site_observations, ecology_config, observation_zones | beacon_cluster_colonies, calculate_chapman_estimate, calculate_survival_rates | v_beacon_summary, v_place_ecology_stats, v_place_colony_status, v_seasonal_dashboard | ~15 tables |
| **SUPPORT** | processing_jobs, entity_edits, data_changes, person_roles, person_place_relationships, cat_place_relationships, person_cat_relationships | All linking functions, audit functions | Most remaining 308 views | ~90 tables |

### Top 5 Failure Modes (Data Disappearance)

| # | Failure Mode | Severity | Count | Root Cause |
|---|-------------|----------|-------|------------|
| **F1** | Merge chain black holes (people) | CRITICAL | 1,194 people | `merged_into_person_id` points to another merged person. Single-hop lookup lands on dead record. |
| **F2** | Processing pipeline stalled | CRITICAL | 26,383 queued jobs | `process_next_job()` is not being called. Jobs sit in `queued` state indefinitely. |
| **F3** | Unprocessed ShelterLuv records | HIGH | 5,058 records | ShelterLuv staged records never processed into SoT. Foster/adopter outcomes missing. |
| **F4** | People without identifiers | HIGH | 986 people | No email/phone in `person_identifiers`. Will be duplicated on next encounter. |
| **F5** | Cats without microchips | MEDIUM | 1,608 cats | No dedup key. Same cat can appear as multiple records from different sources. |

### Backup Table Bloat

| Table | Rows | Action |
|-------|------|--------|
| backup_staged_records_clinichq_20260112 | 100,945 | Archive candidate |
| backup_rebuild_cat_place_relationships | 31,948 | Archive candidate |
| backup_rebuild_person_cat_relationships | 26,518 | Archive candidate |
| backup_person_cat_rels_20260112 | 26,518 | Archive candidate |
| backup_places_mig158 | 11,008 | Archive candidate |
| backup_sot_people_mig157 | 9,479 | Archive candidate |
| **Total** | **~208,000** | |

### Validation
- [x] All tables mapped to layers
- [x] Failure modes identified with counts
- [x] No schema changes made

### Stop Point
Inventory is complete. Proceed to TASK_002.

---

## TASK_002: Fix Merge Chain Black Holes

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — `sot_people` is read by request detail, journal, search
**Scope:** Flatten all person merge chains to single-hop. Add prevention trigger.
**Migration:** `sql/schema/sot/MIG_770__fix_person_merge_chains.sql`

### What Changed

1. `get_canonical_person_id(UUID)` already existed (MIG_225) with recursive chain-following — no changes needed.
2. One-time data fix: UPDATE flattened all 4,509 multi-hop merge chains (depths 2-5) to single-hop.
3. Prevention trigger `trg_prevent_person_merge_chain` added on `sot_people` — resolves merge target to canonical before INSERT/UPDATE.

### Pre-Fix State

| Metric | Count |
|--------|-------|
| Total merged people | 28,810 |
| In multi-hop chains (broken) | 4,509 |
| Single-hop (correct) | 24,301 |
| Chain depth 2 | 3,972 |
| Chain depth 3 | 531 |
| Chain depth 4 | 4 |
| Chain depth 5 | 2 |
| Circular chains | 0 |

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `sot_people` | Table | UPDATE (merged_into_person_id) on 4,509 already-merged rows | Yes (read by requests, journal) |
| `trg_prevent_person_merge_chain` | Trigger | CREATE (new, on sot_people) | No (only fires on merge operations) |
| `trg_flatten_person_merge_target()` | Function | CREATE (new trigger function) | No |
| `_backup_person_merge_chains_770` | Table | CREATE (backup, 28,810 rows) | No |

### Safety

- Only modified `merged_into_person_id` on already-merged records (not active canonical people).
- All views filter `WHERE merged_into_person_id IS NULL` — merged records are invisible.
- No API response shapes changed.
- No existing trigger behavior changed.
- New trigger only fires when `merged_into_person_id` is set (merge operations only).

### Validation Evidence (2026-01-28)

- [x] **Zero chains remain:**
  ```
  chains_remaining = 0
  ```
- [x] **All 28,810 merged people point to canonical (non-merged) targets:**
  ```
  total_merged = 28,810 | pointing_to_canonical = 28,810 | still_in_chain = 0
  ```
- [x] **`get_canonical_person_id()` returns target for 500/500 sampled merged people:**
  ```
  sampled = 500 | canonical_equals_target = 500
  ```
- [x] **Prevention trigger test PASSED:** Merging C→A (where A→B) correctly flattens to C→B
- [x] **Prevention trigger enabled:**
  ```
  trg_prevent_person_merge_chain | enabled
  ```

### Active Flow Safety Gate — SQL Smoke Queries (2026-01-28)

- [x] **Views resolve:**
  ```
  v_intake_triage_queue  | 742 rows
  v_request_list         | 285 rows
  ```
- [x] **Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Core tables have data:**
  ```
  web_intake_submissions  | 1,174
  sot_requests            |   285
  journal_entries         | 1,856
  staff                   |    24
  staff_sessions (active) |     1
  ```
- [x] **`compute_intake_triage()` function exists** (signature: `p_submission_id UUID`)

### Rollback

- Backup table: `trapper._backup_person_merge_chains_770` (28,810 rows)
- Restore SQL:
  ```sql
  UPDATE trapper.sot_people sp
  SET merged_into_person_id = b.original_merged_into
  FROM trapper._backup_person_merge_chains_770 b
  WHERE b.person_id = sp.person_id;
  ```
- Remove trigger: `DROP TRIGGER trg_prevent_person_merge_chain ON trapper.sot_people;`

### Stop Point

Merge chains flattened, prevention trigger active. Proceed to TASK_003.

---

## TASK_003: Fix Place Merge Chains + Same Pattern for Places

**Status:** Planned
**ACTIVE Impact:** Yes (Surgical) — `places` is read by request detail, intake, search
**Scope:** Same as TASK_002 but for the 8 place merge chain black holes.

### What Changes

1. Create `get_canonical_place_id(UUID)` with recursive resolution (or verify existing one handles chains).
2. Flatten 8 place merge chains.
3. Add prevention constraint.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `places` | Table | UPDATE (merged_into_place_id) | Yes (read by requests, intake) |
| `get_canonical_place_id()` | Function | CREATE OR REPLACE | No |

### Safety

Same as TASK_002 — only modifies already-merged records. Views already filter them out.

### Validation

- [ ] `SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NOT NULL AND merged_into_place_id IN (SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL)` returns **0**
- [ ] Run Active Flow Safety Gate V1 (intake) — address autocomplete works
- [ ] Run Safety Gate V3 (request detail) — place info renders

### Rollback

- Same backup pattern as TASK_002

### Stop Point

Place chains flattened. Proceed to TASK_004.

---

## TASK_004: Stabilize Processing Pipeline

**Status:** Planned
**ACTIVE Impact:** No — processing pipeline is background/async, does not touch active UI flows
**Scope:** Diagnose why 26,383 jobs are queued but not processing. Fix or document the gap.

### What Changes

1. Investigate `process_next_job()` — is it being called? By what cron? What's failing?
2. Check `processing_jobs` table for error patterns, stuck claims, timeout issues.
3. Fix the pipeline or document that it's been superseded by newer ingestion patterns.
4. Process the 5,058 unprocessed ShelterLuv records if pipeline is fixable.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `processing_jobs` | Table | READ, UPDATE | No |
| `staged_records` | Table | READ | No |
| `process_next_job()` | Function | Investigate | No |
| Cron endpoint | API | Investigate | No |

### Safety

Processing is fully async/background. No ACTIVE flows depend on it. Worst case: jobs remain queued.

### Validation

- [ ] `SELECT status, COUNT(*) FROM trapper.processing_jobs GROUP BY status` shows progress (fewer queued, more completed/failed)
- [ ] ShelterLuv unprocessed count decreases
- [ ] No new errors in application logs

### Rollback

- Processing jobs can be re-queued. No destructive operations.

### Stop Point

Pipeline either fixed and processing, or documented as legacy with a replacement path identified.

---

## TASK_005: Backfill People Without Identifiers

**Status:** Planned
**ACTIVE Impact:** No — only adds data to people who have none
**Scope:** Find identifiers for the 986 people who have no email/phone in person_identifiers.

### What Changes

1. Cross-reference against `staged_records`, `clinichq_visits`, `web_intake_submissions` for email/phone associated with these people.
2. Add found identifiers via `add_person_identifier()`.
3. For truly identifier-less people: flag for review or archive if they have no relationships.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `person_identifiers` | Table | INSERT | No (additive) |
| `sot_people` | Table | READ | No |
| `staged_records` | Table | READ | No |

### Safety

Strictly additive — only inserting new identifier rows. Never modifying existing data.

### Validation

- [ ] `SELECT COUNT(*) FROM trapper.sot_people sp WHERE sp.merged_into_person_id IS NULL AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id)` decreases from 986
- [ ] No duplicate people created (check `potential_person_duplicates` count stays stable)

### Rollback

- Delete added identifiers: `DELETE FROM person_identifiers WHERE created_at > '{migration_start_time}'`

### Stop Point

Identifier count for active people maximized. Remaining unfindable people documented.

---

## TASK_006: Data Hygiene — Archive Backup Tables

**Status:** Planned
**ACTIVE Impact:** No
**Scope:** Drop or archive the ~208K rows in backup_* tables that are no longer needed.

### What Changes

1. Verify each backup table has no FK references.
2. For tables older than 30 days with no references: `DROP TABLE`.
3. Document what was removed and why.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `backup_*` (10 tables) | Tables | DROP | No |

### Safety

Backup tables are not referenced by any views, functions, or FK constraints. They are recovery artifacts from past migrations.

### Validation

- [ ] No errors from any view or function after drops
- [ ] Run Active Flow Safety Gate V1-V6 (all pass)
- [ ] Database size reduced

### Rollback

- Cannot undo DROP TABLE. Take a pg_dump of each before dropping.

### Stop Point

Backup tables removed. Storage reclaimed.

---

## ORCH_001: Minimal Orchestrator Backbone

**Status:** Planned
**ACTIVE Impact:** No — additive system alongside existing flows
**Scope:** Create the unified work queue and pipeline contract tables. Shadow mode only.

### What Changes

1. Create `orchestrator_sources` registry table (source declarations).
2. Create `orchestrator_jobs` unified work queue (generalizing `processing_jobs` + `extraction_queue`).
3. Create `orchestrator_routing_rules` (field → canonical surface mappings).
4. Create `orchestrator_job_log` (debuggable audit of routing decisions).
5. Wire existing `extraction_queue` as first consumer (adapter pattern, not replacement).

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| New tables (4) | Tables | CREATE | No |
| `extraction_queue` | Table | READ (adapter reads from new queue) | No |
| `processing_jobs` | Table | READ (adapter) | No |

### Safety

Purely additive. New tables. Existing systems unchanged. Orchestrator runs in shadow mode alongside current pipelines.

### Validation

- [ ] New tables created with correct schema
- [ ] Can register a source in `orchestrator_sources`
- [ ] Can create a job in `orchestrator_jobs`
- [ ] Adapter successfully reads from `orchestrator_jobs` and routes to `extraction_queue`
- [ ] All Active Flow Safety Gate checks pass (nothing changed in active paths)

### Rollback

- `DROP TABLE orchestrator_*` — clean removal, no dependencies

### Stop Point

Backbone exists. Shadow mode proven. Do not replace existing pipelines yet.

---

## ORCH_002: Source Registry + Onboarding Pattern

**Status:** Planned
**ACTIVE Impact:** No
**Scope:** Build the source registration and field mapping system. Demonstrate with one existing source (web_intake).

### What Changes

1. Populate `orchestrator_sources` with existing sources (clinichq, airtable, web_intake, shelterluv).
2. Define `orchestrator_field_mappings` — maps source fields to canonical targets.
3. Create `register_source()` function for declaring new sources.
4. Create `map_source_field()` function for declaring field→surface routing.
5. Demonstrate: register "client_survey" as a new source with cat_count → place_colony_estimates routing.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `orchestrator_sources` | Table | INSERT | No |
| `orchestrator_field_mappings` | Table | CREATE + INSERT | No |
| New functions (2) | Functions | CREATE | No |

### Validation

- [ ] All existing sources registered
- [ ] Field mappings for web_intake match current behavior
- [ ] New source registration works end-to-end in test
- [ ] Active Flow Safety Gate passes

### Rollback

- Truncate orchestrator tables. No external dependencies.

### Stop Point

Registry populated. One new source demonstrated. Pattern documented.

---

## ORCH_003: Data Health Checks + "Why Missing?" Surfaces

**Status:** Planned
**ACTIVE Impact:** No
**Scope:** Build diagnostic views and functions that surface data quality issues, routing failures, and explain why data is missing.

### What Changes

1. Create `v_orchestrator_health` — pipeline throughput, error rates, routing stats.
2. Create `v_data_why_missing` — surfaces entities that should have data but don't (places without colony estimates, people without identifiers, cats without places).
3. Create `v_merge_chain_health` — detects merge black holes across all entity types.
4. Create `v_routing_anomalies` — flags suspicious data (cat_count=500 at a house, negative values, impossible dates).
5. Optional admin page: `/admin/data-health`

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| New views (4) | Views | CREATE | No |
| Optional new page | UI | CREATE | No |

### Validation

- [ ] Health views return correct counts matching manual spot checks
- [ ] "Why missing" surfaces correctly identify known gaps (986 people, 1608 cats, 93 places)
- [ ] Merge chain health returns 0 black holes (after TASK_002/003)
- [ ] Active Flow Safety Gate passes

### Rollback

- `DROP VIEW` — clean removal

### Stop Point

Diagnostic surfaces exist. Data health is observable. No active flows changed.

---

## Task Execution Order

```
TASK_001 (Inventory)          ✅ Done
    ↓
TASK_002 (Merge chains: people)   ✅ Done — 4,509 chains flattened, prevention trigger added
    ↓
TASK_003 (Merge chains: places)   → Same pattern, 8 records only
    ↓
TASK_004 (Processing pipeline)    → Background only, fixes #2/#3 failure modes
    ↓
TASK_005 (People identifiers)     → Additive only, fixes #4 failure mode
    ↓
TASK_006 (Backup cleanup)         → Housekeeping, reclaim storage
    ↓
ORCH_001 (Orchestrator backbone)  → New additive tables, shadow mode
    ↓
ORCH_002 (Source registry)        → Config-driven routing
    ↓
ORCH_003 (Data health checks)     → Observability
```

---

## Change Log

| Date | Task | Action |
|------|------|--------|
| 2026-01-28 | TASK_001 | Completed: inventory + fragmentation map |
| 2026-01-28 | All tasks | Initial planning complete |
| 2026-01-28 | TASK_002 | Completed: 4,509 person merge chains flattened (MIG_770). Prevention trigger added. All Safety Gate checks pass. |
