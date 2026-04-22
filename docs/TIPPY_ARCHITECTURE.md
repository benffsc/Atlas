# Tippy Architecture: Unified Expert Agent System

**Version:** 3.0 (V2 Rewrite)
**Date:** 2026-04-21
**Status:** Implementation Guide

Tippy is an **expert agentic AI** that knows the ins and outs of FFSC's data, operations, strengths, weaknesses, and data gaps. This document defines the unified architecture for all Tippy components.

---

## Design Philosophy

Based on [industry best practices](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) for agentic AI systems:

### 1. Single Agent with Deep Domain Expertise
Tippy uses the **single-agent pattern** with comprehensive domain knowledge embedded in its system prompt. Unlike generic chatbots, Tippy reasons like an experienced TNR coordinator who has worked at FFSC for years.

### 2. Reasoning-Action Coupling
Per [Amazon's evaluation framework](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/), Tippy couples reasoning tightly with action:
- **Sense**: Receive question + context
- **Think**: Reason about what data would answer it (chain-of-thought)
- **Act**: Execute tools to gather data
- **Reflect**: Interpret results, identify gaps, explain caveats

### 3. Entity Lenses, Not Source-System Lenses

Each V2 tool returns everything about an entity from ALL sources. Instead of separate tools
for ClinicHQ data, ShelterLuv data, and VolunteerHub data about the same person, `person_lookup`
queries all three in parallel and returns a unified view.

When CDS photos, population forecasts, or new ShelterLuv data lands, existing tools get
richer — no new tools needed.

### 4. Honest Data Quality Awareness
Unlike systems that blindly report numbers, Tippy:
- Distinguishes NULL (unknown) from actual values
- Acknowledges when data gaps exist
- Explains why numbers might differ between systems
- Recommends caution when statistics seem suspicious

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TIPPY AGENT SYSTEM (V2)                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ DOMAIN KNOWLEDGE │  │ REASONING ENGINE  │  │  COMMUNICATION    │  │
│  │ (knowledge.ts)   │  │                   │  │     STYLE         │  │
│  │                  │  │ - Chain of        │  │ - Story-first     │  │
│  │ - TNR science    │  │   thought         │  │ - Caveats         │  │
│  │ - FFSC geography │  │ - Hypothesis      │  │ - Mission         │  │
│  │ - Data quality   │  │   testing         │  │   connection      │  │
│  │ - Known gaps     │  │ - Self-reflection │  │                   │  │
│  └────────┬─────────┘  └────────┬──────────┘  └───────────────────┘  │
│           │                     │                                     │
│           ▼                     ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │                  V2 TOOL MANIFEST (15 tools)                     ││
│  │                                                                  ││
│  │  ┌────────────────────┐ ┌──────────────┐ ┌────────────────────┐ ││
│  │  │  ENTITY LENSES (8) │ │ STRATEGY (4) │ │  WRITE OPS (3)     │ ││
│  │  │                    │ │              │ │                    │ ││
│  │  │ full_place_briefing│ │ area_stats   │ │ create_reminder    │ ││
│  │  │ place_search       │ │ spatial_     │ │ send_message       │ ││
│  │  │ person_lookup      │ │   context    │ │ log_event          │ ││
│  │  │ cat_lookup         │ │ compare_     │ │                    │ ││
│  │  │ cat_search         │ │   places     │ └────────────────────┘ ││
│  │  │ trapper_stats      │ │ find_priority│                        ││
│  │  │ request_stats      │ │   _sites     │  ┌────────────────────┐││
│  │  │ run_sql            │ └──────────────┘  │  ESCAPE HATCH (1)  │││
│  │  └────────────────────┘                   │  run_sql            │││
│  │                                           └────────────────────┘││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │                   DATA QUALITY LAYER                              ││
│  │                                                                   ││
│  │  Known Gaps:  DATA_GAP_056, 057, 058, 059, ...                   ││
│  │  Soft Blacklist: Org emails, fabricated PetLink emails            ││
│  │  Confidence Thresholds: >= 0.5 for identifiers                   ││
│  │  NULL Awareness: Always distinguish unknown vs actual             ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

---

## Feature Flag

```
TIPPY_V2_ENABLED=true   →  routes to V2 handler (route-v2.ts)
TIPPY_V2_ENABLED=false   →  routes to V1 handler (route.ts)  [default]
```

`chat/route.ts` acts as the feature flag dispatcher. When `TIPPY_V2_ENABLED` is unset or `false`, all traffic goes to the V1 handler. When `true`, traffic routes to the V2 handler with the 15-tool manifest.

---

## V2 Tool Manifest (15 Tools)

| # | Tool | Entity Lens | Purpose |
|---|------|-------------|---------|
| 1 | `run_sql` | Any | Dynamic SQL queries for exploratory or complex questions |
| 2 | `full_place_briefing` | Place | Complete place report: cats, colony status, history, nearby activity, requests |
| 3 | `place_search` | Place (discovery) | Find a place by address, partial name, or fuzzy match |
| 4 | `person_lookup` | Person | Unified person report across all source systems |
| 5 | `cat_lookup` | Cat | Full cat report: microchip, procedures, places, journey |
| 6 | `cat_search` | Cat (description) | Find cats by physical description, color, name |
| 7 | `area_stats` | Geographic area | Regional/city TNR stats, FFR impact, partner org stats |
| 8 | `spatial_context` | Location | Nearby activity analysis, hot zone detection |
| 9 | `compare_places` | Place (comparison) | Multi-dimensional comparison of two places |
| 10 | `find_priority_sites` | Strategic | Find intact cat clusters needing TNR |
| 11 | `trapper_stats` | Trapper domain | Trapper performance, staff info, availability |
| 12 | `request_stats` | Request pipeline | Request pipeline metrics, status breakdown |
| 13 | `create_reminder` | Write | Create personal reminders for staff |
| 14 | `send_message` | Write | Send messages to staff members |
| 15 | `log_event` | Write (dispatcher) | Log field events, observations, data corrections, draft requests, anomalies |

---

## V1 to V2 Migration Map

| V1 Tool(s) | V2 Tool | Notes |
|-------------|---------|-------|
| `run_sql`, `discover_views`, `query_view`, `explore_entity` | `run_sql` | Single escape hatch replaces 4 exploration tools |
| `analyze_place_situation`, `get_place_recent_context`, `query_cats_at_place`, `query_place_colony_status`, `query_colony_estimate_history`, `query_places_by_context`, `full_place_briefing` | `full_place_briefing` | 7 place tools collapsed into 1 composite lens |
| `comprehensive_place_lookup` | `place_search` | Renamed for clarity: search/discovery vs briefing |
| `comprehensive_person_lookup`, `query_person_history`, `query_person_cat_relationships`, `query_volunteerhub_data` | `person_lookup` | 4 person tools unified |
| `comprehensive_cat_lookup`, `lookup_cat_appointment`, `query_cat_journey` | `cat_lookup` | 3 cat tools unified |
| `search_cats_by_description` | `cat_search` | Renamed |
| `query_region_stats`, `query_cats_altered_in_area`, `query_ffr_impact`, `strategic_city_analysis`, `query_partner_org_stats` | `area_stats` | 5 geographic tools unified |
| `analyze_spatial_context` | `spatial_context` | Renamed |
| `compare_places` | `compare_places` | Unchanged |
| `find_intact_cat_clusters` | `find_priority_sites` | Renamed for intent clarity |
| `query_trapper_stats`, `query_staff_info` | `trapper_stats` | 2 tools unified |
| `query_request_stats` | `request_stats` | Renamed |
| `create_reminder` | `create_reminder` | Unchanged |
| `send_staff_message` | `send_message` | Renamed |
| `log_field_event`, `log_site_observation`, `log_data_discrepancy`, `save_lookup`, `flag_anomaly`, `propose_data_correction`, `create_draft_request`, `update_request` | `log_event` | 8 write tools collapsed into 1 dispatcher |

**Total: 52 V1 tools reduced to 15 V2 tools.**

---

## SQL Function Registry

V2 tools delegate heavy lifting to SQL functions that return composite results:

| SQL Function | Called By V2 Tool | Returns |
|--------------|-------------------|---------|
| `ops.tippy_place_full_report(address)` | `full_place_briefing` | Cats, colony status, history, people, requests, nearby activity |
| `ops.tippy_spatial_analysis(address, lat, lng)` | `spatial_context` | Nearby places, hot zones, distance-weighted activity |
| `ops.tippy_strategic_analysis(question)` | `area_stats` | Regional metrics, coverage gaps, FFR impact |
| `ops.tippy_compare_places(addr1, addr2)` | `compare_places` | Side-by-side metrics for two places |
| `ops.comprehensive_place_lookup(address)` | `place_search` | Place candidates by address/name match |
| `ops.comprehensive_person_lookup(identifier)` | `person_lookup` | Person + identifiers + cats + places + appointments |
| `ops.comprehensive_cat_lookup(identifier)` | `cat_lookup` | Cat + microchip + appointments + places + people |
| `ops.send_staff_message(...)` | `send_message` | Message delivery confirmation |
| `ops.tippy_propose_correction(...)` | `log_event` (data_correction) | Correction proposal record |
| `ops.tippy_log_unanswerable(...)` | `log_event` (internal) | Unanswerable question audit log |

---

## File Structure

```
apps/web/src/app/api/tippy/
├── chat/
│   ├── route.ts            # V1 handler (feature flag dispatcher)
│   └── route-v2.ts         # V2 handler: parameterized prompt, single agent loop
├── tools.ts                # V1 tools (52 tools, kept during migration)
├── tools-v2.ts             # V2 tools (15 tools, dispatch map, shared helpers)
├── knowledge.ts            # V2: TNR science + geography + data quality (merged)
├── domain-knowledge.ts     # V1 (deprecated, merged into knowledge.ts)
├── data-quality.ts         # V1 (deprecated, merged into knowledge.ts)
├── briefing/route.ts       # Independent route
├── conversations/          # Independent routes
├── anomalies/              # Independent route
└── feedback/route.ts       # Independent route

docs/
├── TIPPY_ARCHITECTURE.md        # THIS FILE - unified design
├── TIPPY_SHOWCASE_QUESTIONS.md  # Demo questions with expected responses
├── TIPPY_DATA_QUALITY_REFERENCE.md  # Data quality issues for staff
└── TIPPY_VIEWS_AND_SCHEMA.md    # Database schema reference
```

### V1 vs V2 File Mapping

| V1 File | V2 File | Status |
|---------|---------|--------|
| `tools.ts` (52 tools) | `tools-v2.ts` (15 tools) | V1 kept for fallback |
| `domain-knowledge.ts` | `knowledge.ts` | Merged |
| `data-quality.ts` | `knowledge.ts` | Merged |
| `reasoning-patterns.ts` | Removed | Reasoning is now inline in the system prompt |
| `chat/route.ts` | `chat/route.ts` (dispatcher) + `chat/route-v2.ts` | Feature flag split |

---

## Domain Knowledge Module

### Location: `apps/web/src/app/api/tippy/knowledge.ts` (V2)

V2 merges `domain-knowledge.ts` and `data-quality.ts` into a single `knowledge.ts` module containing:

- **TNR science**: Alteration thresholds (70% stabilization, 90% colony control), mass trapping definitions, Kalman filter context
- **FFSC geography**: Sonoma County regions, city groupings, service area boundaries
- **Data quality awareness**: Known gaps (DATA_GAP_056-059+), suspicious patterns, NULL vs actual distinctions, confidence thresholds
- **Source authority**: What each system (ClinicHQ, ShelterLuv, VolunteerHub, Airtable) is authoritative for
- **Role definitions**: Caretaker, resident, trapper, coordinator distinctions

---

## Communication Style Guidelines

Tippy communicates like an experienced colleague, not a database query engine.

### DO:
- **Lead with the story**: "175 Scenic Avenue is one of our great success stories..."
- **Explain what numbers mean**: "94.5% altered means this colony is stabilized"
- **Acknowledge limitations honestly**: "I should mention that most cats here have unknown status"
- **Connect to the mission**: "This is exactly how TNR works at scale"
- **Guide prioritization**: "The real priority is active requests with untrapped potential"

### DON'T:
- Report raw statistics without context
- Say "I don't have that data" without trying tools
- Ignore suspicious patterns (very low rates, very high counts)
- Treat all data as equally reliable
- Overwhelm with numbers instead of insights

### Example Transformation:

**BAD Response:**
> "Query results: 187 cats, 11 altered, 176 unaltered. Alteration rate: 5.9%."

**GOOD Response:**
> "1688 Jennings Way has 187 cats in our records, but I should flag something about the 5.9% rate - most of those cats have unknown status from legacy data, not confirmed unaltered. We can't say if this is a priority or a data gap without checking individual records. The real priorities are active requests where we KNOW cats are waiting, like 36855 Annapolis Road where someone reported 45 cats but we've only verified 22."

---

## Implementation Checklist

### V2 Migration

- [x] Create TIPPY_ARCHITECTURE.md V3 (this document)
- [ ] Create `knowledge.ts` (merge domain-knowledge.ts + data-quality.ts)
- [ ] Create `tools-v2.ts` (15 tools with dispatch map)
- [ ] Create `chat/route-v2.ts` (parameterized prompt, single agent loop)
- [ ] Add `TIPPY_V2_ENABLED` feature flag to `chat/route.ts`
- [ ] Wire SQL functions (`ops.tippy_*`, `ops.comprehensive_*`)
- [ ] Validate all 15 tools against showcase questions
- [ ] Deprecation notices on V1 files

### V1 Cleanup (after V2 stable)

- [ ] Remove `tools.ts` (V1)
- [ ] Remove `domain-knowledge.ts`
- [ ] Remove `data-quality.ts`
- [ ] Remove `reasoning-patterns.ts`
- [ ] Collapse `chat/route.ts` dispatcher into `route-v2.ts`

---

## References

- [Google Cloud: Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [Amazon: Evaluating AI Agents](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [Survey: AI Agent Architectures for Reasoning & Tool Calling](https://arxiv.org/html/2404.11584v1)
- [Model Context Protocol](https://www.speakeasy.com/mcp/using-mcp/ai-agents/architecture-patterns)
