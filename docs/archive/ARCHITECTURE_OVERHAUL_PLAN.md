# Atlas Data Architecture Overhaul Plan

**Document Version:** 1.0
**Created:** 2026-02-11
**Status:** Draft for Review

---

## Executive Summary

This document outlines a comprehensive plan to reorganize the Atlas database from its current organically-grown structure (~280+ tables) into a clean 3-layer architecture using industry-standard patterns. The goal is to create a scalable, navigable system while preserving all data integrity, maintaining active workflows, and preventing legacy data quality issues from propagating into the new system.

**Core Architecture:** Modified Medallion Architecture (Bronze → Silver → Gold) adapted for PostgreSQL operational databases.

**Migration Strategy:** Shadow Database Pattern with Blue-Green transition.

**Timeline:** Aggressive 8-10 weeks (prioritized work)

---

## Key Decisions (Confirmed 2026-02-11)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Schema naming** | Rename `trapper` → `atlas` | Clearer, project-appropriate naming |
| **Table naming** | Hybrid approach | Rename some (sot_people→people), keep others (sot_requests→requests) |
| **First-name-only records** | Source-dependent | ShelterLuv/VolunteerHub allow with flag; ClinicHQ→clinic_accounts; Airtable→reject unless salvageable |
| **Beacon data** | Isolate for now | Views only until 100% quality data; don't calculate on uncertain data |
| **Quarantine UI** | Priority feature | Build as part of migration, but only for truly ambiguous cases |
| **Legacy tables** | Keep then drop | Keep until migration complete, backup somewhere, then DROP |

---

## Critical Patterns to Preserve (Audit Findings 2026-02-11)

These patterns MUST be preserved in the new architecture. Breaking any of these causes cascading data quality issues.

### Must-Have Infrastructure

| Pattern | Current Location | New Location | Risk If Missed |
|---------|------------------|--------------|----------------|
| **Merge chains** (`merged_into_*`) | sot_* tables | `sot.*` tables | Returns duplicates in queries |
| **Atlas IDs** (stable handles) | sot_* tables | `sot.*` tables | External references break |
| **Confidence filtering** (`>= 0.5`) | person_identifiers queries | OPS views + API | Garbage PetLink emails displayed |
| **Soft blacklist** | data_engine_soft_blacklist | `atlas.soft_blacklist` | Org emails auto-match wrong people |
| **Relationship gatekeepers** | trapper.link_* functions | `atlas.link_*` functions | Pollution, duplicate links |
| **Audit trails** | entity_edits, journal_* | `audit.*` schema | Can't explain changes to staff |
| **Data quality alerts** | Triggers + views | `audit.quality_alerts` | Can't detect degradation |
| **Triggers** (25+) | Various | Migrate with tables | Consistency breaks |
| **Household modeling** | households, household_members | `sot.households` | Lost context for related people |
| **Place family navigation** | get_place_family() | `atlas.get_place_family()` | Multi-unit data pollution |
| **Verification status** | is_verified, evidence_type | Preserve on all tables | Pipelines overwrite staff corrections |

### Invariants to Enforce in Views

These filters MUST be baked into OPS/SoT views, not just API endpoints:

```sql
-- Every view exposing emails MUST include:
AND pi.confidence >= 0.5

-- Every view joining entities MUST include:
AND p.merged_into_person_id IS NULL
AND c.merged_into_cat_id IS NULL
AND pl.merged_into_place_id IS NULL

-- Every enrichment query MUST respect:
WHERE (is_verified = FALSE OR is_verified IS NULL)
  AND (evidence_type IS NULL OR evidence_type != 'manual')
```

### Data Pattern Detection System

**KEY PRINCIPLE:** Automatically detect edge cases before they cause "running in circles."

```
[Source Data] → [Pattern Detectors] → [Alerts] → [Auto-Fix / Quarantine / Review]
```

| Category | Examples | Action |
|----------|----------|--------|
| **Identity** | Org-as-person, address-as-person, first-name-only | AUTO_FIX or QUARANTINE |
| **Relationship** | Cat-place pollution, staff home pollution, orphans | ALERT |
| **Volume** | Duplicate bursts, spike anomalies, missing fields | ALERT |
| **Quality** | Confidence drift, source conflicts, stale data | ALERT |

**Implementation:** `atlas.pattern_definitions` + `audit.pattern_alerts` tables with detection functions that run after each ingest batch and periodically on all data.

See `DATA_PATTERN_DETECTION.md` for full pattern catalog and implementation.

### Source System Drawbacks Registry

From original architecture diagram - known issues per source:

| Source | Key Drawbacks | Handling |
|--------|---------------|----------|
| **ClinicHQ** | Messy owner info, orgs as people, microchips in name field | `classify_owner_name()`, `extract_microchip_from_animal_name()` |
| **Airtable** | Old connections, workflow changes, messy public submissions | Source-dependent validation, quarantine first-name-only |
| **ShelterLuv** | Partial data, medical hold names, their own system | Allow with flag, parse "(dental)" suffixes |
| **VolunteerHub** | Manual + public signup mix, missing data | Allow first-name-only (verified volunteers) |
| **PetLink** | Fabricated emails by staff | `classify_petlink_email()`, low confidence |
| **Web Intake** | Public free-text submissions | Quarantine if fails validation |

**Implementation:** `reference.source_drawbacks` table documents known issues and links to detection patterns.

### Reprocessable Transformations (Data Cleaning Registry)

**KEY PRINCIPLE:** All data cleaning logic must be captured in reusable functions that can recreate cleaned data from source.

```
source.* (raw) → [Transformation Registry] → ops.*/sot.* (clean)
```

