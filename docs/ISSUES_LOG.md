# Atlas Issues Log — Completed Work Archive

Generated: 2026-03-24 | Updated: 2026-04-06
Total completed issues: 746 (611 previously archived + 135 new)

This file preserves all completed Linear issues so they can be safely archived
in Linear to reduce project scope. All technical details, code references, and
context from these issues are captured here.

---

## CDS: Cat Determining System (2026-04-06)

### CDS-1: Infrastructure migration (MIG_3046)
- **Priority:** High | **Labels:** Clinic Days, Schema
- **Created:** 2026-04-06 | **Completed:** 2026-04-06
- `ops.cds_runs` table, 3 new columns on `clinic_day_entries`, 5 `app_config` keys

### CDS-2: Core pipeline + constraint propagation (Phases 0,1,5,7)
- **Priority:** High | **Labels:** Clinic Days, Backend
- **Created:** 2026-04-06 | **Completed:** 2026-04-06
- `apps/web/src/lib/cds.ts` — 734-line 7-phase pipeline

### CDS-3: Weight disambiguation (Phase 3)
- **Priority:** Medium | **Labels:** Clinic Days, Matching
- **Created:** 2026-04-06 | **Completed:** 2026-04-06

### CDS-4: Waiver bridge matching (Phase 2)
- **Priority:** Medium | **Labels:** Clinic Days, Matching
- **Created:** 2026-04-06 | **Completed:** 2026-04-06

### CDS-5: LLM tiebreaker (Phase 6)
- **Priority:** Medium | **Labels:** Clinic Days, AI
- **Created:** 2026-04-06 | **Completed:** 2026-04-06
- Gated behind `cds.llm.enabled` config, never auto-accepted

### CDS-6: Hub UI — status, review card, method badges
- **Priority:** High | **Labels:** Clinic Days, Frontend
- **Created:** 2026-04-06 | **Completed:** 2026-04-06
- CDS status lane, pipeline breakdown card, method badges in Roster

---

## Completed Epics

### FFS-178: Enhance entity resolution with phonetic matching, fuzzy phone bridging, and comparison-level scoring [ARCHIVED]
- **Priority:** Medium | **Labels:** Entity Linking, Data Quality, Improvement
- **Created:** 2026-03-06 | **Completed:** 2026-03-06
- **Children:** 4

  - **FFS-179** [A]: Add fuzzy phone matching with compound gate to data_engine_score_candidates
    - Labels: Entity Linking, Data Quality, Improvement | Done: 2026-03-06
  - **FFS-180** [A]: Upgrade scoring to comparison-level weights (Splink/Fellegi-Sunter pattern)
    - Labels: Entity Linking, Data Quality, Improvement | Done: 2026-03-06
  - **FFS-181** [A]: Integrate phonetic matching (dmetaphone) into dedup candidate generation
    - Labels: Entity Linking, Data Quality, Improvement | Done: 2026-03-06
  - **FFS-182** [A]: Add dynamic identifier demotion for high-frequency phones
    - Labels: Entity Linking, Data Quality, Improvement | Done: 2026-03-06

### FFS-217: Entity-Wide Dedup: Complete cat & place dedup infrastructure [ARCHIVED]
- **Priority:** Medium | **Labels:** Mar 2026, Data Quality, Feature
- **Created:** 2026-03-06 | **Completed:** 2026-03-06
- **Children:** 6

  - **FFS-218** [A]: MIG_2835: Complete cat dedup system — missing sub-views, safety gate, phonetic matching
    - Labels: Mar 2026, Infrastructure, Data Quality, Improvement | Done: 2026-03-06
  - **FFS-219** [A]: MIG_2836: Place dedup candidate generation — replace stub with 4-tier implementation
    - Labels: Mar 2026, Infrastructure, Data Quality, Improvement | Done: 2026-03-06
  - **FFS-220** [A]: Cat dedup admin UI + API route
    - Labels: Mar 2026, Frontend, API, Data Quality, Feature | Done: 2026-03-06
  - **FFS-230** [A]: Fix critical dedup safety gate bugs (MIG_2840)
    - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
  - **FFS-231** [A]: Address dedup infrastructure (MIG_2838)
    - Labels: Mar 2026, Data Quality, Feature | Done: 2026-03-06
  - **FFS-232** [A]: Request dedup infrastructure (MIG_2839)
    - Labels: Mar 2026, Data Quality, Feature | Done: 2026-03-06

### FFS-352: ShelterLuv lifecycle: Fix event processing + backfill cat_lifecycle_events (MIG_2878) [ARCHIVED]
- **Priority:** High | **Labels:** Mar 2026, Ingest, Infrastructure, Data Quality
- **Created:** 2026-03-08 | **Completed:** 2026-03-13
- **Children:** 2

  - **FFS-350** [A]: Fix process_shelterluv_events() — lifecycle writes, phone fallback, unhandled outcomes
    - Labels: Mar 2026, Ingest, Infrastructure, Data Quality | Done: 2026-03-13
  - **FFS-351** [A]: Fix process_shelterluv_intake_events() — lifecycle writes, foster_end tracking
    - Labels: Mar 2026, Ingest, Infrastructure, Data Quality | Done: 2026-03-13

### FFS-356: Import scraped ClinicHQ data as internal reference mirror [ARCHIVED]
- **Priority:** High | **Labels:** Mar 2026, Ingest, Infrastructure, Data Quality
- **Created:** 2026-03-09 | **Completed:** 2026-03-09
- **Children:** 3

  - **FFS-360** [A]: Create source.clinichq_scrape staging table migration
    - Labels: Mar 2026, Clinic, Infrastructure | Done: 2026-03-09
  - **FFS-361** [A]: Build clinichq_scrape_import.mjs idempotent import script
    - Labels: Mar 2026, Clinic, Ingest | Done: 2026-03-09
  - **FFS-362** [A]: Create clinichq_scrape enrichment views joining to Atlas entities
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09

### FFS-357: Extract hidden microchips from ClinicHQ scraped notes fields [ARCHIVED]
- **Priority:** High | **Labels:** Mar 2026, Data Quality
- **Created:** 2026-03-09 | **Completed:** 2026-03-09
- **Children:** 1

  - **FFS-363** [A]: Build microchip extraction migration from scrape notes fields
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09

### FFS-358: Surface cat lifecycle status badges and ShelterLuv bio in UI [ARCHIVED]
- **Priority:** Medium | **Labels:** Mar 2026, Infrastructure
- **Created:** 2026-03-09 | **Completed:** 2026-03-13
- **Children:** 3

  - **FFS-364** [A]: Add current_status and description to cat detail API
    - Labels: Mar 2026, Frontend, API | Done: 2026-03-10
  - **FFS-365** [A]: Add lifecycle status badge to CatCard component
    - Labels: Mar 2026, Frontend | Done: 2026-03-10
  - **FFS-366** [A]: Add outcome timeline and bio section to cat detail page
    - Labels: Mar 2026, Frontend | Done: 2026-03-10

### FFS-359: Surface ClinicHQ medical notes and cause-of-death on cat profiles [ARCHIVED]
- **Priority:** Medium | **Labels:** Mar 2026, Data Quality
- **Created:** 2026-03-09 | **Completed:** 2026-03-09
- **Children:** 3

  - **FFS-367** [A]: Add cat notes API endpoint sourcing from clinichq_scrape
    - Labels: Mar 2026, Clinic, API | Done: 2026-03-09
  - **FFS-368** [A]: Enrich cat_mortality_events with detailed cause-of-death from scrape labels
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-369** [A]: Display clinical notes and caution badges on cat detail page
    - Labels: Mar 2026, Frontend | Done: 2026-03-09

### FFS-373: ClinicHQ scrape enrichment pipeline — backfill sot.cats from 41K scraped records [ARCHIVED]
- **Priority:** High | **Labels:** Mar 2026, Clinic, Data Quality
- **Created:** 2026-03-09 | **Completed:** 2026-03-09
- **Children:** 15

  - **FFS-376** [A]: Register extracted clinichq_animal_ids for microchip-matched cats
    - Labels: Mar 2026, Clinic, Entity Linking, Data Quality | Done: 2026-03-09
  - **FFS-377** [A]: Backfill ownership_type from scrape animal_type (feral/friendly/owned classification)
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-378** [A]: Backfill altered_status from scrape heading_labels_json (27K sterilization records)
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-379** [A]: Parse sex/breed/coat_length from scrape animal_species_sex_breed field
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-380** [A]: Add weight tracking — schema + backfill from scrape (27K weight records)
    - Labels: Mar 2026, Clinic, Data Quality, Feature | Done: 2026-03-09
  - **FFS-382** [A]: Backfill primary_color and secondary_color from scrape animal_colors field
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-385** [A]: BUG: First-visit cats with microchip in Animal Name fall through ingest pipeline — no cat created
    - Labels: Mar 2026, Clinic, Ingest, Data Quality, Bug | Done: 2026-03-10
  - **FFS-392** [A]: Fix scrape microchip extraction — extracted_microchip column + re-apply enrichments
    - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
  - **FFS-405** [A]: Extract FIV/FeLV test results from scrape free-text notes
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-09
  - **FFS-406** [A]: Extract reproductive data from scrape — fetus counts, lactation, pregnancy
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-09
  - **FFS-407** [A]: Backfill cat age from scrape animal_age — 1,897 cats only in scrape
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-09
  - **FFS-408** [A]: Parse clinical conditions from scrape vet notes into structured observations
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-09
  - **FFS-409** [A]: Extract transport method from scrape appointment notes (trap vs carrier)
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-09
  - **FFS-417** [A]: Consolidate API export structured data → sot.cats + observation tables
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-10
  - **FFS-418** [A]: Backfill appointments from raw structured fields (temperature, lactating, dental disease)
    - Labels: Mar 2026, Clinic, Beacon, Data Quality | Done: 2026-03-10

### FFS-394: Unify print documents: shared CSS, editable fields, recon mode [ARCHIVED]
- **Priority:** Medium | **Labels:** Mar 2026, Requests, Frontend, Improvement
- **Created:** 2026-03-09 | **Completed:** 2026-03-10
- **Children:** 5

  - **FFS-395** [A]: Create shared print CSS and helper modules
    - Labels: Mar 2026, Frontend | Done: 2026-03-10
  - **FFS-396** [A]: Create shared print components (Bubble, EditableField, etc.)
    - Labels: Mar 2026, Frontend | Done: 2026-03-10
  - **FFS-397** [A]: Refactor trapper sheet: shared CSS, editable fields, recon mode
    - Labels: Mar 2026, Requests, Frontend | Done: 2026-03-10
  - **FFS-398** [A]: Refactor intake print form: green theme, shared CSS, editable fields
    - Labels: Mar 2026, Requests, Frontend | Done: 2026-03-10
  - **FFS-399** [A]: Refactor request print page: shared CSS and helpers
    - Labels: Mar 2026, Requests, Frontend | Done: 2026-03-10

### FFS-402: Paper-to-Digital Form System: Field Registry, Templates, Submissions
- **Priority:** High | **Labels:** Form System, Print Documents, Requests, Frontend
- **Created:** 2026-03-09 | **Completed:** 2026-03-13
- **Children:** 10

  - **FFS-403** [A]: Migrate TNR Call Sheet to shared print infrastructure
    - Labels: Print Documents, Frontend, Feature | Done: 2026-03-09
  - **FFS-404** [A]: Audit and standardize shared fields across intake/call sheet/request schemas
    - Labels: Form System, Print Documents, Data Quality | Done: 2026-03-10
  - **FFS-410** [A]: Create field registry table (ops.form_field_definitions)
    - Labels: Form System, Infrastructure | Done: 2026-03-10
  - **FFS-411** [A]: Create form submissions table (ops.form_submissions)
    - Labels: Form System, Infrastructure | Done: 2026-03-10
  - **FFS-412** [A]: Create form template tables (ops.form_templates + form_template_fields)
    - Labels: Form System, Infrastructure | Done: 2026-03-10
  - **FFS-414** [A]: Paper scan upload and attachment flow for form submissions
    - Labels: Form System, Feature | Done: 2026-03-10
  - **FFS-415** [A]: Form builder admin UI for managing templates
    - Labels: Form System, Frontend, Feature | Done: 2026-03-10
  - **FFS-445** [A]: Sync DB form field options to match field-options.ts (MIG_2905)
    - Labels: Form System, Data Quality | Done: 2026-03-13
  - **FFS-446** [A]: Add auth to form submissions API
    - Labels: Form System, API | Done: 2026-03-13
  - **FFS-447** [A]: Wire requestToFormData into admin form preview
    - Labels: Form System, Frontend | Done: 2026-03-13

### FFS-469: Trapper Management System — Foundation [ARCHIVED]
- **Priority:** High | **Labels:** Mar 2026, Volunteers, Feature
- **Created:** 2026-03-12 | **Completed:** 2026-03-13
- **Children:** 7

  - **FFS-470** [A]: Fix misidentified trappers (Susan Rose, Ernie Lockner, etc.)
    - Labels: Mar 2026, Volunteers, Data Quality | Done: 2026-03-12
  - **FFS-471** [A]: Reclassify trapper tiers from Airtable approval statuses
    - Labels: Mar 2026, Volunteers, Data Quality | Done: 2026-03-13
  - **FFS-472** [A]: Sync missing Airtable trappers into Atlas
    - Labels: Volunteers, Ingest, Data Quality | Done: 2026-03-13
  - **FFS-473** [A]: Trapper management page — profile, status, assignments
    - Labels: Volunteers, Frontend, Feature | Done: 2026-03-13
  - **FFS-474** [A]: Community trapper onboarding pipeline (JotForm → Atlas)
    - Labels: Volunteers, Ingest, Feature | Done: 2026-03-13
  - **FFS-475** [A]: Fix merge_person_into to handle trapper tables
    - Labels: Volunteers, Infrastructure, Data Quality | Done: 2026-03-13
  - **FFS-476** [A]: Fix VH sync role processing gap for approved trappers
    - Labels: Volunteers, Ingest, Bug | Done: 2026-03-13

### FFS-485: Epic: Modular Request Form Architecture
- **Priority:** High | **Labels:** Form System, Requests, Frontend
- **Created:** 2026-03-13 | **Completed:** 2026-03-14
- **Children:** 15

  - **FFS-486**: Phase 1a: Centralize form option registry
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-487**: Phase 1b: Extract PersonSection — unified person search + create component
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-488**: Phase 1c: Extract PlaceSection — unified location + property type component
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-489**: Phase 2a: Extract CatDetailsSection — count, fixed status, handleability, eartip
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-490**: Phase 2b: Extract KittenAssessmentSection — age, behavior, mom, readiness
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-491**: Phase 2c: Extract PropertyAccessSection — owner, permission, access, trapping logistics
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-492**: Phase 2d: Extract UrgencyNotesSection — urgency reasons, medical concerns, feeding, notes
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-493**: Phase 3a: Recompose /requests/new from extracted sections
    - Labels: Form System, Requests, Frontend | Done: 2026-03-13
  - **FFS-494**: Phase 3b: Recompose intake pages from extracted sections
    - Labels: Form System, Requests, Frontend | Done: 2026-03-14
  - **FFS-495**: Phase 3c: Recompose Handoff + Redirect modals from extracted sections
    - Labels: Form System, Requests, Frontend | Done: 2026-03-13
  - **FFS-496**: Phase 4: Form context configuration — JSON-driven section composition
    - Labels: Form System, Requests, Frontend | Done: 2026-03-13
  - **FFS-497**: Phase 5: Admin UI for form configuration
    - Labels: Form System, Requests, Frontend, Feature | Done: 2026-03-15
  - **FFS-498**: Phase 1d: Centralize entity write contracts — person, place, relationship creation APIs
    - Labels: Form System, Requests, API, Infrastructure | Done: 2026-03-14
  - **FFS-499**: Phase 2e: Unify print forms with section data contracts
    - Labels: Form System, Print Documents, Requests, Frontend | Done: 2026-03-14
  - **FFS-500**: Phase 3d: Unify intake submission pipeline with section contracts
    - Labels: Form System, Requests, API, Infrastructure | Done: 2026-03-14

