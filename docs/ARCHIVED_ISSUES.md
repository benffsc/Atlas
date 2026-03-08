# Archived Linear Issues

**Reference archive of completed issues removed from Linear to stay within the 250-issue free plan limit.**

- **Date archived:** 2026-03-08
- **Linear project:** [linear.app/ffsc/project/atlas](https://linear.app/ffsc)
- **Scope:** FFS-5 through FFS-322 (all Done/Cancelled issues)
- **Note:** FFS-83, FFS-84 were never created. FFS-321/322 were duplicates. FFS-254/257, FFS-255/258, FFS-256/259 were duplicate pairs.

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

## Phase 4: Clinic Days & Master List (Mar 2026)

### FFS-103..106: Clinic Days list + master list parser fixes
- **Issues:** FFS-103 (clinic_days table ignored), FFS-104 (regex bugs), FFS-105 (recheck flagging), FFS-106 (foster/org matching)
- **Summary:** Fixed Clinic Days list route generating random UUIDs instead of using `ops.clinic_days` table. Fixed master list parser regex bugs in `extractCatName()` and `extractOwnerName()`. Added recheck/medical follow-up detection and dedicated foster + org matching passes.

### FFS-115: Feb 9 and Feb 23 master lists never imported
- **Summary:** Discovered and imported two missing clinic day master lists (0 `clinic_day_entries` rows).

### FFS-124, 125: Missing DB columns blocking clinic APIs
- **Summary:** Added missing `clinic_type` column to `ops.clinic_days` and missing `partner_org_id` column to clinic history queries.

### FFS-137: Master list matched_appointment_id never propagated
- **Summary:** Fixed master list matching storing results in wrong column — match results were computed but never saved to the correct field.

---

## Phase 4: Intake Queue Refactoring (Mar 2026)

### FFS-107..112: Intake queue overhaul (3,587-line monolith → components)
- **Issues:** FFS-107 (conversion API errors), FFS-108 (status column clutter), FFS-109 (button overload), FFS-110 (monolith breakup), FFS-111 (tab reduction), FFS-112 (badge overload)
- **Summary:** Broke 3,587-line intake queue into 6 focused components. Fixed conversion API swallowing DB errors. Reduced from 7 tabs to 4. Consolidated 4-7 action buttons per row. Standardized 6+ inconsistent badge types.

### FFS-113: Intake form wizard pattern
- **Summary:** Converted 2,217-line intake form monolith to wizard pattern with progress indicator.

### FFS-126..129: Intake queue improvements
- **Issues:** FFS-126 (status as primary divider), FFS-127 (auto-close stale intakes), FFS-128 (auto-geocode on submission), FFS-129 (cross-entity activity)
- **Summary:** Replaced Type column with Status as primary queue divider. Auto-closed stale intakes before 01/30/2026. Added auto-geocoding on submission. Added cross-entity activity updates for address-matched records.

### FFS-166..170: Navigation & filter bar revamp
- **Issues:** FFS-166 (nav bar revamp), FFS-167 (sidebar strip), FFS-168 (requests filter redesign), FFS-169 (kanban view), FFS-170 (intake filter redesign)
- **Summary:** Redesigned navigation and filter bars across requests and intake. Stripped sidebar to navigation-only. Added segmented status control + filter chips. Added kanban view with drag-and-drop.

### FFS-224..226: Intake kanban enhancements
- **Issues:** FFS-224 (drag-and-drop + contact info), FFS-225 (keyboard accessibility), FFS-226 (mobile accordion)
- **Summary:** Added drag-and-drop status changes with contact info on kanban cards, keyboard accessibility, and mobile accordion view.

---

## Phase 4: Ingest & Identity Pipeline Fixes (Mar 2026)

### FFS-114: CRITICAL: owner columns don't exist on ops.appointments
- **Summary:** `owner_first_name`, `owner_last_name`, `owner_address` columns referenced by migration but never created on `ops.appointments`. Fixed column references.

### FFS-116: Identity resolution divergence between old/new ingest paths
- **Summary:** Old and new ingest paths used different identity resolution logic. Unified to use `data_engine_resolve_identity()` consistently.

### FFS-119: MIG_2490 references non-existent columns
- **Summary:** Fixed migration referencing columns that didn't exist on `ops.appointments` table.

### FFS-121: Email matching lacks address verification (MIG_2548 gap)
- **Summary:** Fixed email matching in data engine to include address verification per MIG_2548 rules.

---

## Phase 4: UI Infrastructure (Mar 2026)

### FFS-117, 118: Address input improvements
- **Summary:** Fixed Google Places API failure killing all autocomplete results. Replaced plain address inputs with `PlaceResolver` component in 3 forms.

### FFS-130..133: UI standardization
- **Issues:** FFS-130 (design tokens), FFS-131 (mobile responsive), FFS-132 (reusable Modal), FFS-133 (Badge system)
- **Summary:** Added CSS design tokens, loading/empty states. Made intake queue mobile-responsive. Created reusable Modal component. Built unified Badge component system with consistent visual tiers.

### FFS-176: Dark mode contrast fixes
- **Summary:** Fixed white-on-white contrast issues on entity detail pages in dark mode.

### FFS-177: Entity preview modal
- **Summary:** Built abbreviated entity preview on click within detail pages, avoiding full navigation for quick lookups.

### FFS-211: Wire entity preview modal across all detail pages
- **Summary:** Connected preview modal to all linked entity clicks (cats, places, people) across all detail pages.

### FFS-227, 228: Preview modal expansion
- **Summary:** Wired LinkedCatsSection and LinkedPlacesSection to preview modal on person page. Added request entity type support for place page cross-links.

---

## Phase 4: Request System (Mar 2026)

### FFS-140, 142: Request UI migration
- **Summary:** Migrated requests section to design tokens with loading/empty states. Fixed trapper assignment dropdown and map previews.

### FFS-144..152: Request form data completeness overhaul
- **Issues:** FFS-144 (9/50 fields saved), FFS-145 (missing columns), FFS-146 (auto-resolve requester), FFS-147 (unify call sheet & requests), FFS-148 (field contract validation), FFS-149 (blank print template), FFS-150 (call sheet → request creation), FFS-151 (field coverage), FFS-152 (display all saved fields)
- **Summary:** CRITICAL: Request creation form only saved 9 of 50+ fields. Added missing `ops.requests` columns, auto-resolve requester person, unified TNR call sheet with request workflows, added field contract validation to prevent silent data loss. Created blank print template for on-site collection. Fixed request detail UI to display all fields.

### FFS-153..155: Request workflow polish
- **Issues:** FFS-153 (print sheet consolidation), FFS-154 (reporter picker), FFS-155 (closure system)
- **Summary:** Consolidated call sheet routes. Built unified reporter picker linking field reports to known people. Created resolution outcome system for request closure.

### FFS-159, 160: Request operations
- **Summary:** Fixed trapper assignment silently failing (ops schema functions missing after V2 migration). Added enhanced case status display with resolution context.

### FFS-175: Request form blocks submission when peak_count is 0
- **Summary:** Fixed form blocking submission for valid zero peak count value.

### FFS-143: Trapper session reports
- **Summary:** Built trapper session report recording for field intelligence feeding Beacon estimates.

### FFS-245: CRITICAL: Intake status route writes to non-existent columns
- **Summary:** Fixed intake status update route writing to legacy columns that no longer exist, breaking all status updates.

### FFS-254..259: Feeding frequency cleanup (includes duplicates)
- **Issues:** FFS-254/257 (duplicate), FFS-255/258 (duplicate), FFS-256/259 (duplicate)
- **Summary:** Fixed `feeding_schedule` → `feeding_frequency` field name mismatch across request PATCH route, cleaned 9 invalid values, standardized all references to canonical `feeding_frequency`.

### FFS-271..275: Handoff workflow
- **Issues:** FFS-271 (signature mismatch), FFS-272 (person role context), FFS-273 (V2 field wiring), FFS-274 (enum reconciliation), FFS-275 (E2E tests)
- **Summary:** Fixed `ops.find_or_create_request` signature mismatch breaking handoff. Added person role and property context to handoff modal. Wired V2 fields through API → SQL. Reconciled `PERSON_PLACE_ROLE` enum with DB constraint. Added 5 E2E test scenarios.

### FFS-279..281: Request detail enrichments
- **Summary:** Added Do Not Contact warning banner on person detail page. Added Trip Reports tab on request detail page. Built equipment inventory and checkout admin page.

### FFS-298, 319: Requestor relationship selector
- **Summary:** Added requestor relationship selector to New Request and Intake forms. Completed Step 3 (intake form integration).

### FFS-311, 312: Request detail display
- **Summary:** Display `intake_extended_data` on request detail page. Built review queue UI for appointment-request fuzzy matches.

---

## Phase 4: Entity Linking Pipeline (Mar 2026)

### FFS-134..138: Place dedup and entity linking reprocess
- **Issues:** FFS-134 (2,642 duplicate places), FFS-135 (owner_address linking 0 appointments), FFS-136 (1,194 cats at wrong addresses), FFS-137 (master list wrong column), FFS-138 (full reprocess)
- **Summary:** Fixed `find_or_create_place_deduped()` not deduplicating ClinicHQ addresses (2,642 duplicates). Fixed entity linking Step 1 linking 0 appointments. Fixed 1,194 cats showing at trappers' homes instead of trapping sites. Reprocessed all entity linking.

### FFS-161: GM entry geo-linking pipeline V2
- **Summary:** Built composite scoring + auto-link pipeline for Google Maps reference entries.

### FFS-163, 164: Attribution function fixes
- **Summary:** Fixed attribution function not using `get_place_family()` (cats not linked at parent/child places). Fixed `ingest_auto` creating `request_cats` links without checking attribution time window.

### FFS-240: 2,924 ClinicHQ cats without place links
- **Summary:** Investigated and linked cats with appointments but no place connection.

### FFS-263..266: Entity linking improvements
- **Issues:** FFS-263 (trapping site matching), FFS-264 (ffsc_program skip filter), FFS-265 (foster cross-match), FFS-266 (shelter_transfer classification)
- **Summary:** Matched FFSC trapping site bookings to existing places. Added `ffsc_program` filter to entity linking skip logging. Cross-matched FFSC foster cats with ShelterLuv foster records. Added `shelter_transfer` classification for non-SCAS/RPAS shelters.

### FFS-289..297: Entity linking hardening
- **Issues:** FFS-289 (shelter/rescue transfer linking), FFS-290 (DATA_GAP_040 silent NULLs), FFS-291 (requestors not linked), FFS-292 (alteration rate fix), FFS-293 (place dedup generation), FFS-294 (health check endpoints), FFS-295 (enrich base case), FFS-296 (wire both creation paths), FFS-297 (backfill person_place)
- **Summary:** Linked shelter_transfer and rescue_transfer cats to receiving org places. Fixed silent NULL updates and COALESCE fallbacks. Fixed requestors never linked to places. Fixed alteration rate distinguishing known-altered from unknown. Added health check endpoints. Backfilled person_place relationships for all existing requests.

### FFS-304..310: V1→V2 entity linking gaps
- **Issues:** FFS-304 (enrich_place missing from POST), FFS-305 (link_appointments_to_requests lost), FFS-306 (link_appointments_to_owners missing), FFS-307 (health check not automated), FFS-308 (intake bypasses centralized functions), FFS-309 (convert drops 8+ fields), FFS-310 (ShelterLuv event processing)
- **Summary:** Fixed 7 entity linking functions that were lost or never wired during V1→V2 migration. Fixed ShelterLuv event processing and cat origin tracking.

### FFS-313..315: Entity linking re-run and fixes
- **Summary:** Re-linked entities with corrected confidence ranking. Added phone-based appointment linking with address verification. Fixed V1→V2 link function overloads and constraints.

### FFS-316, 317: Review queue fixes
- **Summary:** Fixed review queue cron creating 26 duplicate rows every 15 minutes. Added bulk Approve All / Dismiss All actions.

---

## Phase 4: Entity Resolution Enhancements (Mar 2026)

### FFS-156..158: Business name classification fix
- **Summary:** Investigated and fixed business/place names stored as person records. Expanded `ref.business_keywords` with 34 new terms. Reclassified 75 records, restored Robin Stovall identity (stolen by org record merge).

### FFS-178..183: Entity resolution scoring upgrade
- **Issues:** FFS-178 (phonetic matching), FFS-179 (fuzzy phone), FFS-180 (comparison-level weights), FFS-181 (dmetaphone integration), FFS-182 (dynamic identifier demotion), FFS-183 (merge_person_into crash)
- **Summary:** Enhanced entity resolution with phonetic matching (dmetaphone), fuzzy phone matching with compound gate, comparison-level weights (Splink/Fellegi-Sunter pattern), and dynamic identifier demotion for high-frequency phones. Fixed `merge_person_into()` crash on `communication_logs` + jsonb cast.

### FFS-229: Intake submissions don't create sot.people records
- **Summary:** Fixed intake submissions not creating canonical `sot.people` records — v1 function never migrated to v2.

### FFS-234..237: Dedup quality fixes
- **Issues:** FFS-234 (backfill audit), FFS-235 (should_be_person regex), FFS-236 (5 self-merged persons), FFS-237 (multi-hop merge chains)
- **Summary:** Audited MIG_2841 person dedup backfill quality. Fixed `should_be_person()` org regex false positives (word boundary issues). Fixed 5 self-merged person records (circular merge chains). Flattened 2 multi-hop place merge chains and fixed person_cat dangling FK.

---

## Phase 4: Dedup System (Mar 2026)

### FFS-217..220: Entity-wide dedup infrastructure
- **Issues:** FFS-217 (complete infrastructure), FFS-218 (cat dedup MIG_2835), FFS-219 (place dedup MIG_2836), FFS-220 (cat dedup admin UI)
- **Summary:** Built complete cat & place dedup infrastructure. Cat dedup: sub-views, safety gate, phonetic matching. Place dedup: 4-tier candidate generation replacing stub. Cat dedup admin UI + API route.

### FFS-230..233: Dedup fixes and extensions
- **Issues:** FFS-230 (safety gate bugs), FFS-231 (address dedup MIG_2838), FFS-232 (request dedup MIG_2839), FFS-233 (merged_into filters)
- **Summary:** Fixed critical dedup safety gate bugs. Built address and request dedup infrastructure. Added `merged_into_*_id IS NULL` filters to address and request queries.

### FFS-238, 239, 242: Dedup operational fixes
- **Summary:** Backfilled `sot_address_id` for 526 places missing address links. Optimized dedup candidate refresh functions (address + request timeout). Created person dedup refresh function (table was empty — no refresh existed).

### FFS-241: Co-located places analysis
- **Summary:** Created `sot.v_co_located_place_groups` view for 595 groups at identical coordinates, classifying as multi_unit, exact_duplicate, or review_needed.

### FFS-321, 322: Place dedup batch auto-merge (duplicate issues)
- **Summary:** Added auto-merge button for high-confidence Tier 1 place dedup pairs (similarity >= 0.9, distance < 10m). Processes in batches of 50 through existing merge API.

---

## Phase 4: Map & Dashboard (Mar 2026)

### FFS-139: Map fixes
- **Summary:** Fixed street view fullscreen, drawer clutter, and z-index hierarchy on the map page.

### FFS-162: Map crashes on GM reference pins
- **Summary:** Fixed "Place not found" crash when clicking Google Maps reference pins.

### FFS-249..253: Dashboard redesign
- **Issues:** FFS-249 (map-centric command center), FFS-250 (marker clustering), FFS-251 (intake pins layer), FFS-252 (KPI comparison fix), FFS-253 (light mode styling)
- **Summary:** Redesigned dashboard as map-centric command center. Added marker clustering for dense areas, intake pins as separate map layer, fixed cats KPI showing partial vs full month, fixed light mode map tile styling.

### FFS-261, 262: Dashboard map fixes
- **Summary:** Fixed cat count showing 0 and intake pins empty. Added grouped layer controls with Atlas pins integration.

### FFS-267, 269, 270, 276..278: AtlasMap improvements
- **Summary:** Adopted GroupedLayerControl on full AtlasMap. Added URL param persistence for layer state on both dashboard and main map. Mobile-responsive grouped layer control. Auto-clear disease filters when switching layers. Memoized per-sub-layer counts.

---

## Phase 4: Airtable Data Import (Mar 2026)

### FFS-184..198, 199, 201..203, 205: Airtable table imports
- **Issues:** FFS-184 (resolved_at backfill), FFS-185 (place_context trigger fix), FFS-186 (trapper-request assignments), FFS-187 (staff assignments), FFS-188 (trapper cases), FFS-189 (trapper reports), FFS-190 (trapper cats), FFS-191 (operational fields), FFS-192 (trapper profiles), FFS-193 (do not contact flags), FFS-194 (common trapping locations), FFS-195 (place contacts), FFS-196 (calendar events), FFS-197 (call sheets), FFS-198 (kitten intake assessment), FFS-199 (appointment request fields), FFS-201 (consent/aliases), FFS-202 (events timeline), FFS-203 (surrender forms), FFS-205 (equipment/skills)
- **Summary:** Imported 20 Airtable tables into Atlas V2: trapper assignments, staff assignments, cases, reports, cats, operational fields (feeding frequency, condition), trapper profiles, do-not-contact flags, trapping locations, place contacts, calendar events, call sheets, kitten intake assessments, appointment request fields, master contacts consent/aliases, events timeline, surrender forms, and equipment/skills data.

### FFS-221: Backfill legacy request fields from notes
- **Summary:** Used regex parsing to extract structured fields (cat count, feeding frequency, location details) from legacy Airtable request notes.

### FFS-246..248: Airtable salvage script fixes
- **Summary:** Fixed `feeding_frequency` CHECK constraint violation. Fixed equipment import crash from missing `airtable_fields` column. Hardened salvage script for idempotent re-runs across all phases.

### FFS-268: Backfill is_alteration + re-geocode intakes
- **Summary:** Populated `is_alteration` column and re-geocoded intake submissions with missing coordinates.

### FFS-283..285: Equipment & trapper sync
- **Summary:** Added equipment ongoing sync from Airtable. Built potential trappers pipeline with schema + sync. Fixed trappers sync migrating from `trapper.*` to `sot.*/ops.*` schema.

---

## Phase 4: ShelterLuv Integration (Mar 2026)

### FFS-300..303: ShelterLuv full integration
- **Issues:** FFS-300 (initial sync), FFS-301 (staged → sot processing), FFS-302 (cat enrichment), FFS-303 (cron setup)
- **Summary:** Complete ShelterLuv integration: initial API sync, staged record processing into sot entities, cat enrichment with photos/descriptions/status tracking, and recurring cron job setup.

---

## Phase 4: API & Data Quality Fixes (Mar 2026)

### FFS-122, 123: Cat detail API fixes
- **Summary:** Fixed cat detail `enhanced_clinic_history` having person-place cartesian product and `client_address` using person's home instead of inferred place.

### FFS-165, 171: Place data fixes
- **Summary:** Fixed missing `parent_place_id` on apartment units (777 Aston Ave, 385/395 Liberty Rd). Merged duplicate 777 Aston Ave places to fix Toni Lecompte attribution.

### FFS-173, 174: Clinic notes visibility
- **Summary:** Fixed clinic notes API query path (notes invisible for accounts without appointment linkage). Added ClinicHQ notes to map drawer and request detail page.

### FFS-206..209: API bug fixes
- **Issues:** FFS-206 (|| null → ?? null), FFS-207 (UUID validation), FFS-208 (person address column bug), FFS-209 (website submissions wrapper)
- **Summary:** Fixed intake numeric fields using `|| null` instead of `?? null` (0 becomes null). Added UUID validation to intake convert endpoint. Fixed `relink_person_primary_address` writing to wrong column. Fixed website submissions `fetchApi` wrapper.

### FFS-210, 212: Detail page enhancements
- **Summary:** Added "earliest date seen" to place detail pages. Improved linked entity display density with collapsible lists (maxVisible=10, "Show all" toggle).

### FFS-213..216, 223: API column/enum fixes
- **Summary:** Fixed `convert_intake_to_request` referencing nonexistent columns, intake decline using wrong journal columns, `|| null` → `?? null` across 10 routes, journal column names across 3 routes, and handleability enum mismatch.

### FFS-243: Test data cleanup
- **Summary:** Cleaned 9 requests linked to test place "999 Test Street".

### FFS-244: Colony size backfill
- **Summary:** Addressed 3,190 places with 3+ cats but no colony size estimate for Beacon analytics.

### FFS-282, 286..288: Person suggestion system
- **Summary:** Built proactive duplicate prevention via email/phone matching. Added PersonSuggestionBanner to RedirectRequestModal, New Request page, and staff New Intake Entry page.

### FFS-292: Alteration rate display fix
- **Summary:** Fixed alteration rate display to distinguish known-altered from unknown status (DATA_GAP_059).

### FFS-299: Migrate trapper.* schema references
- **Summary:** Migrated 90+ scripts and 1 API route from dropped `trapper.*` schema to `sot.*/ops.*` (1,300+ broken references).

### FFS-318: Cat_place coverage gap investigation
- **Summary:** Investigated 21% coverage gap — 9K cats without place links. Identified root causes and improved coverage to 79.6%.

### FFS-320: Wire cat photo_url into API routes
- **Summary:** Wired ShelterLuv `photo_url` into cat list and detail API routes for display.

---

## Canceled

### FFS-120: TECH DEBT: resolved_person_id on ops.appointments is dead code
- **Labels:** Ingest, Infrastructure, Improvement
- **Files:** `sql/schema/v2/MIG_2320__v2_clinic_day_support.sql`, `apps/web/src/app/api/ingest/process/[id]/route.ts`
- **Summary:** MIG_2320 added `resolved_person_id` to `ops.appointments` but ingest code sets `person_id` directly and never populates it. The column and its COALESCE in views is dead code. Canceled -- deemed not worth the migration risk.