| Transformation | Function | Can Rerun? |
|----------------|----------|------------|
| Name classification | `classify_owner_name()` | Yes - deterministic |
| Person gating | `should_be_person()` | Yes - deterministic |
| Phone normalization | `norm_phone_us()` | Yes - deterministic |
| Email normalization | `norm_email()` | Yes - deterministic |
| Microchip extraction | `extract_microchip_from_animal_name()` | Yes - deterministic |
| PetLink email classification | `classify_petlink_email()` | Yes - deterministic |
| Identity scoring | `data_engine_score_candidates()` | Yes - uses soft_blacklist |
| Deduplication | `find_or_create_person()` | Yes - idempotent |
| Place deduplication | `find_or_create_place_deduped()` | Yes - idempotent |
| Cat deduplication | `find_or_create_cat_by_microchip()` | Yes - idempotent |
| Cat-place linking | `link_cats_to_appointment_places()` | Yes - idempotent |
| Person-cat linking | `link_person_to_cat()` | Yes - uses ON CONFLICT |

**All transformations are idempotent and can be re-run from source data.**

---

## Part 1: Current State Analysis

### 1.1 Table Inventory Summary

| Category | Count | Examples |
|----------|-------|----------|
| Core SOT (Canonical) | 9 | `sot_people`, `sot_cats`, `places`, `sot_requests`, `sot_appointments` |
| Relationship/Linking | 6+ | `person_cat_relationships`, `cat_place_relationships`, `person_place_relationships` |
| Source/Raw | 15+ | `staged_records`, `clinichq_visits`, `volunteerhub_volunteers`, `raw_airtable_*` |
| Operational | 30+ | `web_intake_submissions`, `request_status_history`, `clinic_days` |
| Analytics/Beacon | 25+ | `place_colony_estimates`, `cat_mortality_events`, `colonies`, `observations` |
| Identity Resolution | 15+ | `person_identifiers`, `data_engine_soft_blacklist`, `households` |
| Data Quality/Audit | 15+ | `entity_edits`, `data_quality_alerts`, `corrections` |
| Configuration/Reference | 20+ | `source_systems`, `place_context_types`, `disease_types` |
| Legacy/Remnant | 40+ | Various unused or transitioning tables |

### 1.2 Current Data Flow

```
Sources (ClinicHQ, ShelterLuv, Airtable, Web Intake, PetLink, VolunteerHub)
                            ↓
              [Ingest Scripts / API Routes]
                            ↓
              staged_records / raw_* tables
                            ↓
              [Data Engine - Identity Resolution]
              - should_be_person() gate
              - data_engine_resolve_identity()
              - find_or_create_* functions
                            ↓
              sot_* tables + relationships
                            ↓
              [Entity Linking Pipeline]
              - link_cats_to_appointment_places()
              - link_cats_to_places()
                            ↓
              [Beacon / Analytics Layer]
              Views + place_colony_estimates
```

### 1.3 Known Pain Points

1. **Table Sprawl:** ~280 tables with unclear organization
2. **Legacy Data Quality:** Pre-2024 data violates current rules (org emails as people, location names as people)
3. **Inconsistent Naming:** Mix of `sot_*`, `raw_*`, unnprefixed tables
4. **Unclear Boundaries:** Some tables serve multiple purposes
5. **Remnant Tables:** 40+ tables from previous iterations still exist
6. **Schema Confusion:** Everything in `trapper` schema (historical naming)

### 1.4 Critical Invariants to Preserve

| ID | Invariant | Risk if Broken |
|----|-----------|----------------|
| INV-2 | Manual > AI (verified data protected) | Staff corrections overwritten |
| INV-3 | Entity IDs are stable handles | Broken references across UI |
| INV-4 | Provenance required on all records | Lost audit trail |
| INV-8 | Merge-aware queries (`merged_into_* IS NULL`) | Returns merged duplicates |
| INV-10 | Relationship writes via gatekeepers only | Pollution, no audit trail |
| INV-17 | Org emails don't create people | 2,400+ bad person records |
| INV-18 | Location names don't create people | Address-as-person records |

---

## Part 2: Target Architecture

### 2.1 Three-Layer Bucket System

Following the **Modified Medallion Architecture** pattern:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: SOURCE (Bronze)                                                   │
│  Schema: source.*                                                           │
│                                                                             │
│  Purpose: Raw ingested data, append-only, full provenance                   │
│  Value: Lowest processed, highest raw information                           │
│  Consumers: Data atlasers, reprocessing pipelines                          │
│                                                                             │
│  Tables:                                                                    │
│  ├── source.ingest_batches (batch metadata)                                │
│  ├── source.clinichq_records (raw ClinicHQ)                                │
│  ├── source.shelterluv_records (raw ShelterLuv)                            │
│  ├── source.volunteerhub_records (raw VolunteerHub)                        │
│  ├── source.airtable_records (raw Airtable)                                │
│  ├── source.petlink_records (raw PetLink)                                  │
│  └── source.web_intake_records (raw web submissions)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
                    [DATA ENGINE - Identity Resolution]
                    [Validation, Classification, Deduplication]
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: ORGANIZED (Silver)                                                │
│  Schema: ops.*                                                              │
│                                                                             │
│  Purpose: Structured operational data, domain-specific organization         │
│  Value: High accessibility, clear domain boundaries                         │
│  Consumers: Applications, staff workflows, reports                          │
│                                                                             │
│  Domains:                                                                   │
│  ├── ops.clinic_* (clinic operations)                                      │
│  │   ├── clinic_days, clinic_appointments, clinic_accounts                 │
│  │   └── clinic_procedures, clinic_vitals                                  │
│  ├── ops.intake_* (intake processing)                                      │
│  │   ├── intake_submissions, intake_triaging                               │
│  │   └── intake_responses                                                  │
│  ├── ops.request_* (request management)                                    │
│  │   ├── requests, request_assignments, request_history                    │
│  │   └── request_media, request_notes                                      │
│  ├── ops.volunteer_* (volunteer management)                                │
│  │   ├── volunteers, volunteer_groups, volunteer_assignments               │
│  │   └── volunteer_hours, volunteer_training                               │
│  ├── ops.trapper_* (trapper operations)                                    │
│  │   ├── trappers, trapper_assignments, trapper_reports                    │
│  │   └── trapper_sites                                                     │
│  └── ops.org_* (external organizations)                                    │
│      ├── organizations, org_contacts, org_partnerships                     │
│      └── org_transfers                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
                    [ENTITY LINKING - Relationship Processing]
                    [Cat-Place, Person-Cat, Person-Place Linking]
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: CANONICAL (Gold)                                                  │
│  Schema: sot.*                                                              │
│                                                                             │
│  Purpose: Single Source of Truth for real-world entities                    │
│  Value: Highest trust, stable references, deduped                           │
│  Consumers: All applications, Beacon, analytics                             │
│                                                                             │
│  Core Entities:                                                             │
│  ├── sot.people (canonical person records)                                 │
│  ├── sot.cats (canonical cat records)                                      │
│  ├── sot.places (canonical place records)                                  │
│  └── sot.addresses (canonical address registry)                            │
│                                                                             │
│  Identity & Relationships:                                                  │
│  ├── sot.person_identifiers (email, phone, external IDs)                   │
│  ├── sot.cat_identifiers (microchips, external IDs)                        │
│  ├── sot.person_cat_relationships                                          │
│  ├── sot.cat_place_relationships                                           │
│  ├── sot.person_place_relationships                                        │
│  └── sot.households                                                        │
│                                                                             │
│  Audit & History:                                                           │
│  ├── sot.entity_edits (change audit trail)                                 │
│  └── sot.merge_history (merge audit trail)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
                    [VIEWS - Read-Only Presentation]
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3b: ANALYTICS (Gold - Derived)                                       │
│  Schema: beacon.*                                                           │
│                                                                             │
│  Purpose: Ecological data, colony estimates, Beacon visualization           │
│  Value: Scientific calculations, population models                          │
│                                                                             │
│  Tables:                                                                    │
│  ├── beacon.colony_estimates                                               │
│  ├── beacon.population_models                                              │
│  ├── beacon.disease_tracking                                               │
│  ├── beacon.mortality_events                                               │
│  ├── beacon.birth_events                                                   │
│  └── beacon.observations                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Schema Organization