### FFS-486: Phase 1a: Centralize form option registry
- **Priority:** High | **Labels:** Form System, Requests, Frontend
- **Created:** 2026-03-13 | **Completed:** 2026-03-14
- **Children:** 1

  - **FFS-502** [A]: Fix feeding_duration value mismatch between form-options.ts and DB CHECK constraint
    - Labels: Bug | Done: 2026-03-13

### FFS-503: Epic: Configurable Airtable Sync Engine
- **Priority:** High | **Labels:** Ingest, Infrastructure, Feature
- **Created:** 2026-03-13 | **Completed:** 2026-03-14
- **Children:** 7

  - **FFS-200**: Import Airtable Master Cats Photos and Notes
    - Labels: Mar 2026, Data Quality | Done: 2026-03-14
  - **FFS-204**: Import Airtable Project 75 Survey Data
    - Labels: Mar 2026, Beacon, Data Quality | Done: 2026-03-14
  - **FFS-504**: Airtable Sync Engine: DB schema + core library
    - Labels: Mar 2026, Ingest, Infrastructure | Done: 2026-03-13
  - **FFS-505**: Airtable Sync Engine: Admin API routes
    - Labels: Mar 2026, Ingest, API | Done: 2026-03-13
  - **FFS-507**: Airtable Sync Engine: Generic cron + webhook endpoints
    - Labels: Mar 2026, Ingest, API, Infrastructure | Done: 2026-03-13
  - **FFS-508**: Airtable Sync Engine: Admin UI
    - Labels: Mar 2026, Frontend, Feature | Done: 2026-03-13
  - **FFS-510**: Airtable Sync Engine: Migrate trapper-agreement-sync
    - Labels: Mar 2026, Ingest, Infrastructure | Done: 2026-03-14

### FFS-506: Epic: Atlas V2.5 — Admin Everything
- **Priority:** High | **Labels:** Frontend, Infrastructure, Feature
- **Created:** 2026-03-13 | **Completed:** 2026-03-14
- **Children:** 11

  - **FFS-509**: V2.5 Phase 1: Config Foundation — app_config table + load-from-DB pattern
    - Labels: API, Infrastructure, Feature | Done: 2026-03-14
  - **FFS-511**: V2.5 Phase 2a: Navigation Menu Builder — admin-configurable sidebar
    - Labels: Frontend, Feature | Done: 2026-03-14
  - **FFS-512**: V2.5 Phase 2b: Role & Permission Manager — configurable access control
    - Labels: Security, Frontend, API, Feature | Done: 2026-03-14
  - **FFS-513**: V2.5 Phase 3a: Alert & Threshold Config — admin-tunable operational rules
    - Labels: Infrastructure, Feature | Done: 2026-03-14
  - **FFS-514**: V2.5 Phase 3b: Soft Blacklist Admin UI — manage blacklisted identifiers from browser
    - Labels: Frontend, Infrastructure, Data Quality | Done: 2026-03-14
  - **FFS-515**: V2.5 Phase 3c: Triage Flag Config — admin-definable data quality flags
    - Labels: Requests, Frontend, Feature | Done: 2026-03-14
  - **FFS-516**: V2.5 Phase 4a: Map Color Config — admin-tunable map layer colors
    - Labels: Frontend, Map, Feature | Done: 2026-03-14
  - **FFS-517**: V2.5 Phase 4b: Display Label Registry — admin-editable entity labels
    - Labels: Frontend, Feature | Done: 2026-03-14
  - **FFS-518**: V2.5 Phase 4c: Design Token Overrides — white-label brand customization
    - Labels: Frontend, Feature | Done: 2026-03-14
  - **FFS-519**: V2.5 Phase 5a: Print Form Layout Builder — JSON-driven print page layouts
    - Labels: Form System, Print Documents, Frontend, Feature | Done: 2026-03-13
  - **FFS-534**: Staff management system — seed roster + person-linked add flow
    - Labels: Frontend, API, Feature | Done: 2026-03-14

### FFS-521: Epic: Identity Resolution Hardening — consolidate fragmented dedup system
- **Priority:** High | **Labels:** Entity Linking, Infrastructure, Data Quality
- **Created:** 2026-03-13 | **Completed:** 2026-03-14
- **Children:** 8

  - **FFS-520**: Data gap: SCAS (Sonoma County Animal Services) misclassified as person — inflates cat counts at 5050
    - Labels: Clinic, Entity Linking, Data Quality | Done: 2026-03-13
  - **FFS-522**: Add org abbreviations to ref.business_keywords + fix SCAS at 5050 Algiers Ave
    - Labels: Clinic, Entity Linking, Data Quality | Done: 2026-03-13
  - **FFS-523**: Audit high-volume persons (>20 cats) — flag potential orgs and trappers
    - Labels: Entity Linking, Data Quality | Done: 2026-03-13
  - **FFS-524**: Populate household grouping system — batch job for sot.households
    - Labels: Entity Linking, Infrastructure, Data Quality | Done: 2026-03-13
  - **FFS-525**: Add name frequency weighting to identity scoring
    - Labels: Entity Linking, Infrastructure | Done: 2026-03-13
  - **FFS-526**: Extend hub identifier demotion to emails (mirror phone hub demotion)
    - Labels: Entity Linking, Infrastructure, Data Quality | Done: 2026-03-13
  - **FFS-527**: Auto-enrich skeleton persons when identifiers arrive
    - Labels: Entity Linking, Infrastructure | Done: 2026-03-13
  - **FFS-528**: Make identity match thresholds configurable via app_config
    - Labels: Entity Linking, Infrastructure | Done: 2026-03-14

### FFS-529: Epic: Trapper Management System — V2
- **Priority:** High | **Labels:** Volunteers, Frontend, Feature
- **Created:** 2026-03-13 | **Completed:** 2026-03-15
- **Children:** 10

  - **FFS-530**: Trapper service area management UI
    - Labels: Volunteers, Frontend, Feature | Done: 2026-03-14
  - **FFS-531**: Trapper → request matching suggestions
    - Labels: Volunteers, Feature | Done: 2026-03-14
  - **FFS-532**: Surface trapper contract and availability on profile
    - Labels: Volunteers, Frontend | Done: 2026-03-14
  - **FFS-533**: Trapper workload dashboard — active assignments, trends, capacity
    - Labels: Volunteers, Frontend, Feature | Done: 2026-03-14
  - **FFS-565**: Trapper territory map — visual coverage, gaps, and overlap
  - **FFS-566**: Smart trapper dispatch — auto-rank best matches for requests
  - **FFS-567**: Trapper contact actions & activity journal
  - **FFS-568**: Trapper roster UX polish — batch actions, export, keyboard nav
  - **FFS-569**: Trapper contract & certification management
  - **FFS-570**: Trapper performance reports — printable summary & volunteer hours

### FFS-550: Epic: Atlas 2.5 Test Suite Redesign
- **Priority:** High | **Labels:** DX, Infrastructure, E2E Tests
- **Created:** 2026-03-14 | **Completed:** 2026-03-15
- **Children:** 8

  - **FFS-551**: Phase 0: Test infrastructure & result archiving
    - Labels: DX, Infrastructure, E2E Tests | Done: 2026-03-14
  - **FFS-552**: Phase 1: Fix 157 broken E2E tests
    - Labels: Frontend, E2E Tests | Done: 2026-03-14
  - **FFS-553**: Phase 2: Visual regression baseline update
    - Labels: Frontend, E2E Tests | Done: 2026-03-15
  - **FFS-554**: Phase 3: Test modernization — categories, unit tests, Tippy archiving
    - Labels: DX, Infrastructure, E2E Tests | Done: 2026-03-15
  - **FFS-555**: Phase 4: New test coverage for Atlas 2.5 features
    - Labels: Beacon, E2E Tests, Feature | Done: 2026-03-15
  - **FFS-556**: Phase 5: CI/CD integration & test monitoring
    - Labels: DX, Infrastructure, E2E Tests | Done: 2026-03-15
  - **FFS-571**: Phase 1b: Fix 124 skipped non-Tippy E2E tests
    - Labels: Frontend, E2E Tests | Done: 2026-03-15
  - **FFS-575**: E2E: Trapper V2 test coverage
    - Labels: Frontend, E2E Tests | Done: 2026-03-14

### FFS-557: (parent FFS-557 not in Done set — may be in Backlog)
- **Priority:** ? | **Labels:** ?
- **Created:** ? | **Completed:** ?
- **Children:** 5

  - **FFS-558**: Import Potential Trappers from Airtable (27 records)
  - **FFS-559**: Atlas Kitten Assessment System — evidence-based triage tool
  - **FFS-561**: Build equipment checkout tracking module
  - **FFS-562**: Build foster management workflow in Atlas
  - **FFS-563**: Import foster data from Airtable (234 fosters + 259 contracts)

