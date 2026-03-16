# Atlas Documentation Index

**Last Updated:** 2026-03-16

Comprehensive index of all active documentation in `docs/` (excluding `docs/archive/`).

---

## Core Reference (CLAUDE.md-linked)

These are referenced from `CLAUDE.md` and should always be kept current:

| Document | Purpose |
|----------|---------|
| `ATLAS_NORTH_STAR_V2.md` | System layers, invariants, data zones, failure modes |
| `CENTRALIZED_FUNCTIONS.md` | Full SQL function signatures |
| `CORE_FUNCTIONS.md` | Quick-reference function table |
| `INGEST_GUIDELINES.md` | Data ingestion rules |
| `DATA_FLOW_ARCHITECTURE.md` | Data pipeline from sources to Beacon |
| `CLINIC_DATA_STRUCTURE.md` | ClinicHQ data flow rules |
| `DATA_GAP_RISKS.md` | Edge cases & unusual scenarios |
| `ACTIVE_FLOW_SAFETY_GATE.md` | Safety checklist for active flow changes |

---

## Developer Guides

| Document | Purpose |
|----------|---------|
| `DEVELOPER_GUIDE.md` | Dev setup, debugging, active flow call graphs, column gotchas |
| `DEVELOPER_QUICK_START.md` | Quick onboarding |
| `ATLAS_REPO_MAP.md` | Directory structure & naming conventions |
| `ADDING_DATA_SOURCES.md` | How to add a new data source |
| `AUTH.md` | Authentication & authorization |
| `DEPLOYMENT.md` | Deployment process |
| `SECURITY_REVIEW.md` | Security considerations |
| `DECISIONS.md` | Architecture decision log |

---