```sql
-- Layer 1: Source/Raw
CREATE SCHEMA source;     -- Raw ingested data (Bronze)

-- Layer 2: Organized/Operational
CREATE SCHEMA ops;        -- Structured operational data (Silver)

-- Layer 3: Canonical SOT
CREATE SCHEMA sot;        -- Source of Truth entities (Gold)

-- Layer 3b: Analytics (isolated until data quality stabilized)
CREATE SCHEMA beacon;     -- Ecological/analytics data (Gold-derived, views only for now)

-- Supporting
CREATE SCHEMA atlas;      -- Core functions (renamed from 'trapper')
CREATE SCHEMA quarantine; -- Records that fail validation (with UI)
CREATE SCHEMA reference;  -- Configuration & lookup tables
CREATE SCHEMA audit;      -- Audit logs & history
CREATE SCHEMA archive;    -- Legacy tables before final drop
```

### 2.3 Source-Dependent Validation Rules

**First-name-only records are handled differently per source:**

| Source System | Has First-Name-Only? | Handling | Rationale |
|---------------|---------------------|----------|-----------|
| **ShelterLuv** | Likely (adopters) | Allow with `data_quality='incomplete'` | Real people with outcome events; valuable data |
| **VolunteerHub** | Possible | Allow with `data_quality='incomplete'` | Verified volunteers who signed up |
| **ClinicHQ** | Rare/None | Route to `ops.clinic_accounts` | Pseudo-profiles, not verified people |
| **Airtable** | Yes (legacy) | Quarantine unless salvageable | Only migrate if linked to valuable data |
| **Web Intake** | Shouldn't happen | Quarantine for review | Form should require full name |
| **PetLink** | Possible | Allow with flag + low confidence | Registry data, often incomplete |

**Salvageability criteria for Airtable first-name-only:**
- Has email OR phone identifier
- Has linked cat relationships with outcomes
- Has linked place with colony data
- Can be matched to existing complete record

### 2.3 Layer Boundaries & Processing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROCESSING BOUNDARIES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SOURCE → OPS Boundary (Ingest Processing)                                  │
│  ├── Validation: Schema conformance, required fields                        │
│  ├── Classification: should_be_person(), classify_owner_name()              │
│  ├── Routing: Real people vs clinic_accounts, quarantine vs proceed         │
│  └── Linking: Source record to ingest batch                                 │
│                                                                             │
│  OPS → SOT Boundary (Identity Resolution)                                   │
│  ├── Data Engine: data_engine_resolve_identity()                            │
│  ├── Deduplication: find_or_create_* functions                              │
│  ├── Confidence Scoring: Match decisions, review queue                      │
│  └── Merge-Awareness: Check merged_into_* chains                            │
│                                                                             │
│  SOT → BEACON Boundary (Entity Linking & Analytics)                         │
│  ├── Relationship Building: link_cat_to_place(), link_person_to_cat()       │
│  ├── Colony Estimation: Chapman mark-recapture calculations                 │
│  ├── Population Models: Birth/death/movement tracking                       │
│  └── Ecological Inference: AI-parsed data labeled as such                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Table Migration Mapping

### 3.1 Current → Target Table Mapping

#### Layer 1: SOURCE (source.*)

| Current Table | Target Table | Notes |
|---------------|--------------|-------|
| `staged_records` | `source.staged_records` | Keep as-is, add schema prefix |
| `clinichq_visits` | `source.clinichq_records` | Rename for consistency |
| `clinichq_upcoming_appointments` | `source.clinichq_upcoming` | |
| `volunteerhub_volunteers` | `source.volunteerhub_records` | |
| `volunteerhub_user_groups` | `source.volunteerhub_groups` | |
| `volunteerhub_group_memberships` | `source.volunteerhub_memberships` | |
| `raw_airtable_people` | `source.airtable_people` | |
| `raw_airtable_media` | `source.airtable_media` | |
| `shelterluv_sync_state` | `source.shelterluv_sync` | |
| `ingest_runs` | `source.ingest_batches` | Rename |
| `ingest_run_records` | `source.ingest_batch_records` | |
| `extraction_queue` | `source.extraction_queue` | |

#### Layer 2: OPS (ops.*)