### FFS-571: Phase 1b: Fix 124 skipped non-Tippy E2E tests
- **Priority:** High | **Labels:** Frontend, E2E Tests
- **Created:** 2026-03-14 | **Completed:** 2026-03-15
- **Children:** 3

  - **FFS-572**: Create 16 missing /api/health/* endpoints (55 skipped tests)
    - Labels: E2E Tests | Done: 2026-03-15
  - **FFS-573**: Fix 40 skipped tests that skip on empty data instead of passing
    - Labels: Frontend, E2E Tests | Done: 2026-03-15
  - **FFS-574**: Fix 25 skipped UI tests — find correct Atlas 2.5 elements
    - Labels: Frontend, E2E Tests | Done: 2026-03-15

### FFS-577: Epic: E2E Write-Operation & Workflow Testing
- **Priority:** High | **Labels:** DX, Infrastructure, E2E Tests
- **Created:** 2026-03-15 | **Completed:** 2026-03-16
- **Children:** 5

  - **FFS-578**: Phase 1: Test infrastructure — auth setup, teardown, write-capture helper
    - Labels: Infrastructure, E2E Tests | Done: 2026-03-16
  - **FFS-579**: Phase 2: Request lifecycle E2E — status transitions, edit+save, trapper assignment
    - Labels: Requests, E2E Tests | Done: 2026-03-16
  - **FFS-580**: Phase 3: Person workflow E2E — create, edit, role promote/demote
    - Labels: Frontend, E2E Tests | Done: 2026-03-16
  - **FFS-581**: Phase 4: Entity edit E2E — cat, place, intake conversion workflows
    - Labels: Frontend, E2E Tests | Done: 2026-03-16
  - **FFS-582**: Phase 5: Click-through navigation E2E — list→detail, cross-entity, breadcrumbs
    - Labels: Frontend, E2E Tests | Done: 2026-03-16

### FFS-587: Epic: E2E Test Failure Remediation — 513 failures across 46 spec files
- **Priority:** Urgent | **Labels:** Mar 2026, Critical, E2E Tests
- **Created:** 2026-03-16 | **Completed:** 2026-03-16
- **Children:** 12

  - **FFS-588**: Missing DB tables: staff_reminders, staff_messages, staff_lookups — blocks /me dashboard
    - Labels: Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-589**: Missing DB table + columns break all cat detail pages (cat_birth_events, mortality, movements)
    - Labels: Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-590**: Missing column: sot.places.source_created_at breaks all place detail pages
    - Labels: Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-591**: Missing column: appointments.appointment_source_category blocks 10+ health endpoints
    - Labels: API, Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-592**: Missing columns on form_field_definitions (display_order, options, is_custom) — blocks modular forms
    - Labels: Form System, Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-593**: Missing columns across health endpoints (microchip_id, kind, latitude, source_record_id, etc.)
    - Labels: API, Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-594**: Missing DB functions: find_duplicate_requests, detect_stuck_jobs, log_field_edit
    - Labels: API, Infrastructure, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-595**: API bug: health routes use wrong column name (canonical vs is_canonical)
    - Labels: API, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-596**: API bug: /api/trappers doesn't validate negative limit — returns 500
    - Labels: API, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-597**: Health endpoint timeout: /api/health/entity-linking hangs (30s+)
    - Labels: Performance, API, E2E Tests, Bug | Done: 2026-03-16
  - **FFS-598**: E2E test selector fixes: strict mode violations, CSS syntax errors, search navigation
    - Labels: E2E Tests, Bug | Done: 2026-03-16
  - **FFS-599**: Test teardown cleanup uses stale V1 table names (person_cat_relationships, web_intake_submissions)
    - Labels: DX, E2E Tests | Done: 2026-03-16

### FFS-602: Epic: Reusable List-Detail Management UX — Split View, Drawers, Hover Cards
- **Priority:** High | **Labels:** Frontend, Feature
- **Created:** 2026-03-16 | **Completed:** 2026-03-17
- **Children:** 5

  - **FFS-603**: Phase 1: ListDetailLayout + EntityPreviewPanel — reusable split-view system
    - Labels: Frontend, Feature | Done: 2026-03-20
  - **FFS-604**: Phase 2: ActionDrawer — reusable slide-over forms for quick entity management
    - Labels: Frontend, Feature | Done: 2026-03-20
  - **FFS-605**: Phase 3: Inline list actions — reusable row action menu + batch operations
    - Labels: Frontend, Feature | Done: 2026-03-20
  - **FFS-606**: Phase 4: Breadcrumbs + back navigation — reusable context preservation
    - Labels: Frontend, Feature | Done: 2026-03-20
  - **FFS-607**: Phase 5: EntityHoverCard — reusable cross-entity preview popovers
    - Labels: Frontend, Feature | Done: 2026-03-20

### FFS-608: Epic: Request Detail UX Overhaul — Inline Section Editing & Guided Workflows
- **Priority:** High | **Labels:** Helix Core
- **Created:** 2026-03-16 | **Completed:** 2026-03-20
- **Children:** 6

  - **FFS-609**: Phase 1: Extract RequestSection component and section config types
    - Labels: Requests, Frontend, Feature | Done: 2026-03-20
  - **FFS-610**: Phase 2: Harden UpdateRequestSchema, remove dead V1 fields, add missing PATCH handlers
    - Labels: Helix Core | Done: 2026-03-20
  - **FFS-611**: Phase 3: Add status-aware guided action bar to request detail
    - Labels: Requests, Frontend, Feature | Done: 2026-03-20
  - **FFS-612**: Phase 4: Rewrite request detail page with inline section editing
    - Labels: Requests, Frontend, Feature | Done: 2026-03-20
  - **FFS-613**: Phase 5: Add completion indicators and contextual help text
    - Labels: Requests, Frontend, Feature | Done: 2026-03-20
  - **FFS-614**: Phase 6: Enforce valid status transitions in request edit UI
    - Labels: Requests, Frontend, Feature | Done: 2026-03-20

### FFS-616: (parent FFS-616 not in Done set — may be in Backlog)
- **Priority:** ? | **Labels:** ?
- **Created:** ? | **Completed:** ?
- **Children:** 7

  - **FFS-617**: Shared Pagination component
  - **FFS-618**: Shared Toast system + useToast hook
  - **FFS-619**: Extract shared StatCard component
  - **FFS-620**: Create useDebounce hook
  - **FFS-621**: Migrate inline tabs to shared TabBar (17+ pages)
  - **FFS-622**: Extract ReasonSelectionForm from request action modals
  - **FFS-623**: Dedup page framework — extract shared scaffold for 5 dedup pages

### FFS-627: Unified Entity Preview System
- **Priority:** High | **Labels:** Frontend, Infrastructure
- **Created:** 2026-03-16 | **Completed:** 2026-03-16
- **Children:** 5

  - **FFS-628**: Consolidate preview data layer — single useEntityDetail hook
    - Labels: Frontend, Infrastructure | Done: 2026-03-16
  - **FFS-629**: Flesh out entity preview renderers with TNR-relevant fields
    - Labels: Frontend | Done: 2026-03-16
  - **FFS-630**: Replace EntityHoverCard with unified EntityPreview across app
    - Labels: Frontend | Done: 2026-03-16
  - **FFS-631**: Add entity-specific panel content components (Cat, Person, Place, Request)
    - Labels: Frontend | Done: 2026-03-16
  - **FFS-632**: Wire panel previews into list pages (split-view on row click)
    - Labels: Frontend | Done: 2026-03-16

### FFS-634: Epic: Atlas V2.6 — System Resilience & Audit Infrastructure
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-16 | **Completed:** 2026-03-19
- **Children:** 16

  - **FFS-635**: Admin config change history table (ops.app_config_history)
    - Labels: Infrastructure, Data Quality | Done: 2026-03-16
  - **FFS-636**: Request status transition history table
    - Labels: Requests, Data Quality | Done: 2026-03-16
  - **FFS-637**: Replace hard deletes with soft deletes (colonies, lifecycle events)
    - Labels: Infrastructure, Data Quality | Done: 2026-03-16
  - **FFS-638**: Audit trail for admin verification toggle + relationship changes
    - Labels: API, Data Quality | Done: 2026-03-16
  - **FFS-639**: Extract clinic addresses & org-specific values to app_config
    - Labels: Infrastructure, Data Quality | Done: 2026-03-16
  - **FFS-640**: Extract TNR/Beacon thresholds & confidence scores to app_config
    - Labels: Beacon, Infrastructure | Done: 2026-03-17
  - **FFS-641**: Centralize inline status string literals to enum imports
    - Labels: DX, API | Done: 2026-03-17
  - **FFS-642**: Adopt withErrorHandling() wrapper + transaction boundaries across API routes
    - Labels: API, Infrastructure | Done: 2026-03-19
  - **FFS-643**: JSONB schema validation for intake_extended_data & processing jobs
    - Labels: Infrastructure, Data Quality | Done: 2026-03-17
  - **FFS-644**: Add error states to data hooks (usePersonDetail, useAppConfig partial failures)
    - Labels: DX, Frontend | Done: 2026-03-19
  - **FFS-645**: Add source_system + updated_at to sot.addresses & relationship tables
    - Labels: Infrastructure, Data Quality | Done: 2026-03-19
  - **FFS-646**: Data extraction coverage monitoring view (source → SOT propagation)
    - Labels: Ingest, Data Quality | Done: 2026-03-19
  - **FFS-647**: Address change audit trail & consistency enforcement
    - Labels: Infrastructure, Data Quality | Done: 2026-03-19
  - **FFS-648**: Extract useListData<T> hook + API list query builder for entity list pages
    - Labels: DX, Frontend | Done: 2026-03-19
  - **FFS-649**: Extract useAsyncForm hook for modal/form loading+error boilerplate
    - Labels: DX, Frontend | Done: 2026-03-19
  - **FFS-651**: Add missing database indexes for frequently queried columns
    - Labels: Performance, Infrastructure | Done: 2026-03-16

### FFS-652: V1→V2 Documentation Schema Cleanup
- **Priority:** Medium | **Labels:** Mar 2026, Documentation, Infrastructure
- **Created:** 2026-03-16 | **Completed:** 2026-03-16
- **Children:** 6

  - **FFS-653**: Fix remaining stale refs in CLAUDE.md-referenced docs
    - Labels: Mar 2026, Documentation | Done: 2026-03-16
  - **FFS-654**: Update active developer & architecture docs (V1→V2 schema names)
    - Labels: DX, Documentation | Done: 2026-03-16
  - **FFS-655**: Update ops pipeline & runbook docs (V1→V2 schema names)
    - Labels: Documentation, Ingest | Done: 2026-03-16
  - **FFS-656**: Update visualization & diagram docs (V1→V2 schema names)
    - Labels: Documentation | Done: 2026-03-16
  - **FFS-657**: Update data quality & reference docs (V1→V2 schema names)
    - Labels: Documentation, Data Quality | Done: 2026-03-16
  - **FFS-658**: Update design & spec docs (V1→V2 schema names)
    - Labels: Documentation | Done: 2026-03-16

### FFS-662: UI Overhaul — ClinicHQ/Airtable-Inspired Redesign
- **Priority:** High | **Labels:** UI Overhaul, Frontend, Feature
- **Created:** 2026-03-17 | **Completed:** 2026-03-17
- **Children:** 19

  - **FFS-663**: P1: ToggleButtonGroup + FilterBar composable components
    - Labels: UI Overhaul, Frontend, Feature | Done: 2026-03-17
  - **FFS-664**: P1: DataTable — TanStack Table v8 wrapper with server-side pagination
    - Labels: UI Overhaul, Frontend, Feature | Done: 2026-03-17
  - **FFS-665**: P1: EntityDetailHeader — sticky header with condensed scroll mode
    - Labels: UI Overhaul, Frontend, Feature | Done: 2026-03-17
  - **FFS-666**: P1: SectionCard enhancements — variants + SectionGrid layout
    - Labels: UI Overhaul, Frontend, Feature | Done: 2026-03-17
  - **FFS-667**: P1: Design token consolidation — CSS variable references + namespacing
    - Labels: UI Overhaul, Frontend, Feature | Done: 2026-03-17
  - **FFS-668**: P2: Cats list — FilterBar + DataTable migration
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-669**: P2: People list — FilterBar + DataTable migration
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-670**: P2: Places list — FilterBar + DataTable migration
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-671**: P2: Requests list — FilterBar + DataTable + Kanban modernization
    - Labels: UI Overhaul, Requests, Frontend | Done: 2026-03-17
  - **FFS-672**: P2: Trappers list — FilterBar + DataTable migration
    - Labels: UI Overhaul, Volunteers, Frontend | Done: 2026-03-17
  - **FFS-673**: P2: Fosters list — FilterBar + DataTable migration
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-674**: P2: Intake queue table view — FilterBar + DataTable migration
    - Labels: UI Overhaul, Requests, Frontend | Done: 2026-03-20
  - **FFS-675**: P3: Cat detail — EntityDetailHeader + SectionGrid + two-column layout
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-676**: P3: Person detail — EntityDetailHeader + SectionGrid layout
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-677**: P3: Place detail — EntityDetailHeader + SectionGrid layout
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-678**: P3: Request detail — EntityDetailHeader + StatusSummaryRow + SectionGrid
    - Labels: UI Overhaul, Requests, Frontend | Done: 2026-03-20
  - **FFS-679**: P3: Trapper detail — EntityDetailHeader + SectionGrid layout
    - Labels: UI Overhaul, Volunteers, Frontend | Done: 2026-03-17
  - **FFS-680**: P4: Sidebar navigation — collapsible groups + notification badges
    - Labels: UI Overhaul, Frontend | Done: 2026-03-17
  - **FFS-681**: P4: Global search — ClinicHQ quick search enhancement
    - Labels: UI Overhaul, Search, Frontend | Done: 2026-03-17

### FFS-694: Epic: Helix Phase 0 — Architecture Blueprint
- **Priority:** High | **Labels:** Helix Core, Documentation
- **Created:** 2026-03-20 | **Completed:** 2026-03-20
- **Children:** 4

  - **FFS-695**: Create `docs/HELIX_ARCHITECTURE.md` — 3-layer kernel mapping
    - Labels: Helix Core, Documentation | Done: 2026-03-20
  - **FFS-696**: Create `docs/BEACON_COMPATIBILITY_SPEC.md` — data contracts for Firebase team
    - Labels: Helix Core, Documentation, Beacon | Done: 2026-03-20
  - **FFS-697**: Helix audit — scan for remaining centralization gaps and file tagged issues
    - Labels: Helix Core | Done: 2026-03-20
  - **FFS-698**: Add Helix design principles to CLAUDE.md
    - Labels: Helix Core, Documentation | Done: 2026-03-20

---

## Standalone Completed Issues

### Critical Bug Fixes (75)

- **FFS-173** [A]: Fix clinic notes API query path — notes invisible for accounts without appointment linkage
  - Labels: Clinic, API, Data Quality, Bug | Done: 2026-03-06
- **FFS-176** [A]: Dark mode: Fix white-on-white contrast issues on entity detail pages
  - Labels: Mar 2026, Frontend, Bug | Done: 2026-03-06
- **FFS-183** [A]: BUG: merge_person_into() crashes on communication_logs + jsonb cast
  - Labels: Mar 2026, Entity Linking, Bug | Done: 2026-03-06
- **FFS-185** [A]: Bug: classify_request_place trigger uses missing place_context_types
  - Labels: Data Quality, Bug | Done: 2026-03-06
- **FFS-206** [A]: Fix: Intake numeric fields use || null instead of ?? null (0 becomes null)
  - Labels: API, Bug | Done: 2026-03-06
- **FFS-207** [A]: Fix: Intake convert endpoint missing UUID validation
  - Labels: API, Bug | Done: 2026-03-06
- **FFS-208** [A]: BUG: Contact section shows 'No address set' despite linked places — relink_person_primary_address wr
  - Labels: Mar 2026, API, Data Quality, Bug | Done: 2026-03-07
- **FFS-209** [A]: BUG: Website Submissions shows 'failed to fetch' — apiSuccess wrapper not unwrapped
  - Labels: Mar 2026, Frontend, API, Bug | Done: 2026-03-08
- **FFS-213** [A]: Fix: convert_intake_to_request references nonexistent columns
  - Labels: Critical, Bug | Done: 2026-03-06
- **FFS-214** [A]: Fix: Intake decline endpoint uses wrong journal_entries columns
  - Labels: API, Bug | Done: 2026-03-06
- **FFS-215** [A]: Fix || null → ?? null on numeric/boolean fields across 10 API routes
- **FFS-216** [A]: Fix journal_entries column names across 3 API routes
- **FFS-223** [A]: Fix handleability enum mismatch in intake-schema.ts
- **FFS-229** [A]: Intake submissions do not create canonical sot.people records — v1 function never migrated
  - Labels: Bug | Done: 2026-03-06
- **FFS-234** [A]: Audit MIG_2841 backfill — verify person dedup quality and no non-real names in sot.people
  - Labels: Bug | Done: 2026-03-06
- **FFS-235** [A]: Fix should_be_person() org regex false positives — word boundaries + data cleanup
  - Labels: Bug | Done: 2026-03-06
- **FFS-236** [A]: Fix 5 self-merged person records (circular merge chains)
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
- **FFS-237** [A]: Flatten multi-hop merge chains (2 place chains, person_cat dangling FK)
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
- **FFS-245** [A]: Intake status route writes to non-existent legacy columns, breaking all status updates
  - Labels: Requests, Regression, Critical, Frontend, API, Bug | Done: 2026-03-06
- **FFS-246** [A]: Bug: FFS-191 feeding_frequency CHECK constraint violation from salvage script
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
- **FFS-247** [A]: Bug: Salvage script Phase A equipment import crashes — ops.equipment missing airtable_fields column
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
- **FFS-253** [A]: Dashboard: Light mode map tiles look wrong against dark popup styling
  - Labels: Frontend, Bug | Done: 2026-03-06
- **FFS-254** [A]: Bug: Request edit silently drops feeding_schedule edits (field name mismatch with PATCH route)
  - Labels: Mar 2026, Requests, API, Bug | Done: 2026-03-08
- **FFS-257** [A]: Bug: PATCH route silently drops feeding_schedule edits + UI uses wrong input type
  - Labels: Mar 2026, Requests, Bug | Done: 2026-03-06
- **FFS-261** [A]: Dashboard map: Fix cat count 0 + intake pins empty
  - Labels: Mar 2026, Frontend, Bug | Done: 2026-03-06
- **FFS-271** [A]: Fix `ops.find_or_create_request` signature mismatch breaking handoff
  - Labels: Bug | Done: 2026-03-06
- **FFS-277** [A]: AtlasMap: Auto-clear disease filters when switching away from Disease Risk
  - Labels: Frontend, Map, Bug | Done: 2026-03-06
- **FFS-285** [A]: Fix trappers sync — migrate from trapper.* to sot.*/ops.* schema
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-06
- **FFS-290** [A]: DATA_GAP_040: Harden entity linking functions — fix silent NULL updates and COALESCE fallbacks
  - Labels: Mar 2026, Entity Linking, Critical, Data Quality | Done: 2026-03-07
- **FFS-291** [A]: Requestors not linked to places — enrich_person_from_request() defined but never called
  - Labels: Mar 2026, Entity Linking, Data Quality, Bug | Done: 2026-03-07
- **FFS-292** [A]: DATA_GAP_059: Fix alteration rate display — distinguish known-altered from unknown
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-07
- **FFS-295** [A]: Fix enrich_person_from_request() — add base case for non-third-party requestors
  - Labels: Mar 2026, Entity Linking, Data Quality, Bug | Done: 2026-03-07
- **FFS-296** [A]: Wire enrich_person_from_request() into both request creation paths
  - Labels: Mar 2026, Entity Linking, Data Quality, Bug | Done: 2026-03-07
- **FFS-299** [A]: fix: Migrate all trapper.* schema references to v2 (sot/ops/source)
- **FFS-304** [A]: enrich_place_from_request() not called from POST /api/requests
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-07
- **FFS-305** [A]: link_appointments_to_requests() lost in V1→V2 migration — never called
  - Labels: Mar 2026, Entity Linking, Data Quality, Bug | Done: 2026-03-07
- **FFS-310** [A]: Fix ShelterLuv event processing + cat origin tracking
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-07
- **FFS-315** [A]: Fix V1→V2 link function overloads and constraints
- **FFS-316** [A]: Fix review queue deduplication — cron creates 26 duplicate rows every 15 min
- **FFS-323** [A]: Fix ShelterLuv animal processor microchip extraction + merge duplicates
  - Labels: Mar 2026, Ingest, Data Quality, Bug | Done: 2026-03-08
- **FFS-329** [A]: Fix ambiguous foster name matching using SL foster event data
  - Labels: Mar 2026, Entity Linking, Ingest, Data Quality | Done: 2026-03-13
- **FFS-330** [A]: Pipeline: process_shelterluv_animal should check all microchip positions
  - Labels: Mar 2026, Entity Linking, Ingest, Bug | Done: 2026-03-08
- **FFS-335** [A]: fix: merge_place_into() silently skipped intake_submissions and clinic_accounts during merges
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-08
- **FFS-341** [A]: Restore intake triage computation — 1,257 submissions with no triage scores
  - Labels: Requests, Regression, Critical | Done: 2026-03-08
- **FFS-370** [A]: fix: ops.clinic_days missing columns causing 500 errors
  - Labels: Mar 2026, Infrastructure, Bug | Done: 2026-03-09
- **FFS-371** [A]: fix: ops.clinic_day_entries missing columns and status constraint mismatch
  - Labels: Mar 2026, Infrastructure, Bug | Done: 2026-03-09
- **FFS-374** [A]: Fix MaxClientsInSessionMode pool exhaustion on photo upload
  - Labels: Mar 2026, Clinic, Critical, Infrastructure, Bug | Done: 2026-03-09
- **FFS-387** [A]: Fix entity linking + owner change detection errors blocking ingest
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-09
- **FFS-393** [A]: fix: Restore Kimberly Kiner request dropped during V1→V2 migration
  - Labels: Mar 2026, Data Quality, Bug | Done: 2026-03-09
- **FFS-439** [A]: Fix EntityPreview positioning for drawers/scrollable containers
  - Labels: Bug | Done: 2026-03-10
- **FFS-459** [A]: Fix Step 4 partial_failure in run_all_entity_linking
- **FFS-461** [A]: has_medical_concerns defaults to false — misrepresents "not asked" as "no concerns"
  - Labels: Requests, Frontend, API, Bug | Done: 2026-03-12
- **FFS-465** [A]: property_owner_phone nulled when owner linked via search
  - Labels: Requests, Frontend, Bug | Done: 2026-03-12
