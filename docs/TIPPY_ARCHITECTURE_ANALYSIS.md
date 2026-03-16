# Atlas Data Architecture Analysis for Tippy Integration

**Date:** 2026-01-20
**Purpose:** Deep analysis of data architecture to improve how Tippy navigates the database

---

## Executive Summary

Atlas has a rich, well-structured database with **185 views** across 6 categories, but Tippy currently uses **30 hardcoded query tools** that only cover a fraction of possible questions. This document outlines:

1. The current data architecture
2. How entities are linked
3. Processing pipeline health
4. A design for making Tippy navigate the schema dynamically

**Key Insight:** Instead of building a new tool for every question, Tippy should understand the schema and query relevant views directly.

---

## Part 1: Data Sources and Ingestion

### Source Systems

| Source | Tables | Records | Purpose |
|--------|--------|---------|---------|
| **clinichq** | cat_info, owner_info, appointment_info | 90K+ | Clinic visits, medical data |
| **airtable** | trapping_requests, trappers, project75 | 15K+ | Request management |
| **shelterluv** | animals, outcomes, people | 30K+ | Shelter partner data |
| **web_intake** | intake_submissions | 3K+ | Public intake forms |
| **volunteerhub** | volunteer_records | 2K+ | Volunteer data |
| **petlink** | microchip_records | 1K+ | Microchip lookups |
| **google_maps** | map_entries | 500+ | Historical notes |

### Ingestion Flow

```
Raw Data → staged_records → Processing Queue → SOT Tables → Views
              (immutable)      (job queue)        (canonical)   (queryable)
```

All data flows through `staged_records` for auditability, then through centralized `find_or_create_*` functions for deduplication.

---

## Part 2: Core Entity Architecture