| Current Table | Target Table | Notes |
|---------------|--------------|-------|
| `sot_appointments` | `ops.clinic_appointments` | Move to ops (operational) |
| `clinic_days` | `ops.clinic_days` | |
| `clinic_day_entries` | `ops.clinic_day_entries` | |
| `clinic_owner_accounts` | `ops.clinic_accounts` | Pseudo-profiles (not people) |
| `web_intake_submissions` | `ops.intake_submissions` | |
| `intake_questions` | `ops.intake_questions` | |
| `intake_question_options` | `ops.intake_options` | |
| `intake_custom_fields` | `ops.intake_fields` | |
| `intake_custom_responses` | `ops.intake_responses` | |
| `sot_requests` | `ops.requests` | Requests are operational |
| `request_status_history` | `ops.request_history` | |
| `request_trapper_assignments` | `ops.request_assignments` | |
| `request_cat_links` | `ops.request_cat_links` | |
| `request_media` | `ops.request_media` | |
| `staff` | `ops.staff` | |
| `staff_roles` | `ops.staff_roles` | |
| `trapper_*` (6 tables) | `ops.trapper_*` | Keep as-is with schema |
| `orgs` | `ops.organizations` | |
| `organization_*` | `ops.org_*` | Consolidate naming |

#### Layer 3: SOT (sot.*)

| Current Table | Target Table | Notes |
|---------------|--------------|-------|
| `sot_people` | `sot.people` | |
| `sot_cats` | `sot.cats` | |
| `places` | `sot.places` | |
| `sot_addresses` | `sot.addresses` | |
| `person_identifiers` | `sot.person_identifiers` | |
| `cat_identifiers` | `sot.cat_identifiers` | |
| `person_cat_relationships` | `sot.person_cat` | Shorter name |
| `cat_place_relationships` | `sot.cat_place` | |
| `person_place_relationships` | `sot.person_place` | |
| `person_relationships` | `sot.person_person` | Household/family |
| `households` | `sot.households` | |
| `household_members` | `sot.household_members` | |
| `person_aliases` | `sot.person_aliases` | |
| `entity_edits` | `audit.entity_edits` | Move to audit schema |
| `entity_merge_history` | `audit.merge_history` | |

#### Layer 3b: BEACON (beacon.*)

| Current Table | Target Table | Notes |
|---------------|--------------|-------|
| `place_colony_estimates` | `beacon.colony_estimates` | |
| `place_colony_timeline` | `beacon.colony_timeline` | |
| `colonies` | `beacon.colonies` | |
| `colony_*` (7 tables) | `beacon.colony_*` | |
| `cat_birth_events` | `beacon.birth_events` | |
| `cat_mortality_events` | `beacon.mortality_events` | |
| `cat_intake_events` | `beacon.intake_events` | |
| `cat_movement_events` | `beacon.movement_events` | |
| `cat_medical_events` | `beacon.medical_events` | |
| `observations` | `beacon.observations` | |
| `site_observations` | `beacon.site_observations` | |
| `observation_zones` | `beacon.zones` | |
| `place_disease_status` | `beacon.disease_status` | |

#### Supporting Schemas

| Current | Target | Notes |
|---------|--------|-------|
| `data_engine_*` | `atlas.*` | All Data Engine tables |
| `data_quality_*` | `audit.*` | Quality tracking |
| `corrections` | `audit.corrections` | |
| `pending_edits` | `audit.pending_edits` | |
| `blocked_identifiers` | `atlas.blocked_identifiers` | |
| `place_context_types` | `reference.place_context_types` | |
| `disease_types` | `reference.disease_types` | |
| `relationship_types` | `reference.relationship_types` | |
| `source_systems` | `reference.source_systems` | |
| Various lookups | `reference.*` | |

### 3.2 Tables to Archive/Remove

| Table | Status | Reason |
|-------|--------|--------|
| `organizations` (old) | Archive | Replaced by `orgs` (MIG_961) |
| `external_organization_imports` | Archive | Legacy import tracking |
| `external_org_import_rows` | Archive | Legacy |
| `external_org_field_mappings` | Archive | Legacy |
| `google_map_entries` | Archive | One-time import, keep for reference |
| `google_entry_link_audit` | Archive | Import audit |
| `staged_google_maps_imports` | Archive | Completed |
| `appointment_requests` | Archive | Legacy JotForm, replaced by web_intake |
| `raw_intake_*` (4 tables) | Archive | Superseded by staged_records |

---

## Part 4: Migration Strategy

### 4.1 Shadow Database Pattern (Blue-Green)