## Architecture & Design

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE_DIAGRAMS.md` | System diagrams (ASCII art) |
| `ARCHITECTURE_ENTITY_RESOLUTION.md` | Data Engine / identity resolution design |
| `ATLAS_MISSION_CONTRACT.md` | Core promise: entities are real and distinct |
| `ATLAS_BEACON_ALIGNMENT.md` | Feature audit: Atlas vs Beacon spec |
| `DATA_RELIABILITY_ANALYSIS.md` | ClinicHQ data reliability methodology |
| `VERIFICATION_LAYER_DESIGN.md` | Verification design |
| `DATA_PATTERN_DETECTION.md` | Pattern detection rules |
| `TECHNICAL_NEARBY_COMPUTATION.md` | Bounding box vs PostGIS for nearby requests |
| `ECOLOGY_METHODOLOGY.md` | Beacon science (Chapman estimator) |
| `architecture/colony-estimation.md` | Three-tier colony size estimation |
| `architecture/attribution-windows.md` | Cat-request attribution window logic |
| `design/INGEST_VS_ENRICHMENT.md` | Source vs enrichment field classification |
| `design/SITE_VS_PERSON_PROPOSAL.md` | Site-centric vs person-centric design |

---

## Visualizations

| Document | Purpose |
|----------|---------|
| `visualizations/API_ROUTES_MAP.md` | API route → table/view mapping (Mermaid) |
| `visualizations/DATA_FLOW_DIAGRAM.md` | Data flow diagram (Mermaid) |
| `visualizations/ENTITY_RELATIONSHIP_DIAGRAM.md` | Entity relationship diagram (Mermaid) |
| `visualizations/SQL_FUNCTIONS_MAP.md` | SQL function dependency map |

---

## Ops & Pipeline

| Document | Purpose |
|----------|---------|
| `DATA_INGESTION_RULES.md` | Detailed ingestion procedures |
| `ops/CATS_TO_PLACES.md` | Cat-place linking pipeline |
| `ops/CATS_LAYER.md` | Cat data layer documentation |
| `ops/PLACES_AND_ADDRESSES.md` | Place/address pipeline |
| `ops/OWNER_ADDRESSES_PIPELINE.md` | Owner address resolution |
| `ops/DATA_QUALITY.md` | Data quality safeguards (blacklists, exclusions) |
| `ops/DB_CONNECTIONS.md` | Database connection management |
| `AI_EXTRACTION_GUIDE.md` | Claude AI extraction pipeline (costs, scripts) |
| `CLINICHQ_SCRAPE_ARCHITECTURE.md` | ClinicHQ scrape infrastructure |
| `JOTFORM_AIRTABLE_MAPPING.md` | JotForm → Airtable field mapping |

---

## Runbooks

| Document | Purpose |
|----------|---------|
| `runbooks/START_HERE.md` | Runbook entry point |
| `runbooks/LOCAL_DEV.md` | Local development setup |
| `runbooks/DB_BOOTSTRAP.md` | Database bootstrap from scratch |
| `runbooks/FIRST_INGEST.md` | First data ingestion |
| `runbooks/INGESTION_PLAYBOOK.md` | Ongoing ingestion operations |
| `runbooks/ADDRESS_BOOTSTRAP.md` | Address geocoding bootstrap |
| `runbooks/ENTITY_MATCHING.md` | Entity matching & dedup operations |
| `runbooks/SEARCH.md` | Search system setup & testing |
| `runbooks/DEPLOYMENT.md` | Deployment runbook |
| `runbooks/PREFLIGHT.md` | Pre-deployment checks |

---

## Data Quality & Tracking

| Document | Purpose |
|----------|---------|
| `DATA_GAPS.md` | Active data quality issues tracker |
| `DATA_GAP_054__address_type_accounts_missing_places.md` | Specific gap: address-type accounts |
| `DATA_ISSUE_001__microchip_extraction_gap.md` | Specific issue: microchip extraction |
| `DATA_QUALITY_ANALYSIS.md` | Data quality analysis snapshot |
| `TECHNICAL_DEDUPLICATION.md` | Dedup methodology |
| `TECHNICAL_METHODOLOGY.md` | Technical approach documentation |
| `DEAD_CODE_ROUTES.md` | Dead/mismatched API routes tracker |
| `TEST_SUITE_WORKING_LEDGER.md` | Test suite working notes |
| `INTAKE_REQUEST_DATA_FLOW_AUDIT.md` | Intake data flow audit |

---

## Tippy (AI Assistant)

| Document | Purpose |
|----------|---------|
| `TIPPY_ARCHITECTURE.md` | Architecture context for Tippy |
| `TIPPY_ARCHITECTURE_ANALYSIS.md` | Deep schema analysis (185 views) |
| `TIPPY_DATA_QUALITY_REFERENCE.md` | Data quality context |
| `TIPPY_VIEWS_AND_SCHEMA.md` | Schema navigation & view catalog |
| `TIPPY_KNOWLEDGE_GAPS.md` | Known limitations |
| `TIPPY_SHOWCASE_QUESTIONS.md` | Demo questions |
| `TIPPY_USE_CASES.md` | Use case examples |

---

## Beacon (Population Modeling)

| Document | Purpose |
|----------|---------|
| `beacon/trapper-statistics.md` | Trapper stats: types, API, views |
| `beacon/legacy-request-alteration-rate.md` | Legacy alteration rate analysis |

---

## Reality (Airtable Transition)

| Document | Purpose |
|----------|---------|
| `reality/README.md` | Reality docs overview |
| `reality/REALITY_CONTRACT.md` | Airtable transition contract |
| `reality/HYBRID_TRANSITION.md` | Hybrid transition plan |
| `reality/AIRTABLE_WORKFLOWS_CATALOG.md` | Airtable workflow catalog |
| `reality/COCKPIT_FIELD_MENTAL_MODEL.md` | Cockpit field mental model |
| `reality/AI_CONTEXT_PACK.md` | AI context for reality docs |

---

## UI & Staff

| Document | Purpose |
|----------|---------|
| `UI_REDESIGN_SPEC.md` | UI redesign specification |
| `UI_AUDIT_GROUNDED.md` | Grounded UI audit |
| `REQUESTS_REDESIGN_PLAN.md` | Request page redesign |
| `ATLAS_OPERATOR_GUIDE.md` | Staff operator guide |
| `STAFF_IDENTITY_REVIEW_GUIDE.md` | Identity review procedures |
| `STAFF_ACTION_ITEMS.md` | Staff action items |

---

## Planning & Roadmap

| Document | Purpose |
|----------|---------|
| `UNIFIED_IMPLEMENTATION_PLAN_V2.md` | Current master roadmap (Chunks 10-18) |
| `CURRENT_STATE_AND_PLAN.md` | V2 overhaul status |
| `UI_RESTRUCTURE_PLAN.md` | UI restructure phases |
| `E2E_TEST_UPGRADE_PLAN.md` | E2E test upgrade plan |
| `ENTITY_LINKING_FORTIFICATION_PLAN.md` | Entity linking improvements |

---

## Historical Reference

| Document | Purpose |
|----------|---------|
| `ARCHIVED_ISSUES.md` | Linear issue archive (FFS-5 through FFS-322) |
| `LINEAR_COMPLETED_ARCHIVE.md` | Completed Linear issues |
| `meetings/2026-02-20_trapper_meeting_stats.md` | Trapper meeting stats |

---

## Lessons Learned

These patterns caused bugs. Preserved in CLAUDE.md "Don't Do" section:

1. **Identity by name alone** — NEVER match people by name, always email/phone
2. **Cell Phone before Owner Phone** — Cell phones are shared in households
3. **PetLink emails without confidence filter** — Staff fabricates emails
4. **Direct INSERTs to entity tables** — Always use `find_or_create_*`
5. **Linking cats to ALL sot.person_place rows** — Use LIMIT 1
6. **TS/SQL parity drift** — Upload route must mirror SQL processor
7. **Org emails as personal identifiers** — Soft-blacklist shared emails
8. **Disease computed at clinics** — Filter by `should_compute_disease_for_place()`
9. **Business names as people** — Use `classify_owner_name()` with ref tables
10. **Arbitrary distance radius for aggregation** — Use `get_place_family()`