- **FFS-467** [A]: fix: Apply missing MIG_2901/2902/2903 SQL migrations blocking uploads
- **FFS-477** [A]: bug: Weight/age enrichment uses wrong file_upload_id — cross-file join broken
  - Labels: Regression, Ingest, Data Quality, Bug | Done: 2026-03-12
- **FFS-478** [A]: bug: is_positive_value() missing 'Unilateral' — 3 cryptorchid cases dropped
  - Labels: Ingest, Data Quality, Bug | Done: 2026-03-12
- **FFS-480** [A]: Bug: Handoff fails — missing kitten_assessment_status column on ops.requests
  - Labels: Mar 2026, Requests, Critical, Bug | Done: 2026-03-12
- **FFS-482** [A]: Bug: Handoff drops all place/trapping logistics data from original request
  - Labels: Mar 2026, Requests, Critical, Bug | Done: 2026-03-12
- **FFS-483** [A]: Bug: 7,294 duplicate clinic_accounts (39%) polluting search + future Beacon data
  - Labels: Mar 2026, Beacon, Search, Infrastructure, Data Quality, Bug | Done: 2026-03-13
- **FFS-484** [A]: Fix place creation flow: slow modal, failure, option mismatch
  - Labels: Form System, Requests, Frontend, Bug | Done: 2026-03-13
- **FFS-535**: Fix trapper tier misclassification — person_roles.trapper_type out of sync with profiles
- **FFS-584**: Fix: Port ops.staff_reminders table to V2 (MIG_2949)
  - Labels: Data Quality | Done: 2026-03-15
- **FFS-585**: Fix: Port appointment_source_category column + classification (MIG_2950)
  - Labels: Clinic, Data Quality | Done: 2026-03-15
- **FFS-586**: Fix: get_trapper_info() wrong column references (MIG_2951)
  - Labels: Bug | Done: 2026-03-15
- **FFS-600**: Fix: Port 11 missing V1 views/functions to V2 (MIG_2952-2954)
  - Labels: Data Quality, Bug | Done: 2026-03-16
- **FFS-601**: Fix: Create 25 stub admin/monitoring views preventing 500 errors (MIG_2955)
  - Labels: Data Quality, Bug | Done: 2026-03-16
- **FFS-615**: fix: entity_edits NOT NULL constraint violations in 5 routes
- **FFS-633**: fix: Handoff data corruption — wrong requester & place on Nancy→Chris handoff + id_value column bugs
  - Labels: Requests, API, Bug | Done: 2026-03-16
- **FFS-682**: fix: dark mode — replace ~170 remaining hardcoded grayscale text colors
  - Labels: UI Overhaul, Frontend | Done: 2026-03-18