**Why Shadow DB?**
- Zero downtime during transition
- Can validate new system before cutover
- Rollback capability if issues found
- Allows cleaning legacy data without affecting production

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MIGRATION PHASES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1: Build Shadow Structure (2-3 weeks)                                │
│  ├── Create new schemas (source, ops, sot, beacon, etc.)                   │
│  ├── Create new tables with updated constraints                            │
│  ├── Build migration functions                                              │
│  └── Set up replication triggers from old → new                            │
│                                                                             │
│  PHASE 2: Historical Data Migration (2-3 weeks)                             │
│  ├── Migrate SOURCE layer (all raw data)                                   │
│  ├── Reprocess through Data Engine with NEW rules                          │
│  ├── Quarantine legacy violations (don't auto-migrate bad data)            │
│  ├── Build new relationships using current pipeline                        │
│  └── Validate counts match                                                  │
│                                                                             │
│  PHASE 3: Dual-Write Period (1-2 weeks)                                     │
│  ├── Enable real-time sync (old tables → new tables)                       │
│  ├── Run both systems in parallel                                          │
│  ├── Compare outputs, validate consistency                                 │
│  └── Fix any drift issues                                                   │
│                                                                             │
│  PHASE 4: UI Migration (2-3 weeks)                                          │
│  ├── Update API routes to read from new schemas                            │
│  ├── Test each workflow (intake, requests, map, etc.)                      │
│  ├── Gradual rollout by feature                                            │
│  └── Monitor for regressions                                                │
│                                                                             │
│  PHASE 5: Cutover (1 week)                                                  │
│  ├── Switch writes to new system                                           │
│  ├── Keep old system read-only for rollback                                │
│  ├── Monitor intensively                                                   │
│  └── Remove old tables after validation period                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Dual-Write Replication

During migration, maintain real-time sync between old and new:

```sql
-- Example: Trigger on old table to write to new
CREATE OR REPLACE FUNCTION sync_sot_people_to_new()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO sot.people (
            id, first_name, last_name, display_name, email, phone,
            primary_address_id, source_system, source_record_id,
            created_at, updated_at, merged_into_person_id
        ) VALUES (
            NEW.id, NEW.first_name, NEW.last_name, NEW.display_name,
            NEW.email, NEW.phone, NEW.primary_address_id,
            NEW.source_system, NEW.source_record_id,
            NEW.created_at, NEW.updated_at, NEW.merged_into_person_id
        );
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE sot.people SET
            first_name = NEW.first_name,
            last_name = NEW.last_name,
            -- ... other fields
            updated_at = NEW.updated_at,
            merged_into_person_id = NEW.merged_into_person_id
        WHERE id = NEW.id;
    -- Note: We never DELETE, only merge
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 4.3 Legacy Data Handling

**Critical:** Don't carry over legacy violations. Reprocess ALL data through the Data Engine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LEGACY DATA CLASSIFICATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Category A: Clean Data (migrate directly)                                  │
│  ├── Records created after 2026-01-25 (post-Data Engine consolidation)     │
│  ├── Records with valid email/phone identifiers                            │
│  └── Records passing should_be_person() validation                         │
│                                                                             │
│  Category B: Reprocessable (re-run through Data Engine)                     │
│  ├── Records with source data still available                              │
│  ├── Records where source.* contains original payload                      │
│  └── Can be re-deduplicated, re-linked properly                            │
│                                                                             │
│  Category C: Quarantine (requires staff review)                             │
│  ├── Organizations-as-people (213 records)                                 │
│  ├── Addresses-as-people (100+ records)                                    │
│  ├── First-name-only records (590 records)                                 │
│  ├── People without identifiers (999 records)                              │
│  └── Person-cat links via org emails (2,400+ relationships)                │
│                                                                             │
│  Category D: Preserve-as-Historical (don't process, archive)               │
│  ├── Pre-2024 data with known quality issues                               │
│  ├── Relationships that can't be validated                                 │
│  └── Mark with historical_data = TRUE flag                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Quarantine Pattern Implementation

```sql
-- Quarantine schema for records that fail validation
CREATE SCHEMA quarantine;

CREATE TABLE quarantine.failed_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_schema TEXT NOT NULL,  -- 'source', 'ops', etc.
    source_table TEXT NOT NULL,
    source_record_id UUID,
    original_payload JSONB NOT NULL,
    failure_reason TEXT NOT NULL,
    failure_details JSONB,
    classification TEXT,  -- 'org_as_person', 'address_as_person', etc.
    quarantined_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    resolution TEXT,  -- 'merged', 'deleted', 'corrected', 'kept_as_historical'
    resolution_notes TEXT
);

CREATE INDEX idx_quarantine_classification ON quarantine.failed_records(classification);
CREATE INDEX idx_quarantine_unreviewed ON quarantine.failed_records(reviewed_at) WHERE reviewed_at IS NULL;
```

---

## Part 5: Critical Workflows to Preserve

### 5.1 Intake → Request Flow

**Current Flow:**
```
web_intake_submissions → sot_requests → request_trapper_assignments
```

**New Flow:**
```
source.web_intake_records
    → ops.intake_submissions
    → ops.requests
    → ops.request_assignments
```

**Migration Steps:**
1. Create `ops.intake_submissions` with same structure
2. Create trigger to sync `web_intake_submissions` → `ops.intake_submissions`
3. Update API route `/api/intake/submit` to write to `ops.intake_submissions`
4. Update request creation to read from `ops.intake_submissions`

### 5.2 Atlas Map Flow

**Current Flow:**
```
v_map_atlas_pins → combines places, people, cats, requests, observations
```

**New Flow:**
```
beacon.v_map_pins → combines sot.places, ops.requests, beacon.observations
```

**Migration Steps:**
1. Create `beacon.v_map_pins` view reading from new schemas
2. Ensure all required data is in new schemas before cutover
3. Update map component to use new view
4. Test all pin types render correctly

### 5.3 ClinicHQ Upload Flow

**Current Flow:**
```
Upload → staged_records → process_clinichq_* → sot_* tables
```

**New Flow:**
```
Upload
    → source.ingest_batches + source.staged_records
    → atlas.process_clinichq_*
    → ops.clinic_appointments + sot.* entities
```

**Migration Steps:**
1. Update upload route to write to `source.*`
2. Update processors to read from `source.*`, write to `ops.*` and `sot.*`
3. Maintain backward compatibility during dual-write period

---

## Part 6: Function Migration

### 6.1 Centralized Functions to Update

| Function | Current Schema | New Schema | Changes Needed |
|----------|---------------|------------|----------------|
| `find_or_create_person()` | `trapper` | `atlas` | Update table references |
| `find_or_create_place_deduped()` | `trapper` | `atlas` | Update table references |
| `find_or_create_cat_by_microchip()` | `trapper` | `atlas` | Update table references |
| `find_or_create_request()` | `trapper` | `atlas` | Update table references |
| `data_engine_resolve_identity()` | `trapper` | `atlas` | Update table references |
| `should_be_person()` | `trapper` | `atlas` | No changes |
| `classify_owner_name()` | `trapper` | `atlas` | No changes |
| `link_cat_to_place()` | `trapper` | `atlas` | Update table references |
| `link_person_to_cat()` | `trapper` | `atlas` | Update table references |
| `process_clinichq_*` | `trapper` | `atlas` | Update table references |

### 6.2 Backward Compatibility

During transition, maintain `trapper` schema functions as wrappers:

```sql
-- Compatibility wrapper in old schema
CREATE OR REPLACE FUNCTION trapper.find_or_create_person(...)
RETURNS UUID AS $$
BEGIN
    RETURN atlas.find_or_create_person(...);