### The Three Canonical Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                        sot.people                                │
│  (Every human FFSC has interacted with)                         │
│  Identity: person_identifiers (email, phone)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
┌─────────────┐  ┌──────────┐  ┌───────────────┐
│ops.requests │  │sot.cats  │  │  sot.places   │
│ (TNR jobs)  │  │(animals) │  │ (locations)   │
└─────────────┘  └──────────┘  └───────────────┘
```

### Identity Resolution

People are matched via **email** or **phone** (never name alone):
- `person_identifiers` table holds normalized contact info
- `data_engine_match_decisions` logs all matching decisions
- Households group multiple people at the same address

### Key Relationship Tables

| Table | Links | Purpose |
|-------|-------|---------|
| `sot.person_place` | person ↔ place | Who lives/works where |
| `sot.cat_place` | cat ↔ place | Where cats are located |
| `sot.person_cat` | person ↔ cat | Foster/adopter/caretaker |
| `request_trapper_assignments` | request ↔ person | Who trapped where |
| `place_contexts` | place ↔ context_type | Colony sites, foster homes, etc. |

---

## Part 3: View Categories (185 Total)

### Category 1: Entity Views (22)
Clean access to canonical entities with joins pre-computed.

**Key views:**
- `v_canonical_people` - Active people (not merged)
- `v_canonical_cats` - Active cats (not merged)
- `v_canonical_places` - Active places (not merged)
- `v_person_detail` - Full person profile
- `v_cat_detail` - Full cat profile with medical history
- `v_place_detail` - Full place with colony data
- `v_search_sot_unified` - Cross-entity search

### Category 2: Stats & Aggregation (31)
Pre-computed metrics for dashboards.

**Key views:**
- `v_request_alteration_stats` - Cat attribution with rolling windows
- `v_trapper_full_stats` - Comprehensive trapper metrics
- `v_place_alteration_history` - TNR progress over time
- `v_place_ecology_stats` - Chapman mark-resight calculations
- `v_ffr_impact_summary` - Overall impact metrics

### Category 3: Processing & Jobs (11)
Pipeline monitoring.

**Key views:**
- `v_processing_dashboard` - Job queue status
- `v_intake_triage_queue` - Pending intake
- `v_external_import_stats` - Source sync status

### Category 4: Data Quality (28)
Problem detection and deduplication.

**Key views:**
- `v_data_quality_dashboard` - Quality metrics
- `v_duplicate_merge_candidates` - Merge review queue
- `v_data_engine_review_queue` - Identity decisions pending
- `v_scas_data_quality` - SCAS-specific issues

### Category 5: Beacon/Ecology (19)
Population modeling and estimation.

**Key views:**
- `v_beacon_summary` - Overall beacon stats
- `v_site_aggregate_stats` - Multi-parcel deduplication
- `v_place_colony_status` - Colony estimates

### Category 6: Linkage/Relationships (14)
How entities connect.

**Key views:**
- `v_request_current_trappers` - Active assignments
- `v_person_cat_history` - Foster/adopter records
- `v_place_context_summary` - Place tags

---

## Part 4: Current Tippy Implementation

### 30 Hardcoded Tools

| Tool | Purpose | View Used |
|------|---------|-----------|
| `query_cats_at_place` | Cats at address | Custom query |
| `query_place_colony_status` | Colony health | `v_place_colony_status` |
| `query_request_stats` | Request counts | Custom query |
| `query_ffr_impact` | Impact metrics | Custom query |
| `query_cats_altered_in_area` | Regional counts | Custom query |
| `query_region_stats` | Regional overview | Custom query |
| `query_person_history` | Person summary | Custom query |
| `query_trapper_stats` | Trapper metrics | `v_trapper_full_stats` |
| `comprehensive_person_lookup` | Full person | `v_person_detail` |
| `comprehensive_cat_lookup` | Full cat | `v_cat_detail` |
| `comprehensive_place_lookup` | Full place | `v_place_detail` |
| `check_data_quality` | Quality metrics | `v_data_quality_dashboard` |
| ... | ... | ... |

### Problems with Current Approach

1. **Scale**: Each new question type requires a new tool
2. **Rigidity**: Tools have fixed queries that don't adapt
3. **Duplication**: Tools often reimplement view logic
4. **Gaps**: 185 views exist but only ~15 are exposed
5. **Beacon disconnect**: Tippy tools don't help Beacon

---

## Part 5: Proposed Schema Navigation Design

### Core Concept: View Discovery Layer

Instead of hardcoding queries, give Tippy a **schema navigator** that can:
1. List available views by category
2. Get view columns and descriptions
3. Query views dynamically with filters

### Proposed New Tools

#### 1. `discover_schema`
Returns available views grouped by category with descriptions.

```typescript
// Input: { category?: "entity" | "stats" | "quality" | "ecology" | "linkage" }
// Output: List of views with their purpose and key columns
```

#### 2. `query_view`
Generic view query with filters.

```typescript
// Input: {
//   view_name: string,
//   filters?: { column: string, operator: string, value: string }[],
//   limit?: number,
//   columns?: string[]
// }
// Output: Query results with row count
```

#### 3. `explore_entity`
Deep-dive on any entity following relationships.

```typescript
// Input: {
//   entity_type: "person" | "cat" | "place" | "request",
//   identifier: string, // ID, name, address, microchip
//   include_relationships?: boolean
// }
// Output: Entity details with linked entities
```

#### 4. `check_data_health`
Unified data quality check.

```typescript
// Input: { focus?: "processing" | "duplicates" | "linkage" | "quality" }
// Output: Health metrics with actionable items
```

### View Metadata Table

Create a table to store view metadata Tippy can query:

```sql
CREATE TABLE ops.tippy_view_catalog (
  view_name TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  key_columns TEXT[],
  example_questions TEXT[],
  requires_filter BOOLEAN DEFAULT false,
  filter_columns TEXT[]
);
```

### Benefits

1. **Scalable**: New views automatically discoverable
2. **Flexible**: Tippy can construct queries based on need
3. **Self-documenting**: Metadata describes what each view does
4. **Beacon-aligned**: Same views power both Tippy and Beacon
5. **Gap detection**: Tippy can report what it can't query

---

## Part 6: Processing Pipeline Health

### Current Status

| Source | % Processed | Notes |
|--------|-------------|-------|
| clinichq | 87% | 38K owner_info unprocessed (being addressed) |
| airtable | 95% | Healthy |
| shelterluv | 50% | 6K outcomes in queue |
| web_intake | 99% | Healthy |
| volunteerhub | 80% | Some backlog |

### Key Functions

All processing goes through centralized functions:
- `find_or_create_person()` - Identity resolution
- `find_or_create_cat_by_microchip()` - Cat deduplication
- `find_or_create_place_deduped()` - Address normalization
- `find_or_create_request()` - Request creation with attribution

### Monitoring

- `/api/health/processing` - Processing dashboard
- `v_processing_dashboard` - Queue depth by source
- `v_data_engine_health` - Identity resolution stats

---

## Part 7: Gaps Tippy Can Expose

### Questions Tippy Should Ask Itself

When Tippy encounters a question it can't answer, it should log:
1. What data was requested?
2. What views were searched?
3. What was missing?

This creates a feedback loop for architecture improvement.

### Current Known Gaps

| Gap | Impact | Fix |
|-----|--------|-----|
| Airtable colony sizes not synced | Colony estimates incomplete | Add to sync pipeline |
| Volunteerhub activities not linked | Volunteer metrics incomplete | Process volunteer hours |
| No view for "cats I fostered" | Staff can't see their history | Add `v_my_foster_history` |

---

## Part 8: Implementation Roadmap

### Phase 1: Schema Catalog (Quick Win)
- Create `tippy_view_catalog` table
- Populate with 185 views and metadata
- Add `discover_schema` tool

### Phase 2: Generic Query Tool
- Implement `query_view` with safety guards
- Allow Tippy to query any cataloged view
- Add query logging for learning

### Phase 3: Gap Detection
- Log unanswerable questions
- Track which views get queried
- Generate weekly "what Tippy couldn't find" report

### Phase 4: Beacon Integration
- Ensure Beacon and Tippy use same views
- Add Tippy tools for Beacon-specific queries
- Unified population estimation queries

---

## Appendix: Key Views Reference

### For Entity Lookups
```sql
-- Person by name/email/phone
SELECT * FROM ops.v_person_detail WHERE ...

-- Cat by microchip/name
SELECT * FROM ops.v_cat_detail WHERE ...

-- Place by address
SELECT * FROM ops.v_place_detail WHERE ...
```

### For Statistics
```sql
-- Request attribution
SELECT * FROM ops.v_request_alteration_stats WHERE request_id = ...

-- Trapper performance
SELECT * FROM ops.v_trapper_full_stats WHERE person_id = ...

-- Place TNR history
SELECT * FROM ops.v_place_alteration_history WHERE place_id = ...
```

### For Data Quality
```sql
-- Overall health
SELECT * FROM ops.v_data_quality_dashboard;

-- Pending duplicates
SELECT * FROM ops.v_duplicate_merge_candidates;

-- Processing queue
SELECT * FROM ops.v_processing_dashboard;
```

---

## Summary

Atlas has mature, well-designed data architecture with 185 views covering every use case. The bottleneck is **exposing this architecture to Tippy**. Rather than building more hardcoded tools, the solution is:

1. **Catalog the views** with metadata Tippy can query
2. **Give Tippy generic query tools** that work with any view
3. **Log gaps** when Tippy can't answer questions
4. **Align with Beacon** so both use the same data layer

This approach scales indefinitely and turns Tippy into a data explorer rather than a limited Q&A bot.