- **FFS-683**: fix: dark mode — form borders (#ddd/#ccc) and selection state backgrounds
  - Labels: UI Overhaul, Frontend | Done: 2026-03-18
- **FFS-688**: PlaceResolver: slow suggestions + crash on fast typing
  - Labels: Performance, Frontend, Bug | Done: 2026-03-18
- **FFS-689**: Colony stats sidebar: 5000% coverage (double-multiplied percentage)
  - Labels: Frontend, Bug | Done: 2026-03-19
- **FFS-690**: Colony Assessment save fails: "Failed to update request"
  - Labels: Requests, Frontend, API, Bug | Done: 2026-03-19
- **FFS-691**: Print sheet: Important Notes missing "Pregnant" checkbox despite urgency_reasons containing it
  - Labels: Form System, Requests, Frontend, Bug | Done: 2026-03-20
- **FFS-693**: Bug: Intake decline sets invalid `submission_status = 'declined'` — should be `'rejected'`
  - Labels: Requests, API, Bug | Done: 2026-03-20

### Data Quality & Entity Linking (72)

- **FFS-156** [A]: Investigate: Business/place names stored as person records — classify_owner_name() gaps
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-171** [A]: Merge duplicate 777 Aston Ave places to fix Toni Lecompte attribution
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-174** [A]: Add ClinicHQ notes to map drawer and request detail page
  - Labels: Clinic, Frontend, Map, Feature | Done: 2026-03-06
- **FFS-184** [A]: Backfill resolved_at from Airtable 'Last Modified Case Status' field
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-06
- **FFS-186** [A]: Import Airtable Trapper-to-Request Assignments
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-187** [A]: Import Airtable Staff Assignments for Requests
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-188** [A]: Import Airtable Trapper Cases Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-189** [A]: Import Airtable Trapper Reports Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-190** [A]: Import Airtable Trapper Cats Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-191** [A]: Import Airtable Request Operational Fields (Fed, Condition, Counts)
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-192** [A]: Enrich Trapper Profiles from Airtable Trappers Table
  - Labels: Mar 2026, Volunteers, Data Quality | Done: 2026-03-06
- **FFS-193** [A]: Import Airtable Client "Do Not Contact" Flags
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-194** [A]: Import Airtable Common Trapping Locations
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-195** [A]: Import Airtable Place Contacts Junction Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-196** [A]: Import Airtable FFSC Calendar Events
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-197** [A]: Import Airtable Call Sheets Table
  - Labels: Mar 2026, Requests, Data Quality | Done: 2026-03-06
- **FFS-198** [A]: Import Airtable Kitten Intake Assessment Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-199** [A]: Import Missing Airtable Appointment Request Fields
  - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-06
- **FFS-201** [A]: Import Airtable Master Contacts Consent and Aliases
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-202** [A]: Import Airtable Events Timeline Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-203** [A]: Import Airtable Surrender Forms Table
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-205** [A]: Import Airtable Equipment and Trapper Skills Data
  - Labels: Mar 2026, Volunteers, Data Quality | Done: 2026-03-06
- **FFS-221** [A]: Backfill legacy request structured fields from notes via regex parsing
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-233** [A]: Add merged_into_*_id IS NULL filters to address and request queries
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-06
- **FFS-238** [A]: Backfill sot_address_id for 526 places missing address links
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-06
- **FFS-239** [A]: Optimize dedup candidate refresh functions (address + request timeout)
  - Labels: Mar 2026, Performance, Infrastructure, Data Quality | Done: 2026-03-06
- **FFS-240** [A]: 2,924 ClinicHQ cats with appointments but no place link
  - Labels: Mar 2026, Clinic, Entity Linking, Data Quality | Done: 2026-03-06
- **FFS-241** [A]: 595 groups of co-located places at identical coordinates need dedup review
  - Labels: Mar 2026, Data Quality | Done: 2026-03-08
- **FFS-242** [A]: Person dedup candidate table is empty — no refresh function exists
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-06
- **FFS-243** [A]: 9 requests linked to test place "999 Test Street" — clean up test data
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-244** [A]: 3,190 places with 3+ cats but no colony size estimate
  - Labels: Mar 2026, Beacon, Data Quality | Done: 2026-03-06
- **FFS-248** [A]: Harden airtable_salvage.mjs for idempotent re-runs across all phases
  - Labels: Mar 2026, Data Quality, Improvement | Done: 2026-03-06
- **FFS-255** [A]: Data quality: Clean 9 invalid feeding_frequency values from atlas_ui
  - Labels: Mar 2026, Data Quality | Done: 2026-03-07
- **FFS-258** [A]: Data cleanup: 9 invalid feeding_frequency values from atlas_ui
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-260** [A]: Classify FFSC program cats from ClinicHQ booking patterns
  - Labels: Mar 2026, Clinic, Entity Linking, Data Quality | Done: 2026-03-06
- **FFS-263** [A]: Match FFSC trapping site bookings to existing places
  - Labels: Mar 2026, Entity Linking, Data Quality, Improvement | Done: 2026-03-07
- **FFS-264** [A]: Add ffsc_program filter to entity linking skip logging
  - Labels: Mar 2026, Entity Linking, Data Quality, Improvement | Done: 2026-03-06
- **FFS-265** [A]: Cross-match FFSC foster cats with ShelterLuv foster records
  - Labels: Mar 2026, Clinic, Entity Linking, Improvement | Done: 2026-03-08
- **FFS-266** [A]: Add shelter_transfer classification for non-SCAS/RPAS shelters
  - Labels: Mar 2026, Clinic, Data Quality, Improvement | Done: 2026-03-06
- **FFS-283** [A]: Equipment ongoing sync from Airtable
  - Labels: Mar 2026, Data Quality | Done: 2026-03-06
- **FFS-284** [A]: Potential trappers pipeline — schema + sync from Airtable
  - Labels: Mar 2026, Volunteers, Data Quality | Done: 2026-03-06
- **FFS-289** [A]: Link shelter_transfer and rescue_transfer cats to receiving org places
  - Labels: Mar 2026, Entity Linking, Data Quality, Improvement | Done: 2026-03-07
- **FFS-293** [A]: Run place dedup candidate generation (MIG_2836)
  - Labels: Mar 2026, Data Quality, Improvement | Done: 2026-03-07
- **FFS-297** [A]: Backfill person_place relationships for all existing requests
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-07
- **FFS-298** [A]: Add requestor relationship selector to New Request and Intake forms
  - Labels: Mar 2026, Frontend, Data Quality, Feature | Done: 2026-03-07
- **FFS-300** [A]: ShelterLuv initial data sync (API key + full fetch)
  - Labels: Mar 2026, Data Quality | Done: 2026-03-07
- **FFS-301** [A]: Process ShelterLuv staged records into sot entities
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-07
- **FFS-302** [A]: Enrich cats with ShelterLuv photos, descriptions, and status tracking
  - Labels: Mar 2026, Data Quality, Improvement | Done: 2026-03-07
- **FFS-322** [A]: Place dedup batch auto-merge for high-confidence Tier 1 pairs
  - Labels: Mar 2026, Frontend, Data Quality | Done: 2026-03-08
- **FFS-336** [A]: Place data quality audit fixes (MIG_2875)
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-08
- **FFS-337**: Re-geocode 24 "Sonoma County, CA" addresses missing city
  - Labels: Infrastructure, Data Quality | Done: 2026-03-15
- **FFS-338** [A]: Place dedup staff review UI for Tier 1/2 candidates
  - Labels: Frontend, Data Quality | Done: 2026-03-13
- **FFS-339** [A]: ShelterLuv ingestion: extend should_be_person() gate to catch address-as-name
  - Labels: Mar 2026, Entity Linking, Ingest, Data Quality | Done: 2026-03-08
- **FFS-342** [A]: Restore household membership building — 237 households with 0 members
  - Labels: Entity Linking, Data Quality | Done: 2026-03-08
- **FFS-344** [A]: V1→V2 migration audit — comprehensive post-migration gap analysis
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-08
- **FFS-345** [A]: Dashboard county filter + place data quality fixes (MIG_2875)
  - Labels: Mar 2026, Frontend, API, Map, Data Quality, Improvement | Done: 2026-03-08
- **FFS-346** [A]: Improve place dedup: base_address column + unit stripping in normalize
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-08
- **FFS-372** [A]: Investigate 12,900 unmatched scrape records — missing from API appointment pipeline
  - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
- **FFS-375** [A]: Extract ClinicHQ animal IDs from heading and improve enrichment matching
  - Labels: Mar 2026, Clinic, Data Quality | Done: 2026-03-09
- **FFS-383** [A]: Data gap: Person-place over-linking from shared email/phone on ClinicHQ bookings
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-13
- **FFS-384** [A]: Data gap: Cathy/Cassie Thomson duplicate person — phone matching blocked by address check
  - Labels: Mar 2026, Data Quality | Done: 2026-03-09
- **FFS-386** [A]: Data gap: Euthanasia-only cats not ingested from ClinicHQ + entity linking errors in March 2 batch
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-13
- **FFS-401** [A]: Ingest pipeline ignores ClinicHQ Death Type field — deceased cats not marked
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-09
- **FFS-416**: Align vocabulary with Shelter Animals Count (SAC) standards
  - Labels: Form System, Documentation, Data Quality | Done: 2026-03-15
- **FFS-449** [A]: Cat-place pollution: link_cats_to_places() staff exclusion misses trapper_profiles
  - Labels: Mar 2026, Infrastructure, Data Quality | Done: 2026-03-11
- **FFS-451** [A]: Cassie Thomson (FFSC trapper) misclassified as resident at trapping locations
  - Labels: Mar 2026, Data Quality | Done: 2026-03-13
- **FFS-452** [A]: Duplicate place records: ~4 unmerged entries for Stony Point Rd
  - Labels: Mar 2026, Data Quality | Done: 2026-03-13
- **FFS-453** [A]: Bulk fix: All known trappers still marked as 'resident' at trapping sites
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-11
- **FFS-454** [A]: Bulk cleanup: Delete false cat-place links from ALL known trappers (not just Marie)
  - Labels: Mar 2026, Entity Linking, Data Quality | Done: 2026-03-11
- **FFS-501** [A]: Cleanup: Archive deprecated ingest scripts + remove stale V1 references
  - Labels: Ingest, Infrastructure | Done: 2026-03-13
- **FFS-546**: Dormant trapper detection — alert for trappers inactive 90+ days
  - Labels: Volunteers, Data Quality, Feature | Done: 2026-03-14
- **FFS-547**: Service area conflict detection — warn when place assigned to multiple trappers
  - Labels: Volunteers, Data Quality, Improvement | Done: 2026-03-14

### Frontend & UI (47)

- **FFS-177** [A]: Entity preview modal: Abbreviated entity view on click within detail pages
  - Labels: Frontend, Improvement, Feature | Done: 2026-03-06
- **FFS-210** [A]: Add 'earliest date seen' to person/place/cat detail pages
  - Labels: Mar 2026, Frontend, API, Feature | Done: 2026-03-08
- **FFS-211** [A]: Wire entity preview modal to all linked entity clicks (cats, places, people) across detail pages
  - Labels: Mar 2026, Frontend, Feature | Done: 2026-03-06
- **FFS-212** [A]: Improve linked entity display density on detail pages
  - Labels: Frontend, Feature | Done: 2026-03-08
- **FFS-224** [A]: Intake Kanban: Drag-and-drop status changes + contact info on cards
  - Labels: Mar 2026, Frontend, Feature | Done: 2026-03-06
- **FFS-225** [A]: Intake Kanban: Add keyboard accessibility for drag-and-drop
  - Labels: Frontend, Improvement | Done: 2026-03-08
- **FFS-226** [A]: Intake Kanban: Add drag-and-drop to mobile accordion view
  - Labels: Frontend, Improvement | Done: 2026-03-08
- **FFS-227** [A]: Person page: wire LinkedCatsSection and LinkedPlacesSection to preview modal
  - Labels: Frontend, Feature | Done: 2026-03-06
- **FFS-228** [A]: EntityPreviewModal: support request entity type for place page cross-links
  - Labels: Frontend, Feature | Done: 2026-03-06
- **FFS-249** [A]: Dashboard Redesign: Map-Centric Command Center
  - Labels: Mar 2026, Frontend, Feature | Done: 2026-03-06
- **FFS-250** [A]: Dashboard map: Add marker clustering for dense pin areas
  - Labels: Frontend, Improvement | Done: 2026-03-06
- **FFS-251** [A]: Dashboard: Add intake pins as separate map layer
  - Labels: Frontend, Feature | Done: 2026-03-06
- **FFS-252** [A]: Dashboard KPI: Cats metric shows partial month vs full month comparison
  - Labels: Frontend, Improvement | Done: 2026-03-06
- **FFS-256** [A]: Remove feeding_schedule alias, standardize on feeding_frequency across request system
  - Labels: Mar 2026, Requests, Frontend, API, Improvement | Done: 2026-03-08
- **FFS-262** [A]: Dashboard: Grouped layer controls + Atlas pins integration
  - Labels: Mar 2026, Frontend, Map, Feature | Done: 2026-03-06
- **FFS-267** [A]: Full AtlasMap: Adopt GroupedLayerControl component
  - Labels: Frontend, Map, Improvement | Done: 2026-03-06
- **FFS-269** [A]: Dashboard map: Persist layer state in URL params
  - Labels: Frontend, Improvement | Done: 2026-03-06
- **FFS-270** [A]: Dashboard map: Mobile-responsive grouped layer control
  - Labels: Frontend, Improvement | Done: 2026-03-06
- **FFS-276** [A]: AtlasMap: Persist layer state in URL params
  - Labels: Frontend, Map, Improvement | Done: 2026-03-06
- **FFS-278** [A]: AtlasMap: Memoize per-sub-layer counts in GroupedLayerControl
  - Labels: Performance, Frontend, Map | Done: 2026-03-06
- **FFS-282** [A]: Person suggestion system — proactive duplicate prevention via email/phone
  - Labels: Mar 2026, Frontend, API, Feature | Done: 2026-03-07
- **FFS-286** [A]: Add PersonSuggestionBanner to RedirectRequestModal
  - Labels: Mar 2026, Frontend, Improvement | Done: 2026-03-07
- **FFS-287** [A]: Replace inline email dupe check with PersonSuggestionBanner on New Request page
  - Labels: Mar 2026, Frontend, Improvement | Done: 2026-03-07
- **FFS-288** [A]: Add PersonSuggestionBanner to staff New Intake Entry page
  - Labels: Mar 2026, Frontend, Improvement | Done: 2026-03-07
- **FFS-340** [A]: Search & entity rendering: activity signals at a glance
  - Labels: Mar 2026, Search, Frontend, API, Feature | Done: 2026-03-08
- **FFS-343** [A]: Activity signals: list pages, map drawers, and search request cards
  - Labels: Mar 2026, Search, Frontend, API, Map, Improvement | Done: 2026-03-08
- **FFS-347** [A]: Show last_appointment_date on cat detail page and CatDetailDrawer
  - Labels: Mar 2026, Frontend, Improvement | Done: 2026-03-13
- **FFS-348** [A]: Surface last activity date on request list cards
  - Labels: Mar 2026, Requests, Frontend, API, Improvement | Done: 2026-03-13
- **FFS-349** [A]: Activity signal gaps: place detail, request detail place, admin orgs, map popup
  - Labels: Mar 2026, Frontend, Improvement | Done: 2026-03-13
- **FFS-388** [A]: Display altered status and altered_by on cat detail page and CatDetailDrawer
  - Labels: Mar 2026, Frontend | Done: 2026-03-10
- **FFS-389** [A]: Display ownership type on cat detail page and CatDetailDrawer
  - Labels: Mar 2026, Frontend | Done: 2026-03-10
- **FFS-390** [A]: Display cat colors (primary/secondary) on cat detail page and CatDetailDrawer
  - Labels: Mar 2026, Frontend | Done: 2026-03-10
- **FFS-391** [A]: Display breed and coat length on cat detail page
  - Labels: Mar 2026, Frontend | Done: 2026-03-10
- **FFS-400** [A]: Unify print documents: trapper sheet, intake form, request print
  - Labels: Print Documents, Frontend, Improvement | Done: 2026-03-09
- **FFS-455** [A]: Optimize request creation form — contact roles, property type sync, animated disclosure
  - Labels: Mar 2026, Requests, Frontend | Done: 2026-03-11
- **FFS-458** [A]: Add expandable-section animations to modal toggle sections
  - Labels: Frontend | Done: 2026-03-13
- **FFS-462** [A]: has_property_access has no form UI — always NULL
  - Labels: Requests, Frontend, Improvement | Done: 2026-03-12
- **FFS-463** [A]: total_cats_reported has no form UI — colony size never captured
  - Labels: Requests, Frontend, Improvement | Done: 2026-03-12
- **FFS-464** [A]: cat_name has no form UI — single-cat requests can't record name
  - Labels: Requests, Frontend, Improvement | Done: 2026-03-12
- **FFS-481** [A]: Feat: Integrate direct person creation into handoff modal
  - Labels: Mar 2026, Requests, Frontend, Feature | Done: 2026-03-12
- **FFS-541**: Trapper roster: Add contact info, search, and card view
  - Labels: Volunteers, Frontend, Improvement | Done: 2026-03-14
- **FFS-542**: Replace inline status/type dropdowns with confirmation modals
  - Labels: Volunteers, Frontend, Improvement | Done: 2026-03-14
- **FFS-543**: Add trapper availability status (Available / Busy / On Leave)
  - Labels: Volunteers, Frontend, Feature | Done: 2026-03-14
- **FFS-544**: Trapper detail: Show certification date, assignment history, and map of service areas
  - Labels: Volunteers, Frontend, Improvement | Done: 2026-03-14
- **FFS-545**: Staff directory: Add search, role filter chips, and contact quick-actions
  - Labels: Frontend, Improvement | Done: 2026-03-14
- **FFS-548**: Trapper status/type change audit trail visible in UI
  - Labels: Volunteers, Frontend, Feature | Done: 2026-03-14
- **FFS-576**: Modular person management architecture — config-driven PersonDetailShell
  - Labels: Frontend, Improvement | Done: 2026-03-14

### Infrastructure & DevOps (1)

- **FFS-442** [A]: Wire up site_contact_person_id: UI, PATCH handler, and view update
  - Labels: Mar 2026, Infrastructure | Done: 2026-03-10

### Beacon & Analytics (4)

- **FFS-538**: Beacon Data Layer — SQL views + API for P0 analytics features
  - Labels: Beacon, API, Infrastructure | Done: 2026-03-14
- **FFS-539**: Trapper Management V2 Completion + Beacon Map Frontend
  - Labels: Volunteers, Beacon, Frontend, Feature | Done: 2026-03-14
- **FFS-540**: Git Integration + Test Suite + Beacon MVP Page Wiring
  - Labels: Beacon, Frontend, Infrastructure | Done: 2026-03-14
- **FFS-549**: Beacon MVP Frontend — 7 issues (fullscreen, ecology tab, county rollup, date filter map, comparison,
  - Labels: Beacon, Frontend, Feature | Done: 2026-03-14

### White Label & Helix (4)

- **FFS-684**: feat: white-label — move org name, email, phone to ops.app_config
  - Labels: White Label, Frontend, Infrastructure | Done: 2026-03-18
- **FFS-685**: feat: white-label — move map center, bounds, county list to ops.app_config
  - Labels: Helix Core | Done: 2026-03-20
- **FFS-686**: feat: white-label — move soft blacklist emails/phones from constants.ts to database
  - Labels: Helix Core | Done: 2026-03-20
- **FFS-692**: Form option drift: 14 mismatches between creation, edit, and intake forms
  - Labels: Helix Core | Done: 2026-03-20

### Other (59)

- **FFS-175** [A]: Bug: Request form blocks submission when peak_count is 0
- **FFS-259** [A]: Standardize on feeding_frequency, remove feeding_schedule alias
  - Labels: Mar 2026, Requests, Improvement | Done: 2026-03-06
- **FFS-268** [A]: Backfill: Populate is_alteration column and re-geocode intake submissions
- **FFS-272** [A]: Add person role & property context to handoff modal
  - Labels: Improvement | Done: 2026-03-06
- **FFS-273** [A]: Wire V2 handoff fields through API → SQL
  - Labels: Improvement | Done: 2026-03-06
- **FFS-274** [A]: Reconcile PERSON_PLACE_ROLE enum with DB constraint values
  - Labels: Improvement | Done: 2026-03-08
- **FFS-275** [A]: Add E2E tests for request handoff flow
  - Labels: Improvement | Done: 2026-03-08
- **FFS-279** [A]: Do Not Contact warning banner on person detail page
  - Labels: Mar 2026 | Done: 2026-03-06
- **FFS-280** [A]: Trip Reports tab on request detail page
  - Labels: Mar 2026 | Done: 2026-03-06
- **FFS-281** [A]: Equipment inventory and checkout admin page
  - Labels: Mar 2026 | Done: 2026-03-06
- **FFS-294** [A]: DATA_GAP_027: Health check endpoints for automated monitoring
  - Labels: Mar 2026, API, Improvement | Done: 2026-03-07
- **FFS-303** [A]: Set up recurring ShelterLuv sync cron
  - Labels: Mar 2026, Improvement | Done: 2026-03-08
- **FFS-306** [A]: link_appointments_to_owners() missing from run_all_entity_linking()
- **FFS-307** [A]: check_entity_linking_health() never automated
- **FFS-308** [A]: POST /api/intake bypasses centralized find_or_create functions
- **FFS-309** [A]: convert_intake_to_request() drops 8+ intake fields silently
- **FFS-311** [A]: Display intake_extended_data on request detail page
- **FFS-312** [A]: Review queue UI for appointment-request fuzzy matches
- **FFS-313** [A]: Re-link entities with corrected confidence ranking
- **FFS-314** [A]: Phone-based appointment linking with address verification (INV-15)
- **FFS-317** [A]: Review queue bulk actions — Approve All / Dismiss All
- **FFS-318** [A]: Investigate 21% cat_place coverage gap — 9K cats without place links
- **FFS-319** [A]: Complete intake form relationship selector (FFS-298 Step 3)
- **FFS-320** [A]: Wire cat photo_url into API routes
- **FFS-321** [A]: Place dedup batch auto-merge for high-confidence Tier 1 pairs
- **FFS-325** [A]: Polish search results — hide technical field names from staff
- **FFS-326** [A]: Centralized display label registry for all enums
- **FFS-327** [A]: PlaceResolver: show Atlas matches inline with Google suggestions
- **FFS-328** [A]: Apply centralized labels to all place views and preview modals
- **FFS-419** [A]: Flow appointment boolean flags → observation tables during ingest
- **FFS-420** [A]: Sync sot.cats (weight/age/coat) from appointments during ingest
- **FFS-421** [A]: Add secondary_color param to find_or_create_cat_by_microchip
- **FFS-422** [A]: Swap intake print page to refactored v2 with shared field options
- **FFS-423** [A]: Create CatHealthBadges component
- **FFS-424** [A]: Extend cat list API + view with health summary
- **FFS-425** [A]: Add CatHealthBadges to cat list page
- **FFS-426** [A]: Add CatHealthBadges to CatDetailDrawer (map)
- **FFS-427** [A]: Enrich EntityPreviewContent CatPreview with health data
- **FFS-428** [A]: Add CatHealthBadges to LinkedCatsSection
- **FFS-429** [A]: Create PlaceRiskBadges component
- **FFS-430** [A]: Extend place list API with disease risk summary
- **FFS-431** [A]: Add PlaceRiskBadges to place list page
- **FFS-432** [A]: Enrich PlacePreview with disease risk
- **FFS-433** [A]: Add PlaceRiskBadges to LinkedPlacesSection
- **FFS-434** [A]: Create PersonStatusBadges component
- **FFS-435** [A]: Add PersonStatusBadges to people list + PersonDetailDrawer
- **FFS-436** [A]: Enrich PersonPreview with status data
- **FFS-437** [A]: Wire EntityPreview into all list tables
- **FFS-438** [A]: Wire EntityPreview into LinkedCats/Places/People sections
- **FFS-440** [A]: Add clinical condition + disease filter to cat list
- **FFS-441** [A]: Add disease risk filter to place list
- **FFS-460** [A]: Full person creation parity for Property Owner & Site Contact
- **FFS-466** [A]: is_emergency always false — derive from urgency_reasons in API
  - Labels: Requests, API, Improvement | Done: 2026-03-12
- **FFS-468** [A]: Missing trappers in trapper list — VH role sync gap
- **FFS-536**: Merge duplicate: Barb Gray / Barbara Gray (same VH trapper, 2 person records)
- **FFS-537**: v_trapper_full_stats view includes staff/coordinator roles — inflates trapper count
- **FFS-659**: Request page redesign — triage crash fix + status simplification + Kanban
- **FFS-660**: Intake call sheet field integration (Phase 2 from intake audit)
- **FFS-661**: Page redesigns — request, person, place detail pages (UI audit phases 3-6)

---

## Active Backlog (NOT archived — carried forward)

These issues remain in Linear for active work:

| ID | Priority | Title | Labels |
|----|----------|-------|--------|
| FFS-333 | Urgent | Security: Rotate V1 database password (exposed in git history) | Security |
| FFS-735 | High | ClinicHQ upload: validate file columns match expected source_table | Ingest, Data Quality, Bug |
| FFS-616 | Medium | UI Component Standardization — Extract & Reuse Patterns Across App | Helix Core |
| FFS-557 | Medium | Epic: Airtable Decommission | — |
| FFS-687 | Low | White-label: make trapper tiers and program terminology configurable | Helix Core |
| FFS-583 | Low | Phase 6: Additional unit tests — uuid, request-status, dataMasking | DX, E2E Tests |
| FFS-564 | Low | Jotform→Atlas sync base consolidation | — |
| FFS-560 | Low | Archive dead Airtable tables and document final state | — |
| FFS-324 | Low | Audit: 99 foster persons missing VolunteerHub foster role | Volunteers, Data Quality |
| FFS-381 | Low | Cross-reference scrape trapper field with sot.trapper_profiles | Clinic, Entity Linking |
| FFS-172 | Low | Complete ClinicHQ account scraping — repeatable extraction | Clinic, Ingest |

---

## Milestones Reached

| Milestone | Status | Key Epics |
|-----------|--------|-----------|
| Foundation Phase | Complete | FFS-200–400 range (initial build) |
| V2 Data Overhaul | Complete | FFS-11–19, identity resolution, entity linking |
| Features Phase | Complete | Map, Beacon, Journal, Trappers, Forms |
| API Standardization | Complete | apiSuccess/apiError across all routes |
| E2E Test Stabilization | Complete | FFS-550, FFS-577, FFS-587 (test suite overhaul) |
| Atlas V2.5 Admin Everything | Complete | FFS-506 (14 categories admin-editable) |
| Atlas V2.6 System Resilience | Complete | FFS-634 (16 children, audit infrastructure) |
| Identity Resolution Hardening | Complete | FFS-521 (8 children, dedup consolidated) |
| UI Overhaul | Complete | FFS-662 (19 children, ClinicHQ-inspired redesign) |
| Helix Phase 0 | Complete | FFS-694 (architecture blueprint for extraction) |
| Modular Request Forms | Complete | FFS-485 (15 children, section-based architecture) |
| Beacon MVP Backend | Complete | FFS-538 (SQL views + API for all P0 analytics) |
| Beacon MVP Frontend | Complete | FFS-549 (fullscreen, county rollup, scenarios) |

---

## Batch Archive — 2026-03-28

Added 111 completed issues from Linear (FFS-736 through FFS-954).
Covers: ingest pipeline fixes, Tippy V2 features, equipment kiosk, UX polish,
Beacon porting, Google Maps V2 migration, data quality audits, request form overhaul.

### FFS-736: Ingest pipeline: no transaction boundaries — mid-timeout leaves inconsistent data
- **Priority:** Urgent | **Labels:** Ingest, Infrastructure, Data Quality, Bug
- **Created:** 2026-03-24 | **Completed:** 2026-03-25

### FFS-737: Ingest pipeline: entity linking counters always show 0 (reporting bug)
- **Priority:** High | **Labels:** Ingest, Bug
- **Created:** 2026-03-24 | **Completed:** 2026-03-25

### FFS-738: Ingest pipeline: entity linking errors swallowed — cascading failures masked as non-fatal
- **Priority:** High | **Labels:** Ingest, Data Quality, Bug
- **Created:** 2026-03-24 | **Completed:** 2026-03-25

### FFS-739: Ingest pipeline: N+1 query pattern in staged records dedup loop
- **Priority:** Medium | **Labels:** Performance, Ingest
- **Created:** 2026-03-24 | **Completed:** 2026-03-25

### FFS-740: Ingest pipeline: batch retry doesn't recover gracefully from partial failures
- **Priority:** Medium | **Labels:** Ingest, Infrastructure
- **Created:** 2026-03-24 | **Completed:** 2026-03-25

### FFS-742: Tippy: Add streaming responses to prevent timeout on follow-ups
- **Priority:** High | **Labels:** Tippy, Frontend, API
- **Created:** 2026-03-25 | **Completed:** 2026-03-26

### FFS-743: Tippy: Increase max_tokens from 1024 to 2048
- **Priority:** Medium | **Labels:** Tippy, API
- **Created:** 2026-03-25 | **Completed:** 2026-03-26

### FFS-746: Ingest Dashboard — upload history, batch status, retry, processing phase visibility
- **Priority:** High | **Labels:** Ingest, Feature
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-747: inferred_place_id ignores owner_info address when org account has shared contact — 72 landfill cats mislinked to Roblar Road
- **Priority:** Urgent | **Labels:** Clinic, Entity Linking, Data Quality, Bug
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-748: Beacon porting: product context layer + branding cleanup
- **Priority:** High | **Labels:** Beacon Porting, Infrastructure
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-749: Beacon porting: inline hex colors → CSS variables (205 instances, 74 files)
- **Priority:** Medium | **Labels:** Beacon Porting
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-750: Beacon porting: map marker CSS classes use "atlas-" prefix
- **Priority:** Low | **Labels:** Beacon Porting
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-751: Reclassify misclassified org/site clinic accounts still typed as 'resident'
- **Priority:** High | **Labels:** Clinic, Entity Linking, Data Quality
- **Created:** 2026-03-25 | **Completed:** 2026-03-25

### FFS-754: Pre-flight data quality checks before Tippy responses
- **Priority:** High | **Labels:** Tippy, Data Quality
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-755: Shift-start briefing (auto on first chat of day)
- **Priority:** High | **Labels:** Tippy, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-756: `flag_anomaly` tool + admin review page
- **Priority:** Medium | **Labels:** Tippy, Data Quality, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-757: Seasonal & temporal context in all place responses
- **Priority:** Medium | **Labels:** Tippy, Beacon
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-758: Chapman population estimates + disease flags in place responses
- **Priority:** Medium | **Labels:** Tippy, Beacon, Data Quality
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-759: Onboarding mode — detect new staff, adjust depth
- **Priority:** Medium | **Labels:** Tippy, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-760: Anomaly → Linear issue pipeline
- **Priority:** Low | **Labels:** Tippy, DX, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-27

### FFS-761: Staff activity awareness (duplicate suggestion prevention)
- **Priority:** Low | **Labels:** Tippy, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-779: Epic: Equipment Kiosk — iPad/Phone-Optimized Forms + Print Checkout Sheet
- **Priority:** High | **Labels:** None
- **Created:** 2026-03-26 | **Completed:** 2026-03-26
- **Children:** 6

  - **FFS-780**: Wire MIG_2983 fields into equipment events API
    - Labels: None | Done: 2026-03-26
  - **FFS-785**: Kiosk Layout + Tab Bar + PWA Manifest
    - Labels: None | Done: 2026-03-26
  - **FFS-791**: Kiosk Scan Page + Checkout/Check-in Forms
    - Labels: None | Done: 2026-03-26
  - **FFS-792**: Kiosk Add Equipment Wizard
    - Labels: None | Done: 2026-03-26
  - **FFS-793**: Kiosk Inventory List
    - Labels: None | Done: 2026-03-26
  - **FFS-794**: Printable Equipment Checkout Form
    - Labels: None | Done: 2026-03-26

### FFS-781: Surface & elevation CSS tokens
- **Priority:** High | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-782: Shared Button component
- **Priority:** High | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-783: Skeleton loading adoption for Beacon pages
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-784: ConfirmDialog adoption (replace window.confirm)
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-786: Migrate inline toast state to useToast
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-795: Epic: Equipment Kiosk — Onboarding, Discovery & Resilience
- **Priority:** High | **Labels:** None
- **Created:** 2026-03-26 | **Completed:** 2026-03-26
- **Children:** 6

  - **FFS-796**: Kiosk Setup Guide Page — QR code, install detection, step-by-step walkthrough
    - Labels: UX Polish | Done: 2026-03-26
  - **FFS-797**: "Open Kiosk" button on equipment page + sidebar navigation link
    - Labels: UX Polish | Done: 2026-03-26
  - **FFS-798**: Kiosk network status indicator + offline shell
    - Labels: UX Polish | Done: 2026-03-26
  - **FFS-799**: Kiosk form auto-save on iOS backgrounding
    - Labels: UX Polish | Done: 2026-03-26
  - **FFS-800**: Printable kiosk setup card — one-pager to tape near iPad station
    - Labels: UX Polish | Done: 2026-03-26
  - **FFS-810**: Camera barcode scanning for iPad/phone kiosk
    - Labels: UX Polish | Done: 2026-03-26

### FFS-801: Tippy Eval Pipeline — Reliable, Cost-Effective AI Testing
- **Priority:** High | **Labels:** Tippy
- **Created:** 2026-03-26 | **Completed:** 2026-03-26
- **Children:** 7

  - **FFS-802**: Layer 1: Deterministic tool selection unit tests (no LLM calls)
    - Labels: Tippy | Done: 2026-03-26
  - **FFS-803**: Layer 2: VCR record/replay for Tippy integration tests
    - Labels: Tippy | Done: 2026-03-26
  - **FFS-805**: Cheap model for CI, production model for nightly eval runs
    - Labels: Tippy | Done: 2026-03-26
  - **FFS-806**: Retry + exponential backoff for Tippy real-api tests
    - Labels: Tippy | Done: 2026-03-26
  - **FFS-808**: Tippy: Pre-flight context should have a hard timeout (not block responses)
    - Labels: Tippy, Performance | Done: 2026-03-26
  - **FFS-809**: Tippy: Increase maxDuration to 120s and add per-phase time budgets
    - Labels: Tippy, Performance | Done: 2026-03-26
  - **FFS-811**: Tippy: Graceful degradation — never show "trouble connecting" for transient errors
    - Labels: Tippy | Done: 2026-03-26

### FFS-831: Volunteer page: dead href="#" on Ask Tippy QuickAction
- **Priority:** Low | **Labels:** Frontend, Bug
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-836: Map Revamp Phase 1: Search Perf, POI Search, Google Basemap, Measurement, Directions
- **Priority:** High | **Labels:** Performance, Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-837: Map: Layer toggle causes full re-render + no viewport culling
- **Priority:** High | **Labels:** Performance, Map
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-838: Map: Per-layer loading states (no feedback on layer toggle)
- **Priority:** High | **Labels:** UX Polish, Map
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-840: Map: Right-click context menu (directions, search nearby, measure)
- **Priority:** High | **Labels:** UX Polish, Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-841: Map: Saved views / bookmarks (persist layer + filter + zoom config)
- **Priority:** High | **Labels:** Beacon, Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-842: Map: Disease badges not filtered by recency + stale data issues
- **Priority:** High | **Labels:** Frontend, Map, Data Quality, Bug
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-843: Map: Heatmap / density overlay for cat population + activity
- **Priority:** High | **Labels:** Beacon, Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-844: Map: Export visible markers to CSV/GeoJSON
- **Priority:** High | **Labels:** Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-850: Collapsible sidebar sections
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-851: Settings hub + dashboard icon fix
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-852: Data Health hub + Tippy section + sidebar restructure
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-853: DB migration: admin sidebar restructure
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-854: Fix sync cron to protect Atlas kiosk changes
- **Priority:** Urgent | **Labels:** Ingest, API, Bug
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-855: Sync status endpoint + inventory page indicator
- **Priority:** High | **Labels:** Frontend, API, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-856: Photo thumbnails in equipment inventory + kiosk card
- **Priority:** High | **Labels:** UX Polish, Frontend, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-857: Category-colored type badges + size/variant display
- **Priority:** High | **Labels:** UX Polish, Frontend, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-858: Equipment transition banner + source badges
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Improvement
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-859: Equipment sync data integrity audit script
- **Priority:** Medium | **Labels:** Infrastructure, Data Quality, Improvement
- **Created:** 2026-03-26 | **Completed:** 2026-03-26

### FFS-863: Tippy: Conversation history sidebar in chat widget
- **Priority:** Medium | **Labels:** Tippy, Frontend, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-27

### FFS-864: Tippy: Cross-session per-user memory via conversation summaries
- **Priority:** Medium | **Labels:** Tippy, API, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-27

### FFS-865: Tippy: Clickable entity handoff links in responses
- **Priority:** Medium | **Labels:** Tippy, Frontend, Feature
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-866: Tippy: Context-aware quick action suggestions
- **Priority:** Medium | **Labels:** Tippy, Frontend, Feature
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-867: Tippy: Proactive operational anomaly detection
- **Priority:** Medium | **Labels:** Tippy, API, Feature
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-870: Install Google Maps + deck.gl packages, create AtlasMapV2 skeleton
- **Priority:** High | **Labels:** Frontend, Map, Infrastructure
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-871: Port atlas pin rendering to Google Maps AdvancedMarker + SuperCluster
- **Priority:** High | **Labels:** Performance, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-872: Port heatmap to Google Maps visualization.HeatmapLayer
- **Priority:** Medium | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-873: Port route polylines + bulk selection to Google Maps V2
- **Priority:** Medium | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-874: Replace HTML string popups with React InfoWindow components
- **Priority:** High | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-875: Port measurement tool to Google Maps Polyline + Marker
- **Priority:** Medium | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-876: Port context menu to Google Maps rightclick event
- **Priority:** Medium | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-877: Replace iframe Street View with native StreetViewPanorama
- **Priority:** Medium | **Labels:** Performance, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-878: Basemap switching on Google Maps (street/satellite/terrain)
- **Priority:** Low | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-882: Fix 79 appointment person_id divergence from clinic_accounts
- **Priority:** Urgent | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-883: Un-merge Altera Apartments: 7 people collapsed via shared phone
- **Priority:** Urgent | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-885: Fix 16 stale FKs to merged cats + patch merge_cats()
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-886: Merge 3 duplicate-format address places
- **Priority:** Medium | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-898: Create identifier cardinality monitoring view with auto-blacklist promotion
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-904: Schema: Add checkout_purpose + resolution tracking columns
- **Priority:** Urgent | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-905: Single-screen checkout form with purpose chips
- **Priority:** Urgent | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-906: Smart context API + auto-fill panel
- **Priority:** High | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-907: PersonReferencePicker: name split + phone-first + resolution type
- **Priority:** High | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-908: Tippy: Place search returns wrong address when multiple match on same street
- **Priority:** High | **Labels:** Tippy, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-911: Proactive alert queue + Slack/email notifications
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-912: Entity linking step orchestrator — break the timeout wall
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-913: Fix merge-duplicates cron + expand auto-resolution patterns
- **Priority:** High | **Labels:** Infrastructure, Data Quality, Bug
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-914: Booking role enum on clinic_accounts
- **Priority:** Medium | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-927: Equipment photo capture on Add + Check-In
- **Priority:** High | **Labels:** Equipment, Mar 2026, Frontend, Feature
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-928: Equipment events: photo_url column for condition documentation
- **Priority:** Medium | **Labels:** Equipment, Mar 2026, Infrastructure
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-930: Request form data quality guardrails — prevent missing requester/phone
- **Priority:** High | **Labels:** Requests, Frontend, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-28
- **Children:** 4

  - **FFS-931**: Hard + soft validation for phone entry mode
    - Labels: Requests, Frontend | Done: 2026-03-27
  - **FFS-932**: Detect phone numbers in free text fields and nudge to structured field
    - Labels: Requests, Frontend, Data Quality | Done: 2026-03-27
  - **FFS-933**: Section completeness indicators in step pills
    - Labels: UX Polish, Requests, Frontend | Done: 2026-03-28
  - **FFS-934**: Auto-generate summary fallback from address + cat count
    - Labels: Requests, Data Quality | Done: 2026-03-27

### FFS-935: Bug: data_engine_resolve_identity references non-existent ops.get_config_value
- **Priority:** Urgent | **Labels:** Infrastructure, Data Quality, Bug
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-940: Adoption context enrichment + adopter links backfill (MIG_3005)
- **Priority:** Medium | **Labels:** Ingest, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-03-27

### FFS-942: Google Maps V2: Tab freezes when using measurement tool
- **Priority:** Urgent | **Labels:** Frontend, Map, Bug
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-943: Google Maps V2: Pins don't match Leaflet V1 appearance
- **Priority:** High | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-944: Google Maps V2: Auth error dialog still appears (gm_authFailure suppression not working)
- **Priority:** Urgent | **Labels:** Frontend, Map, Bug
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-945: V2 Pins: Size hierarchy missing — all pins render at 32px
- **Priority:** High | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-946: V2 Pins: Reference tier not differentiated — ignores pin_tier from data
- **Priority:** High | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-947: V2 Pins: InfoWindow popup missing role badges, disease alerts, alteration stats
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-954: Request form UX overhaul — conversational layout, design system, promoted fields
- **Priority:** High | **Labels:** UX Polish, Requests, Frontend
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

---

## Backlog + In-Progress Snapshot — 2026-03-28

109 backlog issues + 4 in-progress preserved here
so they can be deleted from Linear to free space.
Re-create in Linear as needed when workspace limit is resolved.

### FFS-172: Complete ClinicHQ account scraping — repeatable extraction for all notes, tags, and client IDs
- **Priority:** Low | **Labels:** Clinic, Ingest, Data Quality, Feature
- **Created:** 2026-03-06 | **Completed:** N/A

### FFS-324: Audit: 99 foster persons missing VolunteerHub foster role
- **Priority:** Low | **Labels:** Mar 2026, Volunteers, Data Quality
- **Created:** 2026-03-08 | **Completed:** N/A

### FFS-333: Security: Rotate V1 database password (exposed in git history)
- **Priority:** Urgent | **Labels:** Mar 2026, Security
- **Created:** 2026-03-08 | **Completed:** N/A

### FFS-741: Cat color/pattern data not extracted from ClinicHQ to sot.cats
- **Priority:** High | **Labels:** Clinic, Ingest, Data Quality
- **Created:** 2026-03-25 | **Completed:** N/A

### FFS-744: Tippy: Add cat search by physical description (color, pattern, age)
- **Priority:** Medium | **Labels:** Tippy, Feature
- **Created:** 2026-03-25 | **Completed:** N/A

### FFS-745: Tippy: Optimize follow-up context to reduce token usage and latency
- **Priority:** Low | **Labels:** Tippy, Performance
- **Created:** 2026-03-25 | **Completed:** N/A

### FFS-752: Duplicate clinic_account rows created per appointment instead of deduping
- **Priority:** Low | **Labels:** Clinic, Ingest, Data Quality
- **Created:** 2026-03-25 | **Completed:** N/A

### FFS-753: Tippy V2 — Ambient Colleague
- **Priority:** High | **Labels:** Tippy, Feature
- **Created:** 2026-03-26 | **Completed:** N/A
- **Children:** 1

  - **FFS-909**: Tippy: "Coverage gaps" / data desert questions timeout on both demo and real paths
    - Labels: Tippy, Data Quality, Feature | Done: N/A

### FFS-762: Bug: Admin sidebar renders twice — layout wraps + pages wrap individually
- **Priority:** Urgent | **Labels:** UX Polish, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-763: Replace emoji icons with Lucide React icon library throughout app
- **Priority:** High | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-764: User-customizable page shortcuts / favorites
- **Priority:** High | **Labels:** UX Polish, Feature
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-765: Page transitions and micro-interactions — make navigation feel smooth
- **Priority:** Medium | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-766: Admin panel information architecture — reorganize 67 pages into logical tiers
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-767: Visual depth and surface hierarchy — cards, shadows, spacing consistency
- **Priority:** Medium | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-768: Typography and font system — align with FFSC brand, add visual hierarchy
- **Priority:** Medium | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-769: Requests page UX improvements — progressive disclosure, status swimlanes, contextual actions
- **Priority:** Medium | **Labels:** UX Polish, Feature
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-770: Surface & elevation CSS tokens — shadow system + card-elevated class
- **Priority:** High | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-771: Create shared Button component — replace 6,462 inline button styles
- **Priority:** High | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-772: Skeleton loading adoption for Beacon + high-traffic pages
- **Priority:** High | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-773: ConfirmDialog adoption — replace window.confirm() across 36 files
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-774: Migrate inline toast state to useToast hook (15+ files)
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-775: EmptyState adoption for list + admin pages
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-776: Skeleton loading system-wide — 89 files with 'Loading...' text
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-777: Inline style → design token migration (meta-issue, ongoing)
- **Priority:** Low | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-778: Breadcrumbs adoption for all entity detail pages
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-787: EmptyState adoption for list pages
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-788: Skeleton loading system-wide
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-789: Inline style → design token migration
- **Priority:** Low | **Labels:** UX Polish, Beacon Porting
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-790: Breadcrumbs adoption for all detail pages
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-804: Layer 3: LLM-as-judge quality scoring for Tippy responses
- **Priority:** Medium | **Labels:** Tippy
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-807: Golden dataset from production Tippy conversations
- **Priority:** Low | **Labels:** Tippy
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-812: Intake: Kanban should be default view, no way to persist preference
- **Priority:** High | **Labels:** UX Polish, Requests, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-813: Intake: Cards view is unusable, needs redesign or removal
- **Priority:** Low | **Labels:** UX Polish, Requests
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-814: Intake: Active/Scheduled/Completed tabs redundant with Kanban view
- **Priority:** Medium | **Labels:** UX Polish, Requests, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-815: Nav/pagination buttons hard to read in light/dark mode
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-816: Cat records page: poor list UX — filters too tall, no inline details
- **Priority:** High | **Labels:** UX Polish, Frontend, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-817: Audit: Dead links in Beacon DataTables and across app
- **Priority:** High | **Labels:** Beacon, Frontend, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-818: Clinic Days: Barcode scanner result bounces back to all results
- **Priority:** High | **Labels:** UX Polish, Clinic, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-819: Clinic Days: Cat details missing (color, sex, weight, notes)
- **Priority:** Medium | **Labels:** UX Polish, Clinic, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-820: WCAG contrast failures: disabled states use opacity reduction
- **Priority:** High | **Labels:** UX Polish, Frontend, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-821: Hardcoded hex colors break dark mode across UI components
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-822: Request detail: tabs don't persist in URL, missing breadcrumbs
- **Priority:** Low | **Labels:** UX Polish, Requests
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-823: Fosters page: missing ListDetailLayout and preview panel
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-824: 26 pages use "Loading..." text instead of Skeleton components
- **Priority:** Medium | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-825: 27 confirmations use window.confirm() instead of ConfirmDialog
- **Priority:** Medium | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-826: 20+ pages use alert() for errors instead of toast/styled messages
- **Priority:** Low | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-827: Print pages hardcode "Atlas" instead of useProduct().brandName
- **Priority:** Medium | **Labels:** Beacon Porting, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-828: Kiosk barcode scan: race conditions, no debounce between scans
- **Priority:** High | **Labels:** UX Polish, Clinic, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-829: CatCard missing secondary color — staff can't confirm cat identity
- **Priority:** Medium | **Labels:** UX Polish, Clinic, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-830: Clinic days search: no debounce, race conditions on photo upload
- **Priority:** Medium | **Labels:** Clinic, Performance, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-832: Admin pages: fixed grid layouts not mobile responsive
- **Priority:** Low | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-833: Missing accessibility: ~200 aria-labels needed, keyboard nav gaps
- **Priority:** Low | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-834: KioskEquipmentCard missing fields: history, location, notes
- **Priority:** Medium | **Labels:** UX Polish, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-835: Camera scanner: no recovery path when permission denied
- **Priority:** Low | **Labels:** UX Polish, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-839: Map: Bulk select + assign from map (multi-place actions)
- **Priority:** High | **Labels:** Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-845: Map: Mobile layout optimization (bottom sheet, collapsed controls)
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-846: Map: Accessibility — keyboard nav, ARIA labels, help modal
- **Priority:** Medium | **Labels:** Frontend, Map, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-847: Map: Code quality — extract popups, reduce refs, add error boundary
- **Priority:** Low | **Labels:** Frontend, Map, Improvement
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-848: Map: Search result pagination + "Show more" + search history
- **Priority:** Medium | **Labels:** UX Polish, Search, Map
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-849: Map: Route optimization for multi-place trapping visits
- **Priority:** Low | **Labels:** Map, Feature
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-860: Phone contamination: Gordon Maxwell appointments misattributed to Susan Simons
- **Priority:** High | **Labels:** Entity Linking, Ingest, Data Quality
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-861: Broken recheck pattern detection: 12 duplicate cats from embedded microchips in name
- **Priority:** Urgent | **Labels:** Clinic, Ingest, Data Quality, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-862: ClinicHQ cancel/rebook: cats missing from original clinic day
- **Priority:** High | **Labels:** Clinic, Ingest, Data Quality, Bug
- **Created:** 2026-03-26 | **Completed:** N/A

### FFS-868: Epic: Migrate map from Leaflet to Google Maps JS API + deck.gl
- **Priority:** High | **Labels:** Frontend, Map, Infrastructure
- **Created:** 2026-03-27 | **Completed:** N/A
- **Children:** 12

  - **FFS-869**: Set up Google Maps cloud styling + Map ID
    - Labels: Map, Infrastructure | Done: N/A
  - **FFS-879**: Remove Leaflet dependencies and dead code
    - Labels: Map, Infrastructure | Done: N/A
  - **FFS-888**: Google Maps V2: Smoke test all features before making default
    - Labels: Frontend, Map | Done: N/A
  - **FFS-889**: Make Google Maps V2 the default map (remove Leaflet toggle)
    - Labels: Frontend, Map | Done: N/A
  - **FFS-890**: Google Maps V2: Performance test at 3K+ pins — evaluate deck.gl need
    - Labels: Performance, Frontend, Map | Done: N/A
  - **FFS-891**: Google Maps V2: Zone boundaries + trapper territory rendering
    - Labels: Frontend, Map | Done: N/A
  - **FFS-948**: V2 Map: Render Volunteers layer markers
    - Labels: Frontend, Map | Done: N/A
  - **FFS-949**: V2 Map: Render Places (cat locations) layer markers
    - Labels: Frontend, Map | Done: N/A
  - **FFS-950**: V2 Map: Render Google Pins layer markers
    - Labels: Frontend, Map | Done: N/A
  - **FFS-951**: V2 Map: Render Clinic Clients layer markers
    - Labels: Frontend, Map | Done: N/A
  - **FFS-952**: V2 Map: Render Trapper Territory polygons
    - Labels: Frontend, Map | Done: N/A
  - **FFS-953**: V2 Map: Render Service Zone boundary polygons
    - Labels: Frontend, Map | Done: N/A

### FFS-880: Structured equipment checkout flow with smart defaults + freeform fallback
- **Priority:** High | **Labels:** UX Polish, Frontend, Feature
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-881: ClinicHQ Data Quality Audit Remediation
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A
- **Children:** 7

  - **FFS-884**: Review 33 phone-only name mismatches (pre-address-guard)
    - Labels: Data Quality | Done: N/A
  - **FFS-887**: Re-run March batch + investigate person-cat evidence gaps
    - Labels: Data Quality | Done: N/A
  - **FFS-892**: Audit Round 2: SCAS phone blacklist + 5 person splits + stale cleanup
    - Labels: Data Quality | Done: N/A
  - **FFS-893**: Email address guard: extend MIG_2990 pattern to email-based lookups
    - Labels: Data Quality | Done: N/A
  - **FFS-894**: Deduplicate 124 clinic accounts (57 same-name+phone groups)
    - Labels: Data Quality | Done: N/A
  - **FFS-895**: Add cleanup_stale_person_cat_links() to entity linking pipeline
    - Labels: Data Quality | Done: N/A
  - **FFS-896**: Review Kayla Barrera with staff: community trapper or wrong merge?
    - Labels: Data Quality | Done: N/A

### FFS-897: Add booking_role enum to appointments for role-aware identity resolution
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-899: Add stale_since timestamp to derived linking tables for trigger-based invalidation
- **Priority:** Medium | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-900: Add valid evidence combinations table to prevent evidence type mislabeling
- **Priority:** Medium | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-901: Create source_authority table formalizing source-system trust per attribute
- **Priority:** Low | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-902: Evaluate Splink as periodic identity resolution audit tool
- **Priority:** Low | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-903: Add identity resolution quality metrics to admin dashboard
- **Priority:** Low | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-910: Epic: Long-Term Data Strategy Phase 1 — Automation Foundation
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-915: Data: 1,499 cats with appointments but no place link — linkable now
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-916: Data: 25 completed requests with 0 cats linked despite estimates of 5-30
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-917: Data: 20 orphaned colonies (cats, no caretaker) — largest has 122 cats
- **Priority:** Medium | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-918: Data: Coverage gaps — Cazadero (193 cats, 0 requests), Clearlake (146), Graton (130)
- **Priority:** Low | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-919: Data: Cat 981020053881414 (Jean Worthey) — ShelterLuv adoption data not reflected in Atlas
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-920: Data: Google Maps note for 211 E Shiloh Rd mislinked to 5811 Faught Rd
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-921: Foster lifecycle: mark person_cat inactive on foster_end event
- **Priority:** Medium | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-922: Event processing: log unmatched animals to entity_linking_skipped
- **Priority:** Medium | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-923: Phone matching in SL events: add address verification per MIG_2548
- **Priority:** Low | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-924: Transfer events: parse destination and create place links
- **Priority:** Low | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-925: Return-to-field: re-link cat to original trapping location
- **Priority:** Low | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-926: Clean dead foster variables from process_shelterluv_animal()
- **Priority:** Low | **Labels:** None
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-929: Equipment kiosk: track actor_person_id on events
- **Priority:** Low | **Labels:** Equipment, Improvement
- **Created:** 2026-03-27 | **Completed:** N/A

### FFS-936: Config-driven ingest engine — admin-configurable field/value mapping for external form sync
- **Priority:** High | **Labels:** Helix Core, White Label, Ingest, Infrastructure
- **Created:** 2026-03-27 | **Completed:** N/A
- **Children:** 4

  - **FFS-937**: Ingest engine: DB schema — ingest_sources, field_mappings, value_mappings tables
    - Labels: Helix Core, Ingest, Infrastructure | Done: N/A
  - **FFS-938**: Ingest engine: Admin UI — source connections, field mapping, value mapping pages
    - Labels: Helix Core, Ingest, Frontend | Done: N/A
  - **FFS-939**: Ingest engine: Generic webhook handler — reads config from DB instead of hardcoded maps
    - Labels: Helix Core, Ingest, API | Done: N/A
  - **FFS-941**: Ingest engine: Error queue admin page + Slack alerting on sync failures
    - Labels: Helix Core, Ingest, Frontend | Done: N/A

### FFS-955: Tippy test suite cleanup & modernization
- **Priority:** High | **Labels:** Tippy, DX, E2E Tests
- **Created:** 2026-03-28 | **Completed:** N/A
- **Children:** 1

  - **FFS-956**: Delete stale demo-vs-real and content-comparison test files
    - Labels: Tippy, E2E Tests | Done: N/A

## Batch Archived: 2026-04-02 (129 issues)

### FFS-957: Extract shared kiosk form styles to kiosk-styles.ts
- **Priority:** Medium | **Labels:** Equipment, Frontend, Improvement
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-958: Create KioskCard wrapper component
- **Priority:** Medium | **Labels:** Equipment, Frontend, Improvement
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-959: Delete dead CheckoutWizard.tsx (690 lines, zero imports)
- **Priority:** Low | **Labels:** Equipment, Frontend
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-960: Standardize print page colors to CSS variables
- **Priority:** Low | **Labels:** Equipment, Frontend
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-753: Tippy V2 — Ambient Colleague
- **Priority:** High | **Labels:** Tippy, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-03-28
- **Children:** 1

  - **FFS-909**: Tippy: "Coverage gaps" / data desert questions timeout on both demo and real paths
    - Labels: Tippy, Data Quality, Feature | Done: 2026-03-28

### FFS-969: Always show contact fields for requester — no search gate
- **Priority:** High | **Labels:** UX Polish, Mar 2026, Requests, Frontend, Data Quality
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-971: Request form UX Phase 2 — search performance, responsive enabling, person lookup polish
- **Priority:** High | **Labels:** UX Polish, Mar 2026, Requests, Search, Performance, Frontend, Data Quality
- **Created:** 2026-03-28 | **Completed:** 2026-03-28
- **Children:** 5

  - **FFS-972**: PersonReferencePicker: skeleton loading, MRU list, AbortController, prefix cache
    - Labels: UX Polish, Mar 2026, Requests, Performance, Frontend | Done: 2026-03-28
  - **FFS-973**: Responsive enabling: mute contact fields until name entered
    - Labels: UX Polish, Mar 2026, Requests, Frontend | Done: 2026-03-28
  - **FFS-974**: Fuzzy person matching — show "Similar contacts" when exact results < 3
    - Labels: Mar 2026, Requests, Search, Frontend, API, Infrastructure, Data Quality | Done: 2026-03-28
  - **FFS-975**: Name splitting: handle particles (de la Cruz) and suffixes (Jr, Sr)
    - Labels: Mar 2026, Requests, Frontend, Data Quality | Done: 2026-03-28
  - **FFS-987**: Person search: activity-based ranking boost (appointments, cats, requests, recency)
    - Labels: Mar 2026, Search, Performance, Infrastructure, Data Quality | Done: 2026-03-29

### FFS-773: ConfirmDialog adoption — replace window.confirm() across 36 files
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-29

### FFS-774: Migrate inline toast state to useToast hook (15+ files)
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-29

### FFS-778: Breadcrumbs adoption for all entity detail pages
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-29

### FFS-776: Skeleton loading system-wide — 89 files with 'Loading...' text
- **Priority:** Low | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-29

### FFS-775: EmptyState adoption for list + admin pages
- **Priority:** Medium | **Labels:** UX Polish
- **Created:** 2026-03-26 | **Completed:** 2026-03-29

### FFS-970: Add Knip to CI for dead code detection
- **Priority:** Low | **Labels:** DX, Infrastructure
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-988: TNR Data Surfacing: Colony Health, Breeding Badges, Lifecycle Timeline
- **Priority:** High | **Labels:** Beacon, Frontend, API, Infrastructure, Feature
- **Created:** 2026-03-29 | **Completed:** 2026-03-29

### FFS-989: Data Integrity Audit: Colony estimates, breeding flags, altered_status gaps
- **Priority:** Urgent | **Labels:** Beacon, Infrastructure, Data Quality, Bug
- **Created:** 2026-03-29 | **Completed:** 2026-03-29

### FFS-994: Fix data limitations: colony trends, trapper resolution, ShelterLuv places
- **Priority:** High | **Labels:** Mar 2026, Beacon, Entity Linking, API, Data Quality
- **Created:** 2026-03-29 | **Completed:** 2026-03-29

### FFS-995: Leaflet→V2 cleanup: DashboardMap on Google Maps + dead code removal
- **Priority:** High | **Labels:** Frontend, Map, Infrastructure
- **Created:** 2026-03-29 | **Completed:** 2026-03-29

### FFS-996: Fully remove leaflet + @types/leaflet from package.json
- **Priority:** Low | **Labels:** Map
- **Created:** 2026-03-29 | **Completed:** 2026-03-30

### FFS-997: DashboardMap V2: staff validation + clustering polish
- **Priority:** Medium | **Labels:** Map
- **Created:** 2026-03-29 | **Completed:** 2026-03-30

### FFS-999: Fix foster role gap — 20 → 210 fosters visible
- **Priority:** High | **Labels:** Mar 2026, Entity Linking, Data Quality
- **Created:** 2026-03-30 | **Completed:** 2026-03-30

### FFS-1000: Dashboard map search: polished combobox with Atlas + Google Places
- **Priority:** Medium | **Labels:** Map
- **Created:** 2026-03-30 | **Completed:** 2026-03-30

### FFS-1008: Search UX polish — keyboard nav, ARIA, merged sections
- **Priority:** Medium | **Labels:** Map
- **Created:** 2026-03-30 | **Completed:** 2026-03-30

### FFS-1009: Request form consolidation + E2E test filtering
- **Priority:** High | **Labels:** Requests, Frontend, Feature
- **Created:** 2026-03-30 | **Completed:** 2026-03-30
- **Children:** 5

  - **FFS-1010**: Filter E2E test requests from list + counts
    - Labels: Requests, API, E2E Tests | Done: 2026-03-30
  - **FFS-1011**: StaffTriagePanel component — Phase 2 staff-only fields
    - Labels: Requests, Frontend, Feature | Done: 2026-03-30
  - **FFS-1012**: Consolidate CatDetailsSection — remove 5 fields, add handleability + ownershipStatus
    - Labels: Requests, Frontend | Done: 2026-03-30
  - **FFS-1013**: Consolidate PropertyAccessSection — 5 fields → 2
    - Labels: Requests, Frontend | Done: 2026-03-30
  - **FFS-1014**: Wire two-phase layout — 5→4 sections, StaffTriagePanel, facade derivation
    - Labels: Requests, Frontend, Feature | Done: 2026-03-30

### FFS-1015: Map UX: reverse geocode, inline measurement labels
- **Priority:** Medium | **Labels:** Map
- **Created:** 2026-03-30 | **Completed:** 2026-03-30

### FFS-1016: Fix drawer not swapping on pin click + copy address
- **Priority:** High | **Labels:** Map, Bug
- **Created:** 2026-03-30 | **Completed:** 2026-03-30

### FFS-1025: Request enrichment pipeline — place editing, Tippy update, AI drawer
- **Priority:** High | **Labels:** Tippy, Requests, Frontend, API, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1026: Foster role change tracking + entity linking fix
- **Priority:** Medium | **Labels:** Mar 2026, Beacon, Entity Linking, Data Quality
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1027: Admin-editable foster & role config for white-labeling
- **Priority:** Medium | **Labels:** White Label, Mar 2026, Beacon, Data Quality
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1017: Epic: Map Pin Redesign + Google MyMaps Live Sync
- **Priority:** High | **Labels:** White Label, Frontend, Map, Infrastructure
- **Created:** 2026-03-31 | **Completed:** 2026-03-31
- **Children:** 7

  - **FFS-1018**: Pin colors: 6 → 4 (red/blue/amber/gray urgency palette)
    - Labels: White Label, Frontend, Map | Done: 2026-03-31
  - **FFS-1019**: Merge `has_history` + `minimal` → single `reference` pin style
    - Labels: White Label, Map, Infrastructure | Done: 2026-03-31
  - **FFS-1020**: Pin sizes: 4 tiers → 3 (large 32px, medium 22px, small 10px)
    - Labels: White Label, Frontend, Map | Done: 2026-03-31
  - **FFS-1021**: Replace static MapLegend with layer toggle panel
    - Labels: Frontend, Map | Done: 2026-03-31
  - **FFS-1022**: Google MyMaps live sync: daily cron + admin "Sync Now" button
    - Labels: Map, Infrastructure | Done: 2026-03-31
  - **FFS-1023**: Import fresh KML export (close ~125 entry gap)
    - Labels: Map, Infrastructure | Done: 2026-03-31
  - **FFS-1024**: Reference pin opacity + progressive disclosure by zoom
    - Labels: Frontend, Map | Done: 2026-03-31

### FFS-1030: Show adoption date + source on person-cat display
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Frontend, Data Quality
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1028: Request situation update: single flow for address, contact, and info changes
- **Priority:** High | **Labels:** UX Polish, Requests, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1031: Kiosk hub: splash screen + help form + admin question editor
- **Priority:** High | **Labels:** Equipment, Frontend, Infrastructure, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1032: Fix equipment data integrity: stale custodian, deposit, transfer, merge
- **Priority:** Urgent | **Labels:** Equipment, Infrastructure, Data Quality, Bug
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1033: KioskPersonCollector: explicit name+phone fields for equipment checkout
- **Priority:** High | **Labels:** Equipment, Frontend, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1036: Kiosk audit: bug fixes, error boundary, print form revamp
- **Priority:** High | **Labels:** Equipment, UX Polish, Frontend, Bug
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1037: Checkout slips: half-sheet paper forms for paper-digital parallel workflow
- **Priority:** High | **Labels:** Equipment, Frontend, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1038: Restructure equipment navigation: sidebar, print forms, kiosk config
- **Priority:** High | **Labels:** Equipment, UX Polish, Frontend
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-998: Tippy: Bridge quality gap between curated demo answers and ad-hoc queries
- **Priority:** High | **Labels:** Tippy, Infrastructure, Data Quality, E2E Tests
- **Created:** 2026-03-29 | **Completed:** 2026-03-31

### FFS-1041: Redesign checkout slips + update checkout types (Public/Trapper/Foster/Relo/Clinic)
- **Priority:** Medium | **Labels:** Equipment, Frontend, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-1042: Dual-purpose tracking: client-stated + staff-classified checkout purpose
- **Priority:** High | **Labels:** Equipment, Frontend, Infrastructure, Feature
- **Created:** 2026-03-31 | **Completed:** 2026-03-31

### FFS-880: Structured equipment checkout flow with smart defaults + freeform fallback
- **Priority:** High | **Labels:** UX Polish, Frontend, Feature
- **Created:** 2026-03-27 | **Completed:** 2026-04-01

### FFS-828: Kiosk barcode scan: race conditions, no debounce between scans
- **Priority:** High | **Labels:** UX Polish, Clinic, Bug
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-1043: Identity: last_confirmed_at + source_systems[] on person_identifiers
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1044: Identity: Compute dynamic confidence from source authority + multi-source confirmation
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1045: Identity: Detect and flag proxy identifiers (trapper phones, high-volume bookers)
- **Priority:** Medium | **Labels:** Ingest, Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1046: Identity: Trapper-aware identity resolution (proxy guard + Phase 0.7)
- **Priority:** Medium | **Labels:** Ingest, Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-834: KioskEquipmentCard missing fields: history, location, notes
- **Priority:** Medium | **Labels:** UX Polish, Improvement
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-835: Camera scanner: no recovery path when permission denied
- **Priority:** Low | **Labels:** UX Polish, Bug
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-1040: Merge duplicate Joana/Joanna Hurtado + upgrade to approved trapper
- **Priority:** High | **Labels:** Volunteers, Data Quality
- **Created:** 2026-03-31 | **Completed:** 2026-04-01

### FFS-929: Equipment kiosk: track actor_person_id on events
- **Priority:** Low | **Labels:** Equipment, Improvement
- **Created:** 2026-03-27 | **Completed:** 2026-04-01

### FFS-1047: E2E test suite full repair — 60 failures fixed, skip audit, map-markers restore
- **Priority:** High | **Labels:** API, Infrastructure, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1053: Identity write path consolidation + auto-blacklist
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1048: E2E: Request detail page + lifecycle workflow tests
- **Priority:** Urgent | **Labels:** Requests, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1049: E2E: Entity detail pages — cat, person, place load + tab tests
- **Priority:** Urgent | **Labels:** Frontend, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1035: Fix enrich_person_from_request TEXT confidence → NUMERIC
- **Priority:** Medium | **Labels:** Data Quality, Bug
- **Created:** 2026-03-31 | **Completed:** 2026-04-01

### FFS-991: Request UX Phase 3 — Preview actions, TNR progress, card density
- **Priority:** High | **Labels:** UX Polish, Mar 2026, Requests, Frontend
- **Created:** 2026-03-29 | **Completed:** 2026-04-01
- **Children:** 1

  - **FFS-992**: Preview panel: quick-action buttons (Complete, Hold, Assign) + TNR progress bar
    - Labels: UX Polish, Mar 2026, Requests, Frontend | Done: 2026-03-29

### FFS-769: Requests page UX improvements — progressive disclosure, status swimlanes, contextual actions
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Requests, Frontend, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-1054: Redesign Data Hub — consolidate data operations into clean, staff-friendly layout
- **Priority:** High | **Labels:** UX Polish, Ingest, Frontend
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1055: Equipment activity feed at /equipment/activity
- **Priority:** High | **Labels:** Equipment, Frontend, Feature
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1056: Live kiosk status dashboard on admin kiosk page
- **Priority:** Medium | **Labels:** Equipment, Frontend, Improvement
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1057: Move deposit presets and due-date offsets to app_config
- **Priority:** Medium | **Labels:** Equipment, Infrastructure, Improvement
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1058: Overdue equipment alert banner on inventory page
- **Priority:** Low | **Labels:** Equipment, UX Polish, Frontend
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1060: Research — Vet triage & TNR priority frameworks for Tippy form design
- **Priority:** High | **Labels:** Tippy, Documentation
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1050: E2E: Intake queue end-to-end workflow
- **Priority:** High | **Labels:** Requests, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1051: E2E: Dedup resolution UI workflows (person, place, cat)
- **Priority:** Medium | **Labels:** Data Quality, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1052: E2E: Map interactions — pin click, drawer, layer toggle
- **Priority:** Medium | **Labels:** Map, E2E Tests
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-847: Map: Code quality — extract popups, reduce refs, add error boundary
- **Priority:** Low | **Labels:** Frontend, Map, Improvement
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-846: Map: Accessibility — keyboard nav, ARIA labels, help modal
- **Priority:** Medium | **Labels:** Frontend, Map, Improvement
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-839: Map: Bulk select + assign from map (multi-place actions)
- **Priority:** High | **Labels:** Frontend, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-845: Map: Mobile layout optimization (bottom sheet, collapsed controls)
- **Priority:** Medium | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-849: Map: Route optimization for multi-place trapping visits
- **Priority:** Low | **Labels:** API, Map, Feature
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-1034: Address timeline: last_confirmed_at + effective_to on person_place
- **Priority:** High | **Labels:** Requests, Infrastructure, Data Quality
- **Created:** 2026-03-31 | **Completed:** 2026-04-01

### FFS-848: Map: Search result pagination + "Show more" + search history
- **Priority:** Medium | **Labels:** UX Polish, Search, Frontend, Map
- **Created:** 2026-03-26 | **Completed:** 2026-04-01

### FFS-1059: Kiosk session logging table and admin history
- **Priority:** Low | **Labels:** Equipment, Infrastructure, Feature
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1039: VolunteerHub sync stale since Jan 31 — API returning 401, investigate + fix
- **Priority:** Urgent | **Labels:** Volunteers, Ingest, Infrastructure
- **Created:** 2026-03-31 | **Completed:** 2026-04-01
- **Children:** 2

  - **FFS-1067**: VH sync: script calls ops.* but functions are in sot.* schema
    - Labels: Volunteers, Ingest, Bug | Done: 2026-04-01
  - **FFS-1068**: VH sync: cross_reference_vh_trappers_with_airtable() never ported to V2
    - Labels: Volunteers, Ingest, Bug | Done: 2026-04-01

### FFS-910: Epic: Long-Term Data Strategy Phase 1 — Automation Foundation
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-04-01

### FFS-1070: Sync staleness alerts on Data Hub
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1071: Wire confirm_identifier() into SL/VH sync pipelines + backfill
- **Priority:** High | **Labels:** Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1072: Colony population regression for Beacon blank spots
- **Priority:** High | **Labels:** Beacon, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1073: Entity quality score (gold/silver/bronze badges)
- **Priority:** Medium | **Labels:** Beacon, Infrastructure, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-1074: SAC reporting view + admin CSV export
- **Priority:** Medium | **Labels:** Beacon, Data Quality
- **Created:** 2026-04-01 | **Completed:** 2026-04-01

### FFS-881: ClinicHQ Data Quality Audit Remediation
- **Priority:** High | **Labels:** Data Quality
- **Created:** 2026-03-27 | **Completed:** 2026-04-02
- **Children:** 2

  - **FFS-892**: Audit Round 2: SCAS phone blacklist + 5 person splits + stale cleanup
    - Labels: Data Quality | Done: 2026-04-01
  - **FFS-895**: Add cleanup_stale_person_cat_links() to entity linking pipeline
    - Labels: Data Quality | Done: 2026-04-01

### FFS-1001: Request Form Consolidation — Two-Phase Intake
- **Priority:** High | **Labels:** UX Polish, Form System, Requests, Frontend
- **Created:** 2026-03-30 | **Completed:** 2026-04-02
- **Children:** 1

  - **FFS-1007**: E2E coverage for consolidated request form
    - Labels: Form System, Mar 2026, Requests, E2E Tests | Done: 2026-04-01

### FFS-888: Google Maps V2: Smoke test all features before making default (child of FFS-868)
- **Priority:** High | **Labels:** Frontend, Map, E2E Tests
- **Created:** 2026-03-27 | **Completed:** 2026-04-01

### FFS-869: Set up Google Maps cloud styling + Map ID (child of FFS-868)
- **Priority:** High | **Labels:** Frontend, Map, Infrastructure
- **Created:** 2026-03-27 | **Completed:** 2026-04-01

### FFS-879: Remove Leaflet dependencies and dead code (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Map, Infrastructure
- **Created:** 2026-03-27 | **Completed:** 2026-03-29

### FFS-966: Map: Mobile bottom sheet 3-snap-point layout (peek / half / full) (child of FFS-868)
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-965: Map: Show last alteration date + active vs total request count in stats (child of FFS-868)
- **Priority:** Low | **Labels:** UX Polish, Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-963: Map: Drawer quick actions bar — sticky header with Create Request, Assign Trapper (child of FFS-868)
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-962: Map: Keep person/cat navigation in-map (don't break to external pages) (child of FFS-868)
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-889: Make Google Maps V2 the default map (remove Leaflet toggle) (child of FFS-868)
- **Priority:** Medium | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-29

### FFS-964: Map: URL state for selected pin — enable deep-linking and back button (child of FFS-868)
- **Priority:** Medium | **Labels:** UX Polish, Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-953: V2 Map: Render Service Zone boundary polygons (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-952: V2 Map: Render Trapper Territory polygons (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-951: V2 Map: Render Clinic Clients layer markers (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-948: V2 Map: Render Volunteers layer markers (child of FFS-868)
- **Priority:** Medium | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-950: V2 Map: Render Google Pins layer markers (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-949: V2 Map: Render Places (cat locations) layer markers (child of FFS-868)
- **Priority:** Low | **Labels:** Mar 2026, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-990: Map data quality audit: Fix stale disease pins + active_request pin accuracy (child of FFS-868)
- **Priority:** High | **Labels:** Map, Data Quality
- **Created:** 2026-03-29 | **Completed:** 2026-03-29

### FFS-961: Map: Fix dead InfoWindow — pin click skips popup, opens drawer immediately (child of FFS-868)
- **Priority:** High | **Labels:** UX Polish, Frontend, Map
- **Created:** 2026-03-28 | **Completed:** 2026-03-29

### FFS-890: Google Maps V2: Performance test at 3K+ pins — evaluate deck.gl need (child of FFS-868)
- **Priority:** Medium | **Labels:** Performance, Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-29

### FFS-891: Google Maps V2: Zone boundaries + trapper territory rendering (child of FFS-868)
- **Priority:** Medium | **Labels:** Frontend, Map
- **Created:** 2026-03-27 | **Completed:** 2026-03-28

### FFS-968: Adoption context: UI badges, preview panel, timeline (child of FFS-976)
- **Priority:** High | **Labels:** UX Polish, Frontend
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-967: Adoption context: API enrichment + type propagation (child of FFS-976)
- **Priority:** High | **Labels:** Frontend, API
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

### FFS-956: Delete stale demo-vs-real and content-comparison test files (child of FFS-955)
- **Priority:** Medium | **Labels:** Tippy, E2E Tests
- **Created:** 2026-03-28 | **Completed:** 2026-03-28