END;
$$ LANGUAGE plpgsql;
```

---

## Part 7: Risk Mitigation

### 7.1 Critical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | Critical | Full backup before each phase; validate counts |
| Broken active workflows | Medium | Critical | Dual-write period; feature flags; gradual rollout |
| Performance degradation | Medium | High | Test with production data volume; optimize views |
| Legacy violations propagate | Medium | High | Quarantine pattern; explicit validation |
| Staff confusion during transition | Medium | Medium | Clear communication; training |

### 7.2 Rollback Plan

At each phase, maintain ability to rollback:

1. **Phase 1-2:** No production impact; can simply drop new schemas
2. **Phase 3:** Disable dual-write triggers; continue on old system
3. **Phase 4:** Feature flags to switch API routes back to old tables
4. **Phase 5:** Keep old tables read-only for 30 days before archiving

### 7.3 Validation Checkpoints

Before proceeding to each phase, validate:

```sql
-- Record count validation
SELECT
    'sot_people' as entity,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as old_count,
    (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) as new_count;

-- Relationship count validation
SELECT
    'person_cat' as relationship,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships) as old_count,
    (SELECT COUNT(*) FROM sot.person_cat) as new_count;

-- Data integrity validation
SELECT *
FROM sot.people p
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.sot_people old
    WHERE old.id = p.id
);
```

---

## Part 7b: Physical Codebase Structure

### Why No Separate Repo?

The 3-layer architecture uses **PostgreSQL schemas** for isolation, not separate codebases:

```
Same Database, Different Schemas:
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL Database                                        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  trapper.*  │  │  source.*   │  │   sot.*     │         │
│  │   (OLD)     │  │   (NEW)     │  │   (NEW)     │         │
│  │             │  │             │  │             │         │
│  │ sot_people  │  │ staged_     │  │  people     │         │
│  │ sot_cats    │  │ records     │  │  cats       │         │
│  │ places      │  │ clinichq_   │  │  places     │         │
│  │   ...       │  │ records     │  │   ...       │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│        ↑                                  ↑                 │
│        │         DUAL-WRITE TRIGGERS      │                 │
│        └──────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- No repo duplication
- Shared utilities, types, deployment
- Gradual migration via feature flags
- Rollback = disable triggers, revert feature flags

### Codebase Organization

```
/Atlas (same repo, no changes to structure)
├── apps/web/                    # Next.js app (unchanged)
│   ├── app/api/                # API routes
│   │   └── v2/                 # NEW: V2 API routes (optional, or feature flags)
│   └── lib/
│       └── db/
│           ├── schemas.ts      # NEW: Schema constants
│           └── queries/        # Queries can check SCHEMA_VERSION
│
├── scripts/
│   ├── ingest/                 # KEEP: Existing ingest (still works)
│   ├── jobs/                   # KEEP: Existing jobs (still works)
│   ├── pipeline/               # KEEP: Existing pipeline
│   │   ├── run_full_reprocess.sh
│   │   └── ...
│   └── migration/              # NEW: V2 migration scripts
│       ├── phase1_create_schemas.sh
│       ├── phase2_migrate_sot.sh
│       ├── phase3_migrate_ops.sh
│       ├── phase4_migrate_source.sh
│       ├── phase5_cutover.sh
│       └── validate_migration.sh
│
├── sql/
│   └── schema/
│       └── sot/                # KEEP: Existing migrations
│           ├── MIG_001__*.sql  # ... through MIG_999
│           ├── MIG_1000__create_v2_schemas.sql      # NEW: V2 starts at 1000
│           ├── MIG_1001__source_tables.sql
│           ├── MIG_1002__sot_tables.sql
│           ├── MIG_1003__ops_tables.sql
│           ├── MIG_1004__atlas_functions.sql
│           ├── MIG_1005__dual_write_triggers.sql
│           ├── MIG_1006__migrate_data.sql
│           └── ...
│
├── docs/
│   ├── CLAUDE.md               # UPDATE: Add V2 schema references
│   ├── ATLAS_NORTH_STAR.md     # KEEP: Original (reference)
│   ├── ATLAS_NORTH_STAR_V2.md  # NEW: V2 ledger
│   ├── ARCHITECTURE_OVERHAUL_PLAN.md  # NEW: This document
│   └── DATA_CLEANING_REGISTRY.md      # NEW: Transformation catalog
│
└── .env                        # ADD: SCHEMA_VERSION=v1 or v2
```

### Feature Flag Strategy

Instead of branching code, use a schema version flag:

```typescript
// lib/db/schemas.ts
export const SCHEMA_VERSION = process.env.SCHEMA_VERSION || 'v1';

export const schemas = {
  v1: {
    people: 'trapper.sot_people',
    cats: 'trapper.sot_cats',
    places: 'trapper.places',
    requests: 'trapper.sot_requests',
  },
  v2: {
    people: 'sot.people',
    cats: 'sot.cats',
    places: 'sot.places',
    requests: 'ops.requests',
  },
};

export const tables = schemas[SCHEMA_VERSION];
```

```typescript
// Usage in queries
import { tables } from '@/lib/db/schemas';

const people = await db.query(`
  SELECT * FROM ${tables.people}
  WHERE merged_into_person_id IS NULL
`);
```

### Migration Naming Convention

Continue existing MIG_* pattern, but start V2 at **MIG_1000**:

| Range | Purpose |
|-------|---------|
| MIG_001 - MIG_999 | Existing migrations (keep all) |
| MIG_1000 - MIG_1099 | V2 schema creation |
| MIG_1100 - MIG_1199 | V2 data migration |
| MIG_1200 - MIG_1299 | V2 function migration |
| MIG_1300 - MIG_1399 | V2 view migration |
| MIG_1400+ | Post-migration cleanup |

### What Stays, What's New

