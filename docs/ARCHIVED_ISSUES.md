# Archived Linear Issues

**Reference archive of completed issues removed from Linear to stay within the 250-issue free plan limit.**

- **Date archived:** 2026-03-06
- **Linear project:** [linear.app/ffsc/project/atlas](https://linear.app/ffsc)
- **Scope:** FFS-5 through FFS-102, FFS-120
- **Note:** FFS-83 and FFS-84 were never created (skipped identifiers).

---

## Phase 1: Foundation (Jan 2026)

### FFS-24: ATLAS_001: Initial repo seed from Trapper Cockpit
- **Labels:** Infrastructure, Feature
- **Files:** `apps/web/`
- **Commit:** `7c770d9`
- **Summary:** Created Atlas repo with curated migration from `ffsc-trapper-cockpit`. Established repo structure, archived useful Cockpit files.

### FFS-25: ATLAS_002: Supabase bootstrap and first raw ingest
- **Labels:** Ingest, Infrastructure, Feature
- **Commit:** `a7b14bc`
- **Summary:** Set up Supabase Postgres, created `source` schema for raw data staging, implemented first raw Airtable ingest, configured connection pooling.

### FFS-26: ATLAS_003: SoT addresses with Google geocoding
- **Labels:** Map, Infrastructure, Feature
- **Commit:** `a945c81`
- **Summary:** Built address geocoding pipeline with `sot.addresses` table, Google Maps Geocoding API integration, and batch geocoding via Supabase Edge Functions.

### FFS-27: ATLAS_004-006: Ingest pipeline foundation
- **Labels:** Ingest, Infrastructure, Feature
- **Commits:** `46c729e`, `8690fd1`, `eef7785`, `2fea459`
- **Summary:** Built multi-source ingest pipeline: run tracking (`ops.ingest_runs`), file validation, acceptance tests for Airtable + ClinicHQ, and ShelterLuv animal snapshot import.

### FFS-28: ATLAS_007: Project 75 ingest and context surface
- **Labels:** Ingest, Data Quality, Feature
- **Commit:** `2fea459`
- **Summary:** Ingested Project 75 historical data from Airtable legacy records, linked historical requests to places with source provenance.

### FFS-29: ATLAS_008: Identity resolution foundation
- **Labels:** Entity Linking, Data Quality, Feature
- **Commits:** `f6d8918`, `ecf5c02`, `9cd5bfb`, `302c4a5`
- **Summary:** Built the Data Engine identity resolution system: `sot.people`, `person_identifiers`, phonetic matching, email/phone dedup, confidence scoring, and soft blacklist for org emails.

### FFS-30: ATLAS_009: XLSX ingest and batch processing
- **Labels:** Clinic, Ingest, Feature
- **Commits:** `90e839d`, `dfd5a5a`, `c7d0f60`
- **Summary:** Added Excel file support for ClinicHQ exports, batch processing of multiple files, and ClinicHQ join scaffolding.

### FFS-31: ATLAS_010: Multi-source processing pipeline
- **Labels:** Ingest, Infrastructure, Feature
- **Commits:** `d6df1ef`, `97f1c9a`
- **Summary:** Unified processing pipeline: `staged_records` to SoT entities, review queries for staff verification, acceptance tests for pipeline integrity.

### FFS-32: ATLAS_012-013: Canonical cats and place linking
- **Labels:** Entity Linking, Data Quality, Feature
- **Commits:** `d17ec47`, `3aa8d1d`
- **Summary:** Created `sot.cats` with microchip-based dedup, `cat_place_relationships`, and cat-to-owner linking via appointments.

### FFS-33: ATLAS_014-015: Address pipeline and place taxonomy
- **Labels:** Map, Data Quality, Feature
- **Commits:** `a2071b8`, `d3ea601`
- **Summary:** Built owner address extraction from ClinicHQ, address-backed places with taxonomy (home, colony, business, etc.), and improved cat-place coverage.

### FFS-34: ATLAS_016-017: Relationship graph and cat views
- **Labels:** Entity Linking, Frontend, Feature
- **Commits:** `266be53`, `5079d58`
- **Summary:** Created extensible relationship type system (owner, caretaker, trapper, colony_member), evidence tracking, and cat list/detail views.

### FFS-35: ATLAS_018: Bootstrap Next.js web app
- **Labels:** Frontend, Infrastructure, Feature
- **Files:** `apps/web/`
- **Commit:** `cd89ef5`
- **Summary:** Initialized Next.js 14 app with App Router, Tailwind CSS, Supabase client, and authentication scaffolding.

### FFS-36: ATLAS_019: Google-like search with ranking
- **Labels:** Search, API, Feature
- **Commit:** `6ec57b4`
- **Summary:** Built unified search across cats, people, places, requests with relevance ranking, fuzzy matching, and match reason display.

### FFS-37: ATLAS_025-027: Entity Resolution V2
- **Labels:** Entity Linking, Data Quality, Improvement
- **Commits:** `c256a93`, `1d7ebb3`, `adceda6`
- **Summary:** Major identity resolution overhaul: configurable source authority, PetLink email confidence demotion, merge chain flattening, and `data_engine_resolve_identity()` fortress function.

### FFS-38: ATLAS_028-031: VolunteerHub integration
- **Labels:** Volunteers, Ingest, Feature
- **Commits:** `1af07fe`, `3735204`, `fa2e6b6`, `943827e`
- **Summary:** Integrated VolunteerHub as source of truth for volunteers: phonetic name matching, identifier portability, group-based role detection (Approved Trappers), and volunteer API endpoints.

### FFS-39: ATLAS_032-034: Cat detail, quality tiers, and people classification
- **Labels:** API, Data Quality, Feature
- **Commit:** `943827e`
- **Summary:** Cat detail API with medical history, place quality tier scoring, and people classification (person vs organization vs address).

### FFS-40: Journal system implementation
- **Labels:** Frontend, API, Feature
- **Files:** `sql/schema/v2/MIG_140__journal_system.sql`
- **Commits:** `63558b1`, `9a33299`
- **Summary:** Built `ops.journal_entries` with entry types (note, call, visit, email, status_change), staff attribution, compact/expanded views, and edit/delete with audit trail.

### FFS-41: Photo management and Airtable sync
- **Labels:** Ingest, Frontend, Feature
- **Commits:** `fe2a84e`, `9abc7c8`
- **Summary:** Media upload to Supabase Storage with thumbnail generation, photo linking to requests/places/cats, and sync of existing Airtable photos.

### FFS-42: Request cards with map preview
- **Labels:** Frontend, Map, Feature
- **Files:** `apps/web/src/components/RequestCard.tsx`, `apps/web/src/app/api/map/preview/route.ts`
- **Commit:** `c505b92`
- **Summary:** Enhanced request list with map preview thumbnails via Google Static Maps API, nearby marker display, and preview caching.

---

## Phase 2: Features (Feb 2026)

### FFS-43: Tippy AI Assistant - Full Implementation
- **Labels:** Frontend, API, Feature
- **Summary:** Built Tippy, the TNR expert AI assistant with natural language queries, Atlas data integration, tool-based architecture, and conversation history.

### FFS-44: Interactive Map with Entity Pins
- **Labels:** Frontend, Map, Feature
- **Summary:** Built interactive Atlas map with Google Maps, entity pins for places/cats/requests, clustering, detail drawers on pin click, and layer toggle controls.

### FFS-45: Beacon Analytics - Population Modeling
- **Labels:** Beacon, Data Quality, Feature
- **Summary:** Built Beacon population analytics: Chapman mark-recapture colony estimation, alteration rate tracking, disease prevalence mapping, and seasonal trend analysis.

### FFS-46: Request Workflow Overhaul
- **Labels:** Requests, Frontend, Feature
- **Commits:** `784c8cf`, `d557481`, `8813bbe`
- **Summary:** Complete request workflow redesign: new → triaged → scheduled → in_progress → completed lifecycle, resolution reasons, `resolved_at` timestamp, and trapper assignment system.

### FFS-47: Three-Tier Trapper Classification System
- **Labels:** Volunteers, Data Quality, Feature
- **Commits:** `104a8f7`, `13df949`, `75b7d0d`, `ad066ee`
- **Summary:** Implemented three-tier trapper classification: Tier 1 (FFSC staff/volunteer from VolunteerHub), Tier 2 (community trapper with contract from Airtable), Tier 3 (unofficial, detected from data patterns).

### FFS-48: ClinicHQ Notes Ingestion with Test Result Extraction
- **Labels:** Clinic, Ingest, Feature
- **Commit:** `494e150`
- **Summary:** ClinicHQ notes parsing with FeLV/FIV test result extraction, confidence scoring, and evidence source tracking into `ops.cat_test_results`.

### FFS-49: Clinic Days Calendar and Capacity Management
- **Labels:** Clinic, Frontend, Feature
- **Summary:** Calendar view for scheduled clinic days with capacity tracking, inline editing, photo upload, and appointment booking integration.

### FFS-50: Place-Centric Data Model (DATA_GAP_053/054 Fix)
- **Labels:** Entity Linking, Data Quality, Improvement
- **Commit:** `510a912`
- **Summary:** Major architectural shift: places are the anchor, not people. ClinicHQ person links are unreliable 46.5% of the time. Created `ops.clinic_accounts` three-layer architecture separating source from identity.

### FFS-51: Intelligent Search with Clinic Account Aliases
- **Labels:** Clinic, Search, Improvement
- **Commit:** `bd4be6e`
- **Summary:** Enhanced search with clinic account name aliases, abbreviation expansion, phonetic matching for name variations.

### FFS-52: Shared TabBar Component and UI Standardization
- **Labels:** Frontend, Improvement
- **Commit:** `abf67a6`
- **Summary:** Created shared TabBar component for consistent UI across all detail pages with tab configuration via props, active state styling, and keyboard navigation.

### FFS-53: DATA_GAP_009: FFSC Organizational Email Pollution Fix
- **Labels:** Entity Linking, Data Quality, Bug
- **Summary:** Fixed FFSC staff emails (info@forgottenfelines.com, sandra@forgottenfelines.com) being used in ClinicHQ for community cat appointments, incorrectly resolving to staff person records. Fixed via MIG_915, MIG_916.

### FFS-54: DATA_GAP_010: Location-as-Person (Linda Price) Fix
- **Labels:** Entity Linking, Data Quality, Bug
- **Summary:** Fixed location names ("Golden Gate Transit SR", "The Villages") becoming person records. Linda Price was merged INTO "The Villages" record. Fixed via MIG_917.

### FFS-55: DATA_GAP_011: Organization Names with Cats Detection
- **Labels:** Entity Linking, Data Quality, Improvement
- **Summary:** Detected 213 people with organization/address-like names incorrectly linked to cats (e.g., "Marin Friends Of Ferals" with 55 cats, "890 Rockwell Rd." with 51 cats). Added detection via MIG_931.

### FFS-56: DATA_GAP_012: Speedy Creek Winery Duplicates Fix
- **Labels:** Data Quality, Bug
- **Summary:** Consolidated 95 "Speedy Creek Winery" person records to single canonical "Donna Nelson" record, fixed email typo on canonical record.

### FFS-57: DATA_GAP_013: Identity Resolution Consolidation
- **Labels:** Entity Linking, Data Quality, Improvement
- **Summary:** Centralized identity validation with `should_be_person()` gate and `data_engine_resolve_identity()` fortress function to prevent org emails and location names from creating person records. Fixed via MIG_918, MIG_919.

### FFS-58: Entity Linking: Remove Clinic Fallback (MIG_2430)
- **Labels:** Entity Linking, Data Quality, Bug
- **Summary:** Removed COALESCE fallback to clinic addresses in cat-place linking. Cats without `inferred_place_id` were incorrectly linked to 845 Todd Road / Empire Industrial. Now skips and logs to `ops.entity_linking_skipped`. Fixed via MIG_2430-2435.

### FFS-59: Phone Matching Requires Address Check (MIG_2548, MIG_2560)
- **Labels:** Entity Linking, Data Quality
- **Summary:** Added address verification to phone matching. Same phone + different address = household members, not same person. Phone matching now requires address similarity > 0.5.

### FFS-60: Places MUST Link to sot.addresses (MIG_2562-2565)
- **Labels:** Entity Linking, Infrastructure, Data Quality
- **Summary:** Enforced that every place with `formatted_address` must have `sot_address_id` set. `find_or_create_place_deduped()` now ensures this automatically.

### FFS-61: Cats Without Microchips: Use clinichq_animal_id (MIG_2460)
- **Labels:** Clinic, Ingest, Data Quality
- **Summary:** Created `sot.find_or_create_cat_by_clinichq_id()` for cats without microchips (euthanasia cases, kittens that died) using `clinichq_animal_id` as primary identifier.

### FFS-62: Merge Chain Black Holes Fix (TASK_002)
- **Labels:** Entity Linking, Data Quality
- **Summary:** Flattened `merged_into_person_id` chains with multiple hops (depths 2-5). 28,810 total merged people with multi-hop chains causing data to disappear. Fixed via MIG_770.

---

## Phase 3: Stabilization Chunks

### FFS-5: [Chunk 11] Deploy Missing Database Views
- **Labels:** Beacon, Critical, Infrastructure, Bug
- **Files:** `sql/schema/v2/MIG_2082__beacon_views_implementation.sql`
- **Summary:** Deployed missing Beacon analytics views that were blocking ~80 E2E test failures due to non-existent views or schema mismatches.

### FFS-6: [Chunk 14] UI Selector Updates
- **Labels:** Frontend, E2E Tests, Bug
- **Files:** `src/components/ui/TabBar.tsx`
- **Summary:** Updated ~50 E2E test selectors after TabBar component migration; tests used old selectors for pre-migration UI elements.

### FFS-7: [Chunk 15] Auth/Login Timeout Fixes
- **Labels:** Security, E2E Tests, Bug
- **Summary:** Fixed ~45 E2E test failures (especially Tippy tests) caused by login/redirect flow timing out during authentication setup.

### FFS-8: [Chunk 16] Entity Linking Fortification
- **Labels:** Entity Linking, Data Quality, Improvement
- **Files:** `sql/schema/v2/MIG_2430__remove_clinic_fallback.sql`
- **Summary:** Hardened entity linking to prevent silent cat skipping or linking to wrong places. Added validation, error handling, and monitoring for fragile linking patterns.

### FFS-9: [Chunk 17] Volunteer Temporal Tracking
- **Labels:** Volunteers, Data Quality, Feature
- **Files:** `sql/schema/v2/MIG_2366__volunteer_roles_table.sql`, `sql/schema/v2/MIG_2367__populate_volunteer_roles.sql`
- **Summary:** Added temporal tracking for volunteer roles to know WHEN someone was an active trapper, not just IF they were one.

### FFS-10: [Chunk 18] Test Data Cleanup
- **Labels:** DX, E2E Tests, Improvement
- **Summary:** Fixed E2E test data accumulation by implementing proper cleanup of entities created with predictable test patterns.

### FFS-11: [Chunk 1] Data Quality Fixes
- **Labels:** Infrastructure, Data Quality, Improvement
- **Summary:** Foundation fixes for V2 data architecture: duplicate detection, merge-aware queries, `merged_into_*` chains, and provenance tracking (source_system, source_record_id, source_created_at).

### FFS-12: [Chunk 2] Appointment Entity Unification
- **Labels:** Clinic, Entity Linking, Data Quality, Improvement
- **Summary:** Unified appointment data from ClinicHQ into `sot.appointments` canonical table. Linked appointments to cats, people, places. Implemented batch processing order (appointment, cat, owner).

### FFS-13: [Chunk 3] Cat Deduplication System
- **Labels:** Entity Linking, Data Quality, Improvement
- **Summary:** Cat identity resolution: primary match by microchip, secondary by `clinichq_animal_id`, created `sot.find_or_create_cat_by_clinichq_id()`, and recheck detection (microchip in Animal Name field).

### FFS-14: [Chunk 4] Clinic History Unification
- **Labels:** Clinic, Data Quality, Improvement
- **Summary:** Consolidated medical history across sources, linked procedures to cats, and created timeline views for cat medical history.

### FFS-15: [Chunk 5] Colony Estimate Reconciliation
- **Labels:** Beacon, Data Quality, Improvement
- **Summary:** Created `beacon.colony_estimates`, reconciled `estimated_cat_count` vs `total_cats_reported`, implemented place family aggregation for parent/child/sibling places.

### FFS-16: [Chunk 6] ClinicHQ Notes Ingestion
- **Labels:** Clinic, Ingest, Data Quality, Feature
- **Summary:** ClinicHQ notes extraction: parse notes from exports, extract test results (FeLV, FIV, etc.), store in `ops.cat_test_results` with evidence tracking.

### FFS-17: [Chunk 7] Clinic Days Improvements
- **Labels:** Clinic, Frontend, Feature
- **Summary:** Clinic day management: calendar view, capacity tracking per day, integration with appointment booking.

### FFS-18: [Chunk 8] Ingest UI Improvements
- **Labels:** Ingest, Frontend, Feature
- **Summary:** Batch upload UI for ClinicHQ exports with progress tracking, error reporting, and file hash-based deduplication.

### FFS-19: [Chunk 9] Request System Polish
- **Labels:** Requests, Improvement
- **Summary:** Request workflow refinements: improved intake queue, better cat-request attribution (6-month window), status lifecycle standardization.

### FFS-20: [Chunk 10] Critical API Bug Fixes
- **Labels:** API, Infrastructure, Bug
- **Files:** `@/lib/api-validation.ts`
- **Commit:** `a454f08`
- **Summary:** Fixed real 500 errors: `/api/people/search`, `POST /api/requests`, `/api/intake/decline` validation. Added UUID validation to entity routes (returns 400 for invalid format).

### FFS-21: [Chunk 13] API Response Format Fixes
- **Labels:** API, E2E Tests, Bug
- **Commit:** `11851f7`
- **Summary:** Fixed E2E tests expecting old API response format. Created `e2e/helpers/api-response.ts` with `unwrapApiResponse()`, updated 4 test files to handle `apiSuccess()` wrapper.

---

## Phase 3: DX & API Standardization

### FFS-63: API Standardization: Response Format Helpers
- **Labels:** DX, API
- **Files:** `@/lib/api-response.ts`
- **Summary:** Created standardized response helpers (`apiSuccess()`, `apiError()`, `apiNotFound()`, `apiBadRequest()`) to replace inconsistent response formats across API routes.

### FFS-64: API Standardization: UUID Validation Helper
- **Labels:** DX, API
- **Files:** `@/lib/api-validation.ts`
- **Commit:** `a454f08`
- **Summary:** Created `requireValidUUID()` helper so invalid UUIDs in `[id]` routes return 400 instead of 500 errors.

### FFS-65: API Standardization: Pagination Helper
- **Labels:** DX, API
- **Files:** `@/lib/api-validation.ts`
- **Summary:** Created `parsePagination()` helper to handle negative values, NaN, and enforce max limits consistently across all list routes.

### FFS-66: API Standardization: fetchApi Client Utility
- **Labels:** DX, Frontend, API
- **Files:** `@/lib/api-client.ts`
- **Summary:** Created `fetchApi()` and `postApi()` client utilities to auto-unwrap `apiSuccess` response envelopes, replacing manual `json.data || json` unwrapping in 30+ frontend locations.

### FFS-67: API Standardization: Enum Validation from Central Registry
- **Labels:** DX, API
- **Files:** `@/lib/enums.ts`
- **Summary:** Created central enum registry (`ENTITY_ENUMS`, `REQUEST_STATUS`, `PLACE_KIND`, etc.) to replace inline `VALID_*` constants duplicated across routes.

### FFS-68: ClinicHQ Batch Upload Infrastructure (MIG_2400-2404)
- **Labels:** Clinic, Ingest, Infrastructure
- **Commits:** `ba2ff6a`, `134fdac`, `b557b71`
- **Summary:** Fixed ClinicHQ batch upload failures: added `batch_id`, `batch_ready`, `processing_order`, `file_hash` columns, enforced processing order (appointment, cat, owner), and explicit enum casts.

### FFS-69: Linear Integration: Webhook + CRUD + Sessions
- **Labels:** DX, API, Infrastructure
- **Commit:** `8c5c0b3`
- **Summary:** Integrated Linear MCP server for issue tracking with webhook handler, CRUD operations, and session management for Claude Code development workflow.

### FFS-70: Ingest Stability Safeguards
- **Labels:** DX, Ingest, Infrastructure
- **Files:** `scripts/pipeline/validate-ingest-schema.sh`
- **Commit:** `5961618`
- **Summary:** Added schema validation script, `/api/health/ingest` health endpoint, and safeguards against missing columns, incorrect enum casts, and missing indexes in ingest migrations.

### FFS-74: Add ESLint configuration for code quality
- **Labels:** DX, Infrastructure, Improvement
- **Summary:** Added ESLint + TypeScript ESLint configuration for the Next.js app. Previously `npm run lint` failed with "Missing script."

### FFS-75: Remove console.log statements from production code (902 instances)
- **Labels:** DX, Performance, Improvement
- **Summary:** Removed 902 `console.log`/`console.error`/`console.warn` statements from production code to reduce browser console clutter and prevent internal state leakage.

---

## Phase 3: Code Quality & E2E

### FFS-72: CRITICAL: Playwright E2E tests broken - version conflict
- **Labels:** Critical, Infrastructure, E2E Tests, Bug
- **Summary:** Fixed Playwright version conflict (`test.describe()` error) caused by multiple `@playwright/test` versions in the dependency tree. Tests could not even list, let alone run.

### FFS-73: Frontend pages not unwrapping apiSuccess responses (30+ locations)
- **Labels:** Frontend, API, Bug
- **Files:** `src/app/cats/`
- **Summary:** Fixed 30+ frontend pages using raw `.json()` without unwrapping the `apiSuccess` wrapper, causing silent failures where data existed but did not display.

### FFS-76: TypeScript type safety: Remove 22 `as any` bypasses
- **Labels:** DX, Infrastructure, Improvement
- **Files:** `src/components/map/AtlasMap.tsx`, `src/components/map/hooks/useMapClustering.ts`, `src/components/map/hooks/useStreetView.ts`, `src/app/api/ingest/process/`
- **Summary:** Removed 22 instances of `as any` and `@ts-ignore` type bypasses, primarily in Leaflet/cluster typing, Supercluster generics, and ingest processing routes.

### FFS-77: 8 API routes missing standardized response helpers
- **Labels:** DX, API, Improvement
- **Files:** `src/app/api/admin/claude-code/chat/route.ts`, `src/app/api/auth/outlook/callback/route.ts`, `src/app/api/tippy/chat/route.ts`, `src/app/api/v2/ingest/clinichq/route.ts`
- **Summary:** Standardized 8 remaining API routes to use `apiSuccess()`/`apiError()` response helpers for consistent error handling.

### FFS-78: DATA_GAP_040: Entity Linking Function Fortification needed
- **Labels:** Entity Linking, Infrastructure, Data Quality
- **Summary:** Fortified entity linking functions with better error handling, pre-linking validation, and logging for skipped entities.

### FFS-79: DATA_GAP_049: Entity Linking Migrations pending deployment
- **Labels:** Entity Linking, Infrastructure, Data Quality
- **Summary:** Deployed entity linking migrations MIG_2430-2435: remove clinic fallback, fix silent null updates, orchestrator validation, skip logging, and health checks.

### FFS-80: Open Data Gaps requiring attention (11 items)
- **Labels:** Documentation, Data Quality
- **Summary:** Tracked and resolved 11 open data gaps from DATA_GAPS.md including veterinary clinic misclassification, people without contact info, unified search, and master list coverage.

### FFS-81: Fire-and-forget error handling: 20 empty catch blocks
- **Labels:** DX, Frontend, Bug
- **Files:** `src/app/cats/[id]/page.tsx`, `src/app/requests/new/page.tsx`, `src/app/requests/page.tsx`, `src/app/trappers/materials/page.tsx`, `src/app/admin/role-audit/page.tsx`
- **Summary:** Fixed 20 instances of `.catch(() => {})` and similar empty catch blocks that silently swallowed errors across frontend pages.

### FFS-82: Update outdated npm packages (15 packages behind)
- **Labels:** DX, Infrastructure, Improvement
- **Summary:** Updated 15 outdated npm packages including `@anthropic-ai/sdk`, `@playwright/test`, `@react-leaflet/*`, `next`, and others with significant version gaps.

### FFS-85: E2E Test Suite Audit -- Coverage Gaps and Stale Selectors
- **Labels:** E2E Tests, Improvement
- **Summary:** Audited E2E test suite for coverage gaps against critical invariants from FFS-6 through FFS-82, fixed stale selectors from pre-TabBar migration.

### FFS-86: Fix apiSuccess wrapper handling in 49 E2E tests
- **Labels:** Regression, API, E2E Tests
- **Summary:** Fixed 49 E2E tests accessing `data.cats` when actual data was at `data.data.cats` after API standardization to `apiSuccess()` wrapper. Highest-impact single fix in the test suite.

### FFS-87: Fix fullLogin() timeout causing 46 E2E test failures
- **Labels:** Security, Regression, E2E Tests
- **Summary:** Fixed 46 E2E tests failing with `TimeoutError` during `fullLogin()` / `authenticate()` where login/redirect flow did not complete within 30s. Second highest-impact test fix.

---

## Phase 3: Early Bug Fixes

### FFS-22: CRITICAL: Map pins not loading on Atlas map
- **Labels:** Critical, Frontend, API, Map, Bug
- **Files:** `apps/web/src/hooks/useMapData.ts`
- **Summary:** Fixed Atlas map not loading any pins, making the map feature completely unusable for TNR operations and planning.

### FFS-23: CRITICAL: Site crashes when opening pin details on map
- **Labels:** Critical, Frontend, API, Map, Bug
- **Summary:** Fixed site crash ("a client-side exception has occurred") when clicking map pins to open details. Map was functional but unusable for actual work.

### FFS-71: BUG: Cat gallery in Clinic Days not showing cats
- **Labels:** Clinic, Frontend, Bug
- **Summary:** Fixed cat gallery in Clinic Days not displaying cats due to same `apiSuccess` wrapper unwrapping issue as FFS-22/FFS-23.

### FFS-88: Fix strict mode violations and duplicate DOM elements in UI
- **Labels:** Frontend, E2E Tests, Bug
- **Summary:** Fixed 16 E2E test failures from Playwright strict mode violations caused by duplicate DOM elements (nested `<main>` elements, duplicate headings).

### FFS-89: Fix broken API endpoints and missing DB objects (18 test failures)
- **Labels:** API, Infrastructure, E2E Tests, Bug
- **Summary:** Fixed 18 E2E test failures from API endpoints returning 400/404/500 for valid requests -- real app bugs including broken request creation API (13 tests).

### FFS-90: Fix data quality assertions and visual regression baselines (23 tests)
- **Labels:** Frontend, Data Quality, E2E Tests
- **Summary:** Fixed 23 test failures from data quality assertion mismatches and stale visual regression snapshots signaling real data/UI issues.

### FFS-91: Optimize Tippy E2E tests to reduce API costs by 46%
- **Labels:** Performance, E2E Tests, Improvement
- **Commit:** `d1bab5c`
- **Summary:** Reduced Tippy E2E test costs from ~$91/run (349 Anthropic API calls) by eliminating 46% waste from duplicates, mockable tests, and anti-patterns.

### FFS-92: Fix E2E test cleanup to catch requests created via POST API
- **Labels:** Bug
- **Files:** `apps/web/e2e/fixtures/test-data.ts`, `apps/web/src/app/api/requests/route.ts`
- **Summary:** Fixed test cleanup not catching requests created via `POST /api/requests` which hardcodes `source_system = 'atlas_ui'` while cleanup only matched `source_system = 'e2e_test'`.

### FFS-93: Cat photo upload error message parsing broken
- **Labels:** Clinic, Frontend, Bug
- **Files:** `apps/web/src/components/media/MediaUploader.tsx`
- **Summary:** Fixed photo upload failure showing "All 1 uploads failed" with no failure reason due to error response parsing mismatch in MediaUploader.

### FFS-94: Investigate root cause of cat photo upload failure on clinic days page
- **Labels:** Clinic, API, Bug
- **Summary:** Investigated and fixed root cause of cat photo upload failures on the Upload Cat Photos page (`/admin/clinic-days`) with `entity_type=cat` uploads to `/api/media/upload`.

### FFS-95: BUG: Duplicate cats in Clinic Days gallery view
- **Labels:** Clinic, Frontend, API, Data Quality, Bug
- **Files:** `apps/web/src/app/api/admin/clinic-days/`
- **Summary:** Fixed cartesian product from LEFT JOINs on `sot.cat_identifiers` causing duplicate cat cards in Clinic Days gallery (e.g., Pixie appearing twice), inflating cat counts.

### FFS-96: BUG: Clinic Days list route inflates stats via cat_identifiers cartesian product
- **Labels:** Clinic, Critical, API, Data Quality, Bug
- **Files:** `apps/web/src/app/api/admin/clinic-days/route.ts`
- **Summary:** Fixed the same cartesian product bug as FFS-95 in the Clinic Days list endpoint, inflating `total_cats`, `chipped_count`, and `unchipped_count`.

### FFS-97: BUG: Clinic Days shows person's resolved address instead of booking address
- **Labels:** Clinic, API, Data Quality, Bug
- **Summary:** Fixed Clinic Days showing person's resolved address instead of booking address (the address equivalent of DATA_GAP_053 name mismatch). Trapper's home shown instead of colony location.

### FFS-98: BUG: v_clinic_day_entries view uses OR join causing duplicate rows
- **Labels:** Clinic, Infrastructure, Data Quality, Bug
- **Files:** `sql/schema/v2/MIG_2328__clinic_day_entries_v2.sql`
- **Summary:** Fixed duplicate rows in `ops.v_clinic_day_entries` caused by OR join producing rows when both `inferred_place_id` and `place_id` exist and point to different places.

### FFS-99: Master list matching doesn't check booked_as name (DATA_GAP_053 gap)
- **Labels:** Clinic, Data Quality, Improvement
- **Files:** `sql/schema/v2/MIG_2330__smart_master_list_matching.sql`
- **Summary:** Fixed master list Pass 1 matching against resolved person's `display_name` instead of booked-as name. Shared-email households caused match failures per DATA_GAP_053.

### FFS-100: Multi-cat owner matching assigns appointments by line order, not semantic match
- **Labels:** Clinic, Data Quality, Improvement
- **Files:** `sql/schema/v2/MIG_2330__smart_master_list_matching.sql`
- **Summary:** Fixed multi-cat owners (e.g., Cynthia Kingsley x3, Nikki Slade x4) being assigned appointments by line-number order instead of semantic similarity matching.

### FFS-101: Master list import drops test_requested and test_result data
- **Labels:** Clinic, Data Quality, Bug
- **Files:** `apps/web/src/app/api/admin/clinic-days/`
- **Summary:** Fixed master list parser correctly extracting `test_requested` and `test_result` from Excel but INSERT statement never including these columns, silently losing test data.

### FFS-102: Master list import hardcodes status to "completed", ignoring actual Status column
- **Labels:** Clinic, Data Quality, Bug
- **Files:** `apps/web/src/app/api/admin/clinic-days/`
- **Summary:** Fixed master list import overwriting parsed status values (DNC, Heat, Preg) with hardcoded "completed" status, ignoring the actual Status column from the Excel file.

---

## Canceled

### FFS-120: TECH DEBT: resolved_person_id on ops.appointments is dead code
- **Labels:** Ingest, Infrastructure, Improvement
- **Files:** `sql/schema/v2/MIG_2320__v2_clinic_day_support.sql`, `apps/web/src/app/api/ingest/process/[id]/route.ts`
- **Summary:** MIG_2320 added `resolved_person_id` to `ops.appointments` but ingest code sets `person_id` directly and never populates it. The column and its COALESCE in views is dead code. Canceled -- deemed not worth the migration risk.