| Item | Action | Location |
|------|--------|----------|
| Existing API routes | KEEP (add feature flag) | `apps/web/app/api/` |
| Existing migrations | KEEP (never delete) | `sql/schema/sot/MIG_001-999` |
| Existing scripts | KEEP (still work on v1) | `scripts/ingest/`, `scripts/jobs/` |
| New schemas | ADD | `sql/schema/sot/MIG_1000+` |
| Migration scripts | ADD | `scripts/migration/` |
| V2 documentation | ADD | `docs/*_V2.md` |

### Avoiding Bloat

**During migration (Weeks 1-10):**
- Old and new schemas coexist (necessary for dual-write)
- Old code paths remain (necessary for rollback)
- Both are actively used

**After migration (Week 11+):**
1. Remove feature flags (hardcode v2)
2. Remove dual-write triggers
3. Archive old tables to `archive.*` schema
4. Backup archive schema externally
5. DROP archive schema
6. Remove v1 code paths (dead code elimination)
7. Simplify `schemas.ts` to only have v2

**Result:** Clean codebase with only v2, no bloat, but full history in git.

### Rollback Safety

At any point during migration:

```bash
# Emergency rollback
export SCHEMA_VERSION=v1  # Feature flag
psql -c "DROP TRIGGER IF EXISTS sync_* ON trapper.*"  # Stop dual-write
# App now uses old schema, new schema ignored but preserved
```

---

## Part 8: Implementation Order (Aggressive 8-10 Week Timeline)

```
Week 1-2: Foundation + Schema Creation
Week 3-4: SOT Layer Migration (canonical entities)
Week 5-6: OPS Layer Migration + Quarantine UI
Week 7-8: Source Layer + Pipeline Updates
Week 9-10: UI Cutover + Cleanup
```

### Phase 1: Foundation (Week 1-2)

**Objective:** Create new schema structure and quarantine infrastructure

**Week 1:**
1. Create all new schemas:
   ```sql
   CREATE SCHEMA source;     -- Raw data
   CREATE SCHEMA ops;        -- Operational
   CREATE SCHEMA sot;        -- Canonical
   CREATE SCHEMA beacon;     -- Analytics (views only for now)
   CREATE SCHEMA atlas;      -- Core functions (replaces trapper)
   CREATE SCHEMA quarantine; -- Failed validation
   CREATE SCHEMA reference;  -- Config/lookups
   CREATE SCHEMA audit;      -- Audit trails
   CREATE SCHEMA archive;    -- Legacy tables before drop
   ```

2. Create quarantine infrastructure:
   - `quarantine.failed_records` table
   - `quarantine.pending_review` view
   - Classification taxonomy (org_as_person, address_as_person, firstname_only, etc.)

3. Create validation functions:
   - Record count validators
   - Relationship integrity checkers
   - Merge chain validators

**Week 2:**
4. Create Layer 3 (SOT) table structures (empty, mirroring current)
5. Create Layer 2 (OPS) table structures
6. Create Layer 1 (SOURCE) table structures
7. Build migration scripts (data movement functions)

**Deliverable:** Empty schema structure ready for data migration

### Phase 2: SOT Layer Migration (Week 3-4)

**Objective:** Migrate canonical entities first (they're the stable references all else depends on)

**Week 3:**
1. Migrate `trapper.sot_people` → `sot.people`:
   - Run through source-dependent validation
   - Quarantine first-name-only from ClinicHQ/Airtable
   - Allow ShelterLuv/VolunteerHub first-name-only with flag
   - Set `data_quality` column appropriately
2. Migrate `trapper.sot_cats` → `sot.cats`
3. Migrate `trapper.places` → `sot.places`
4. Migrate `trapper.sot_addresses` → `sot.addresses`

**Week 4:**
5. Migrate identifier tables:
   - `person_identifiers` → `sot.person_identifiers`
   - `cat_identifiers` → `sot.cat_identifiers`
6. Migrate relationship tables:
   - `person_cat_relationships` → `sot.person_cat`
   - `cat_place_relationships` → `sot.cat_place`
   - `person_place_relationships` → `sot.person_place`
7. Set up dual-write triggers (old → new)
8. **Validation checkpoint:** All entity counts match ±0

**Deliverable:** SOT layer fully migrated with dual-write active

### Phase 3: OPS Layer + Quarantine UI (Week 5-6)

**Objective:** Migrate operational data and build quarantine review UI

**Week 5:**
1. Migrate request tables:
   - `sot_requests` → `ops.requests`
   - `request_status_history` → `ops.request_history`
   - `request_trapper_assignments` → `ops.request_assignments`
2. Migrate intake tables:
   - `web_intake_submissions` → `ops.intake_submissions`
   - `intake_*` tables → `ops.intake_*`
3. Migrate clinic tables:
   - `sot_appointments` → `ops.clinic_appointments`
   - `clinic_*` tables → `ops.clinic_*`
   - `clinic_owner_accounts` → `ops.clinic_accounts`

**Week 6:**
4. Migrate volunteer/trapper tables → `ops.*`
5. Migrate organization tables → `ops.*`
6. **Build Quarantine Review UI:**
   - List view of quarantined records by classification
   - Detail view with original payload + failure reason
   - Actions: merge into existing, correct & approve, mark as historical
   - Bulk operations for common patterns
7. Set up dual-write triggers for ops tables
8. **Validation checkpoint:** All operational data accessible via new schema

**Deliverable:** OPS layer migrated, Quarantine UI functional

### Phase 4: Source Layer + Pipeline Updates (Week 7-8)

**Objective:** Migrate source data and update all processing pipelines

**Week 7:**
1. Migrate raw/staged data to `source.*`:
   - `staged_records` → `source.staged_records`
   - `ingest_runs` → `source.ingest_batches`
   - Source-system-specific tables
2. Migrate reference/config tables to `reference.*`
3. Migrate audit tables to `audit.*`

**Week 8:**
4. Update `atlas.*` functions (rename from `trapper.*`):
   - `find_or_create_person()` → read/write new schemas
   - `find_or_create_place_deduped()` → read/write new schemas
   - `find_or_create_cat_by_microchip()` → read/write new schemas
   - All `process_*` functions updated
   - All `link_*` functions updated
5. Create backward-compatible wrappers in `trapper` schema
6. Update entity linking pipeline to use new schemas
7. **Validation checkpoint:** Full pipeline works end-to-end with new schemas

**Deliverable:** All data migrated, pipeline updated, backward compatibility maintained

### Phase 5: UI Cutover + Cleanup (Week 9-10)

**Objective:** Switch application to new schemas and clean up

**Week 9:**
1. Update API routes (one domain at a time):
   - `/api/people/*` → read from `sot.*`
   - `/api/cats/*` → read from `sot.*`
   - `/api/places/*` → read from `sot.*`
   - `/api/requests/*` → read from `ops.*`
   - `/api/intake/*` → read from `ops.*`
2. Update views to use new schemas
3. Test each workflow thoroughly:
   - Web intake → request creation ✓
   - ClinicHQ upload → processing ✓
   - Atlas map rendering ✓
   - Person/cat/place detail pages ✓

**Week 10:**
4. Disable dual-write triggers
5. Move legacy tables to `archive.*` schema
6. **Backup archive schema to external storage**
7. DROP archived tables (after backup verified)
8. Update all documentation (CLAUDE.md, etc.)
9. **Final validation:** All systems operational

**Deliverable:** Migration complete, legacy cleaned up

---

## Part 8b: Repo Cleanup Strategy

### Pre-Migration Cleanup (Do Before Phase 1)

**Immediate savings: ~1.3 GB → ~50 MB**

| Item | Size | Action |
|------|------|--------|
| `.next/` build cache | 920 MB | Delete (regenerates on build) |
| `node_modules/` | 407 MB | Delete (regenerates on `npm install`) |
| `.DS_Store` files | 50 KB | Delete, add to `.gitignore` |
| `.env` with secrets | 3 KB | Move to `.gitignore`, use `.env.example` |

### Files to Archive (Not Delete)

**Historical docs (~700 KB) → `/archive/docs/`:**
- `TASK_LEDGER.md`, `TODO.md`, `DECISIONS.md`
- `ARCHITECTURE_DIAGRAMS.md`, `INTEGRATION_PLAN.md`
- `DATA_ENGINE_AUDIT_REPORT.md`, `DATA_QUALITY_ANALYSIS.md`
- Various dated audit reports

**Legacy scripts → `/archive/scripts/`:**
- 16 acceptance test scripts (`acceptance_test_atlas_*.sh`)
- One-off ingest scripts (explore, analyze, legacy imports)
- Experimental job scripts (classify, paraphrase, research)

### Documentation to Update (Not Archive)

These MUST be updated to reflect V2 schemas:

| File | Updates Needed |
|------|----------------|
| `CLAUDE.md` | All schema references |
| `CENTRALIZED_FUNCTIONS.md` | Function locations |
| `INGEST_GUIDELINES.md` | Source table locations |

### Post-Migration Cleanup (After Week 10)

1. Hardcode `SCHEMA_VERSION=v2` (remove feature flag)
2. Remove dual-write triggers
3. Archive `trapper.*` tables → `archive.*` schema in DB
4. **Backup `archive.*` externally** (required before drop)
5. DROP `archive.*` schema
6. Remove V1 code paths
7. Delete `/archive/` folder (optional, after backup)

### Size Targets

| Stage | Size | Notes |
|-------|------|-------|
| Current | ~1.3 GB | Includes build artifacts |
| After Pre-Cleanup | ~50 MB | Source code only |
| After V2 Stable | ~40 MB | Optimized, no legacy |

See `V2_CLEANUP_CHECKLIST.md` for detailed file lists and commands

---

## Part 9: Success Criteria

### Phase Gate Checkpoints

| Phase | Checkpoint | Criteria |
|-------|------------|----------|
| **Phase 1** | Schema ready | All schemas created, quarantine infrastructure operational |
| **Phase 2** | SOT migrated | Entity counts ±0, dual-write active, relationships intact |
| **Phase 3** | OPS migrated | Operational data accessible, Quarantine UI functional |
| **Phase 4** | Pipeline working | Full ingest→SOT pipeline works on new schemas |
| **Phase 5** | UI switched | All API routes using new schemas, no regressions |

### Data Integrity

- [ ] All entity counts match (±0 for entities, relationships)
- [ ] All active workflows function identically
- [ ] No increase in data quality alerts
- [ ] All merge chains preserved
- [ ] All provenance data intact
- [ ] Legacy violations properly quarantined (not silently dropped)

### System Health

- [ ] API response times within 10% of baseline
- [ ] No increase in error rates
- [ ] All scheduled jobs run successfully
- [ ] Map renders correctly
- [ ] Intake form submissions work end-to-end

### Quality Improvements

- [ ] Legacy violations quarantined (not in new SOT tables)
- [ ] Clear schema boundaries documented
- [ ] Reduced table count (280 → ~150)
- [ ] All tables in correct schema
- [ ] Quarantine review queue populated with actionable items
- [ ] First-name-only records properly handled per source

---

## Part 10: Open Questions for Discussion

1. **Historical Data Treatment:**
   - Should pre-2024 person-cat relationships be archived vs quarantined vs migrated with flags?
   - What's the retention policy for quarantined records?

2. **Naming Conventions:**
   - Keep `sot_*` prefix or just use schema (`sot.people` vs `sot.sot_people`)?
   - Standardize on singular vs plural table names?

3. **Beacon Independence:**
   - Should Beacon have its own copy of cat/place data (denormalized for performance)?
   - Or continue using views that join to SOT tables?

4. **Timeline:**
   - Is 12-week timeline realistic given current priorities?
   - Should this be phased over multiple quarters?

5. **Tooling:**
   - Need for custom admin UI to manage quarantine queue?
   - Monitoring/alerting for data drift during dual-write?

---

## Appendix A: Complete Table Inventory

See companion document: `ARCHITECTURE_OVERHAUL_TABLE_INVENTORY.md`

## Appendix B: Function Inventory

See companion document: `ARCHITECTURE_OVERHAUL_FUNCTION_INVENTORY.md`

## Appendix C: View Migration Plan

See companion document: `ARCHITECTURE_OVERHAUL_VIEW_INVENTORY.md`
