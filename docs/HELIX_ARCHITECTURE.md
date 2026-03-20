# Helix Architecture — Atlas Kernel Mapping

**Purpose:** Living architecture document mapping Atlas's current implementation to the 3-layer Helix kernel model. Primary reference for understanding what is extractable today vs what needs work before white-label deployment.

**Linear:** FFS-695 (parent: FFS-694 Helix Core epic)

**Last audited:** 2026-03-19

---

## Readiness Legend

| Indicator | Meaning |
|-----------|---------|
| Ready | Already centralized, config-driven, or abstracted. Extractable as-is. |
| Partial | Exists but has hardcoded elements, inconsistencies, or incomplete adoption. |
| Not ready | Inline, bespoke, or missing. Needs significant work before extraction. |

---

## Layer 1: Data Access

The data access layer encompasses all database interactions — entity CRUD, identity resolution, relationship linking, and merge operations. The goal is that **no caller writes raw SQL against core entity tables**; everything flows through centralized functions.

### 1.1 Entity Creation Functions

**Status: Ready**

All core entities have mandatory `find_or_create_*` SQL functions that enforce deduplication, normalization, provenance tracking, and audit trail. Direct INSERT to SOT tables is prohibited by project invariant.

| Function | Schema | Purpose |
|----------|--------|---------|
| `find_or_create_person()` | `sot` | Person creation with Data Engine identity resolution |
| `find_or_create_place_deduped()` | `sot` | Place creation with address normalization + geocoding queue |
| `find_or_create_cat_by_microchip()` | `sot` | Cat creation via microchip identifier |
| `find_or_create_cat_by_clinichq_id()` | `sot` | Cat creation via ClinicHQ animal ID (no microchip) |
| `find_or_create_request()` | `ops` | Request creation with attribution window support |

**Key files:**
- `docs/CENTRALIZED_FUNCTIONS.md` — full signatures and examples
- `docs/CORE_FUNCTIONS.md` — quick reference

**Helix notes:** These functions are schema-resident (PostgreSQL). For extraction, they would need a service wrapper or remain as SQL with the database. The function signatures are stable and well-documented.

### 1.2 Identity Resolution Engine

**Status: Ready**

Single-fortress identity resolution via `data_engine_resolve_identity()`. All person creation flows through `should_be_person()` gate first.

| Component | Status | Notes |
|-----------|--------|-------|
| `should_be_person()` | Ready | Gates ALL person creation; rejects orgs, addresses, garbage |
| `classify_owner_name()` | Ready | Uses ref tables (Census surnames, SSA names, business keywords) |
| `data_engine_resolve_identity()` | Ready | Fellegi-Sunter scoring with name rarity weighting |
| `sot.soft_blacklist` | Ready | Org emails, shared phones excluded from auto-match |
| `sot.match_decisions` | Ready | Audit log of all identity decisions |
| Phase 0.5 name guard | Ready | Jaro-Winkler >= 0.75 before identifier auto-match (MIG_2929) |
| Configurable thresholds | Ready | 5 thresholds in `ops.app_config` (MIG_2932) |

**Key files:**
- `docs/ATLAS_NORTH_STAR_V2.md` — Data Engine entry points diagram
- `docs/ARCHITECTURE_ENTITY_RESOLUTION.md` — detailed resolution architecture

### 1.3 Entity Merge Functions

**Status: Ready**

Merge functions preserve audit trail via `merged_into_*` chains. All queries filter `merged_into_*_id IS NULL`.

| Function | Status | Notes |
|----------|--------|-------|
| `sot.merge_place_into()` | Ready | Place merge with child/sibling propagation (MIG_2874 fixed V1 refs) |
| `sot.merge_person_into()` | Ready | Person merge with trapper handling (MIG_2922) |
| `*_safe_to_merge()` checks | Ready | Pre-merge validation gates |

**Helix notes:** Merge-aware queries are enforced across 341 references in API routes. This is a well-established pattern.

### 1.4 Entity Linking Pipeline

**Status: Ready**

Orchestrated via `sot.run_all_entity_linking()` with monitoring infrastructure.

| Component | Status | Notes |
|-----------|--------|-------|
| `link_cats_to_appointment_places()` | Ready | Priority 1: booking address (ground truth) |
| `link_cats_to_places()` | Ready | Priority 2: person chain with LIMIT 1 + staff exclusion |
| `link_cats_to_requests_attribution()` | Ready | 6mo before / during / 3mo after attribution window |
| `link_cat_to_place()` | Ready | Gatekeeper function for cat-place writes |
| `link_person_to_cat()` | Ready | Gatekeeper function for person-cat writes |
| `ops.entity_linking_skipped` | Ready | Tracks entities that could not be linked with reasons |
| `ops.entity_linking_runs` | Ready | Run history with coverage metrics |
| `ops.check_entity_linking_health()` | Ready | Health metrics (clinic leakage, coverage) |
| `is_excluded_from_cat_place_linking()` | Ready | Excludes organizations (MIG_2926) |

**Pipeline scripts:**
- `scripts/pipeline/run_entity_linking.sh`
- `scripts/pipeline/run_full_reprocess.sh`
- `scripts/pipeline/run_audit.sh`

### 1.5 API Route Data Access Patterns

**Status: Partial**

Standardized helpers exist and are widely adopted, but adoption is not 100%.

| Pattern | Helper | Adoption | Notes |
|---------|--------|----------|-------|
| UUID validation | `requireValidUUID()` | 168/~44 `[id]` routes | Good coverage across routes |
| Pagination | `parsePagination()` | 34 routes | Many list routes still parse inline |
| Error responses | `apiSuccess()`/`apiError()` | ~2,231 usages | Dominant pattern; only 21 raw `NextResponse.json` remain |
| Error wrapper | `withErrorHandling()` | 37 routes | Partial adoption across 404 total route files |
| Enum validation | `requireValidEnum()` via `ENTITY_ENUMS` | 6 direct imports | Low — most routes validate inline or skip |
| Body parsing | `parseBody()` with Zod | Available | Used in newer routes, older routes parse manually |
| View contracts | `view-contracts.ts` interfaces | Available | Required by invariant 49, not audited for completeness |

**Key files:**
- `apps/web/src/lib/api-validation.ts` — `requireValidUUID()`, `parsePagination()`, `requireValidEnum()`, `withErrorHandling()`, `parseBody()`
- `apps/web/src/lib/api-response.ts` — `apiSuccess()`, `apiError()`, `apiBadRequest()`, `apiNotFound()`, etc.
- `apps/web/src/lib/api-client.ts` — `fetchApi()`, `postApi()`, `unwrapApiResponse()` (client-side)
- `apps/web/src/lib/types/view-contracts.ts` — TS interfaces mirroring SQL views

**Quantitative snapshot (2026-03-19):**
- 404 total API route files
- 168 inline `INSERT INTO` statements (many are legitimate non-entity writes like journal entries, config updates)
- 24 `find_or_create_*` calls from API layer (entity creation flows through SQL functions)
- 452 `fetchApi`/`postApi` usages in frontend pages (good client-side adoption)

### 1.6 Database Layer Architecture

**Status: Ready**

Three-schema design is clean and well-enforced.

| Schema | Purpose | Status |
|--------|---------|--------|
| `source.*` | Raw ingested data (append-only JSONB) | Ready |
| `ops.*` | Operational workflows, config, views, edits | Ready |
| `sot.*` | Canonical entities, core functions | Ready |
| `ref.*` | Reference/lookup data (names, business keywords) | Ready |
| `trapper.*` | V1 legacy (staff auth only) | Ready (scheduled for removal) |

**Helix notes:** The schema separation is a natural extraction boundary. `sot.*` functions could be packaged as a database extension or service layer. `ops.app_config` is the runtime config store.

---

## Layer 2: Config Engine

The config engine encompasses all runtime configuration — from database-stored key-value pairs to TypeScript option registries and enum definitions. The goal is that **no behavior is hardcoded**; everything is admin-editable or derived from a central registry.

### 2.1 Runtime Config (`ops.app_config`)

**Status: Ready**

Key-value config store (key TEXT PK, value JSONB, category TEXT) with full admin UI, server-side helpers, and client-side SWR hooks. Deployed as part of FFS-506 (Admin Everything epic).

| Access Method | Location | Status |
|---------------|----------|--------|
| SQL: `ops.get_config(key, default)` | Database functions | Ready — 18 usages |
| SQL: `ops.get_config_numeric(key, default)` | Database functions | Ready |
| Server: `getServerConfig(key, default)` | `apps/web/src/lib/server-config.ts` | Ready — 40 usages |
| Client: `useAppConfig(key)` | `apps/web/src/hooks/useAppConfig.ts` | Ready — part of 67 config hook usages |
| Admin UI | `/admin/config` | Ready |

**Config categories seeded:**
- `request.*` — stale days, in-progress thresholds
- `pagination.*` — default/max limits
- `map.*` — default zoom, center, bounds, autocomplete bias, colors
- `geo.*` — service counties, default county, service area name
- `org.*` — name, phone, website, email, tagline (white-label branding)
- Identity thresholds — auto_match_weight, review_weight, phase05_name_similarity, phone/email hub thresholds

### 2.2 Convenience Config Hooks

**Status: Ready**

Typed wrappers over `useAppConfig()` for specific config domains.

| Hook | Purpose | File |
|------|---------|------|
| `useGeoConfig()` | Map center, zoom, bounds, counties, service area | `hooks/useGeoConfig.ts` |
| `useOrgConfig()` | Org name, phone, website, email, tagline | `hooks/useOrgConfig.ts` |
| `useMapColors()` | Admin-editable map color palettes | `hooks/useMapColors.ts` |
| `useDisplayLabels(registry)` | Admin-editable display labels (133 entries) | `hooks/useDisplayLabels.ts` |
| `useDesignTokens()` | Theme tokens | `hooks/useDesignTokens.ts` |
| `useTriageFlags()` | Triage flag configuration | `hooks/useTriageFlags.ts` |

### 2.3 Navigation & Permissions

**Status: Ready**

Admin-editable navigation (41 menu items) and role-permission matrix (24 permissions, 3 roles).

| Component | Status | Notes |
|-----------|--------|-------|
| Nav menu config | Ready | 41 items, admin-editable order/visibility |
| `useNavItems()` | Ready | Reads nav config via SWR |
| Role-permission matrix | Ready | `usePermission(key)` hook, 13 usages across frontend |
| `usePermission()` | Ready | Checks matrix with legacy fallback |
| Server-side auth | Ready | `getSession()` in `lib/auth.ts` (566 lines) |

**Helix notes:** Permission checking uses `usePermission('admin.config')` style strings. The matrix is stored in `ops.app_config` and editable via `/admin/roles`. Legacy fallback (admin=all, staff=non-admin, volunteer=read-only) ensures graceful degradation.

### 2.4 Form Option Registries

**Status: Ready**

Three-tier option system with single source of truth in `form-options.ts`. FFS-486 and FFS-692 completed the centralization.

| Registry | File | Purpose | Status |
|----------|------|---------|--------|
| **Canonical** | `lib/form-options.ts` | Single source of truth. `FormOption` interface with `value`, `label`, `shortLabel`, `description`, `group`. 60+ option arrays. | Ready |
| **Print curated** | `lib/field-options.ts` | Subset for paper forms (fewer options to fit bubbles/checkboxes) | Ready |
| **Intake re-export** | `lib/intake-options.ts` | Re-export layer for backward compatibility with intake pages | Ready |
| **DB registry** | `ops.form_field_definitions` | JSONB options for server-side validation | Ready (synced via MIG_2905, MIG_2969) |

**Helper functions in `form-options.ts`:**
- `getValues(options)` — extract value array for enum validation
- `getLabel(options, value)` — get human label for a value
- `getShortLabel(options, value)` — get print-friendly label
- `getLabels(options)` / `getShortLabels(options)` — full label arrays
- `toSelectOptions(options)` — `{value, label}` pairs for UI components

**Helix notes:** `enums.ts` derives its const arrays from `form-options.ts` via `getValues()`. This means option definitions flow: `form-options.ts` -> `enums.ts` -> API validation. A single change propagates everywhere. For white-label, the option arrays could be made tenant-configurable via `ops.form_field_definitions`.

### 2.5 Centralized Enum Registry

**Status: Ready**

All enum validation uses `ENTITY_ENUMS` from `lib/enums.ts`. Types are co-exported.

| Category | Examples | Status |
|----------|----------|--------|
| Request | `REQUEST_STATUS`, `REQUEST_PRIORITY`, `HOLD_REASON`, `PERMISSION_STATUS`, `COLONY_DURATION`, `PROPERTY_TYPE` | Ready — derived from `form-options.ts` |
| Person | `PERSON_ENTITY_TYPE`, `TRAPPER_TYPE`, `PERSON_PLACE_ROLE` | Ready |
| Place | `PLACE_KIND` | Ready |
| Cat | `DEATH_CAUSE`, `KITTEN_ASSESSMENT_STATUS`, `ALTERED_STATUS`, `CAT_SEX` | Ready |
| Handoff | `HANDOFF_REASON` | Ready |
| General | `ENTITY_TYPE` | Ready |

### 2.6 Request Status System

**Status: Ready**

Single source of truth in `lib/request-status.ts` (594 lines). Implements simplified 4-state system with legacy mapping.

| Component | Status |
|-----------|--------|
| Primary statuses (new, working, paused, completed) | Ready |
| Special statuses (redirected, handed_off) | Ready |
| Legacy status mapping (8 legacy -> 4 primary) | Ready |
| `getStatusDisplay()`, `getStatusColor()` | Ready |
| `VALID_TRANSITIONS` workflow validation | Ready |
| `mapLegacyStatus()` for filtering | Ready |

### 2.7 Section-Based Form Configuration

**Status: Partial**

Request detail pages use a section config system (`section-configs.ts`) with 9 sections aligned to intake call sheet order. The `SectionRenderer` component renders fields dynamically from config (11 usages). However:

- Section configs are TypeScript objects, not DB-stored JSON (FFS-496 planned)
- No admin UI for section editing yet (FFS-497 planned)
- Intake form steps (`CallTypeStep`, `ContactStep`, `LocationStep`, etc.) are still hand-coded components, not config-driven

| Component | Status | Notes |
|-----------|--------|-------|
| `section-configs.ts` | Partial | 9 sections defined in TS, reads options from `form-options.ts` |
| `SectionRenderer` | Ready | Generic renderer, 11 usages |
| `RequestSection` | Ready | Wrapper with edit mode |
| `GuidedActionBar` | Ready | Step-through workflow |
| Intake form steps (6) | Not ready | Hand-coded components per step |
| JSON config layer | Not ready | FFS-496 planned |
| Admin section editor | Not ready | FFS-497 planned |

**Key files:**
- `apps/web/src/components/request/section-configs.ts`
- `apps/web/src/components/request/RequestSection.tsx`
- `apps/web/src/components/shared/SectionRenderer.tsx`
- `apps/web/src/components/request-sections/` — 7 section components
- `apps/web/src/components/intake-form/` — 7 intake step components

### 2.8 Source System Configuration

**Status: Partial**

Source systems are hardcoded as string constants. Authority mapping is documented but not enforced programmatically.

| Aspect | Status | Notes |
|--------|--------|-------|
| `source_system` values | Partial | 8 valid values documented in CLAUDE.md, but no enum table in DB |
| Source authority rules | Partial | Documented per-system authority, not enforced in code |
| Source confidence tiers | Ready | clinichq=0.95, shelterluv=0.90, airtable=0.70, web_intake=0.60 |
| Survivorship rules | Ready | Embedded in `find_or_create_cat_by_microchip()` |

---

## Layer 3: Presentation

The presentation layer encompasses all UI components, page layouts, and interaction patterns. The goal is that **shared components handle common patterns**; no page hand-rolls a split view, drawer, or tab bar.

### 3.1 Layout Components

**Status: Ready**

| Component | File | Adoption | Notes |
|-----------|------|----------|-------|
| `ListDetailLayout` | `components/layouts/ListDetailLayout.tsx` | 18 usages | Split-view wrapper (list + detail pane), Escape closes, mobile-responsive |
| `TwoColumnLayout` | `components/layouts/TwoColumnLayout.tsx` | Available | Generic two-column layout |
| `Section` | `components/layouts/Section.tsx` | Available | Content section wrapper |
| `StatsSidebar` | `components/layouts/StatsSidebar.tsx` | Available | Sidebar with stat cards |

### 3.2 Preview System

**Status: Ready**

Generic entity preview infrastructure with 5 entity-specific content mappers.

| Component | File | Notes |
|-----------|------|-------|
| `EntityPreviewPanel` | `components/preview/EntityPreviewPanel.tsx` | Generic: sticky header, stats grid, contact, sections. 17 usages. |
| `TrapperPreviewContent` | `components/preview/TrapperPreviewContent.tsx` | Maps Trapper -> EntityPreviewPanel props |
| `PersonPreviewContent` | `components/preview/PersonPreviewContent.tsx` | Maps Person -> EntityPreviewPanel props |
| `PlacePreviewContent` | `components/preview/PlacePreviewContent.tsx` | Maps Place -> EntityPreviewPanel props |
| `CatPreviewContent` | `components/preview/CatPreviewContent.tsx` | Maps Cat -> EntityPreviewPanel props |
| `RequestPreviewContent` | `components/preview/RequestPreviewContent.tsx` | Maps Request -> EntityPreviewPanel props |

### 3.3 Shared Interaction Components

**Status: Ready**

| Component | File | Adoption | Notes |
|-----------|------|----------|-------|
| `ActionDrawer` | `components/shared/ActionDrawer.tsx` | 6 usages | Right-side slide-over (sm/md/lg), focus trap, Escape/backdrop close |
| `RowActionMenu` | `components/shared/RowActionMenu.tsx` | 5 usages | Three-dot kebab menu for table/card rows |
| `Breadcrumbs` | `components/shared/Breadcrumbs.tsx` | 8 usages | Simple breadcrumb with ">" separators |
| `EntityDetailHeader` | `components/shared/EntityDetailHeader.tsx` | Available | Standardized entity detail page header |
| `TabBar` | `components/ui/TabBar.tsx` | 39 usages | Shared tab bar component (FFS-624 migrated 12+ pages) |
| `Modal` | `components/ui/Modal.tsx` | Available | Base modal component |
| `StatCard` | `components/ui/StatCard.tsx` | 104 usages | Stat display card |
| `StatusSegmentedControl` | `components/ui/StatusSegmentedControl.tsx` | Available | Status selector |
| `SmartField` | `components/ui/SmartField.tsx` | Available | Auto-rendering form field |
| `PersonReferencePicker` | `components/ui/PersonReferencePicker.tsx` | Available | Person search + inline creation |

### 3.4 Search & Navigation

**Status: Ready**

| Component | File | Adoption | Notes |
|-----------|------|----------|-------|
| `GlobalSearch` | `components/search/GlobalSearch.tsx` | Available | Command palette search |
| `CommandPalette` | `components/search/CommandPalette.tsx` | Available | Keyboard-driven command palette |
| `EntityPreview` | `components/search/EntityPreview.tsx` | 51 usages | Hover popover for cross-entity links (300ms delay, portal-based) |
| `EntityPreviewModal` | `components/search/EntityPreviewModal.tsx` | Available | Full modal preview |
| `SavedFilters` | `components/search/SavedFilters.tsx` | Available | Saved filter persistence |
| `useNavigationContext` | `hooks/useNavigationContext.ts` | 7 usages | Derives breadcrumbs from route + `?from=` param |
| `useUrlFilters` | `hooks/useUrlFilters.ts` | 18 usages | URL-driven filter state |

### 3.5 Feedback Components

**Status: Partial**

Toast and EmptyState exist but adoption is incomplete.

| Component | File | Shared Adoption | Inline Remaining | Notes |
|-----------|------|----------------|------------------|-------|
| `Toast` / `useToast` | `components/feedback/Toast.tsx` | 19 usages | ~61 inline `showToast`/`setToast` patterns | FFS-618 tracks migration |
| `EmptyState` | `components/feedback/EmptyState.tsx` | 17 usages | Unknown | FFS-625 tracks adoption |
| `Skeleton` | `components/feedback/Skeleton.tsx` | Available | N/A | Loading state component |

### 3.6 FFS-616 Extraction Backlog

**Status: Not ready**

These components are planned but not yet extracted. Pages still use inline implementations.

| Issue | Component | Current State | Impact |
|-------|-----------|---------------|--------|
| FFS-617 | `SharedPagination` — unified with URL sync | `Pagination` component exists in `components/ui/` but 5+ pages have inline pagination | Inconsistent pagination UX |
| FFS-618 | `useToast` adoption | Hook exists, 61 pages still have inline toast state | Duplicated state management |
| FFS-619 | `StatCard` / `StatGrid` | `StatCard` exists (104 usages) but no grid wrapper | Inconsistent stat layouts |
| FFS-620 | `ReasonSelectionForm` | 4 modals with near-identical reason+notes selection | Code duplication |
| FFS-621 | `DataTable` — sortable, selectable, paginated | No shared table component | Inconsistent table patterns |
| FFS-622 | `ConfirmDialog` | Multiple inline confirmation patterns | No standardized confirm/cancel |
| FFS-623 | `DedupPageFramework` | 5 dedup pages (~3,374 lines, ~80% identical) | Massive duplication |
| FFS-625 | `EmptyState` adoption | Component exists, needs broader adoption | Inconsistent empty states |
| FFS-626 | `FilterBar` — composable filter chips | Duplicated filter UI patterns | No shared filter component |

### 3.7 Modal System

**Status: Partial**

21 modal components exist in `components/modals/`. They use the shared `Modal` base component but each has bespoke form logic. No shared `ReasonSelectionForm` yet (FFS-620).

Notable modals: `CreatePersonModal`, `HandoffRequestModal`, `RedirectRequestModal`, `CloseRequestModal`, `CompleteRequestModal`, `ClinicHQUploadModal`, `ReportDeceasedModal`, `LogObservationModal`, `LogSiteVisitModal`.

### 3.8 Print System

**Status: Partial**

Print form infrastructure exists but uses a parallel option system (`field-options.ts`) rather than config-driven templates.

| Component | Status | Notes |
|-----------|--------|-------|
| `TemplateRenderer` | Partial | Exists in `components/print/`, only used in admin preview |
| `PrintPrimitives` | Ready | Reusable print layout primitives |
| Print form pages | Not ready | `/intake/print/[id]/page.tsx` is Jami's daily workflow — hand-coded, not template-driven |
| Print layout builder | Not ready | FFS-519 planned |

### 3.9 Data Hooks

**Status: Ready**

Comprehensive set of data-fetching hooks for entities and configuration.

| Hook | Purpose | File |
|------|---------|------|
| `useEntityDetail` | Fetches full entity detail for preview/modal/panel | `hooks/useEntityDetail.ts` |
| `useCatDetail` | Cat-specific detail fetcher | `hooks/useCatDetail.ts` |
| `usePersonDetail` | Person-specific detail fetcher | `hooks/usePersonDetail.ts` |
| `usePlaceDetail` | Place-specific detail fetcher | `hooks/usePlaceDetail.ts` |
| `usePersonSearch` | Person search with debounce | `hooks/usePersonSearch.ts` |
| `usePersonSuggestion` | Dedup suggestion for person creation | `hooks/usePersonSuggestion.ts` |
| `useRequestCounts` | Request count by status | `hooks/useRequestCounts.ts` |
| `useMapData` | Map pin data fetcher | `hooks/useMapData.ts` |
| `useListData` | Generic list data fetcher | `hooks/useListData.ts` |
| `useCurrentUser` | Current authenticated user | `hooks/useCurrentUser.ts` |
| `usePageConfig` | Page-level configuration | `hooks/usePageConfig.ts` |
| `usePlaceResolver` | Google Places -> Atlas place resolution | `hooks/usePlaceResolver.ts` |
| `useIsMobile` | Responsive breakpoint detection | `hooks/useIsMobile.ts` |
| `useKeyboardShortcuts` | Keyboard shortcut registration | `hooks/useKeyboardShortcuts.ts` |
| `useFocusTrap` | Focus trap for modals/drawers | `hooks/useFocusTrap.ts` |
| `useDebounce` | Generic debounce | `hooks/useDebounce.ts` |
| `useAsyncForm` | Async form submission handler | `hooks/useAsyncForm.ts` |
| `useFormState` | Form state management | `hooks/useFormState.ts` |
| `useEntityPreviewModal` | Entity preview modal state | `hooks/useEntityPreviewModal.ts` |

---

## Cross-Cutting Concerns

### 4.1 Provenance Pattern

**Status: Ready**

Every record carries `source_system` + `source_record_id` + `source_created_at`. This is enforced by the `find_or_create_*` functions and tracked across 459 references in API routes.

| Aspect | Status | Notes |
|--------|--------|-------|
| `source_system` on all entities | Ready | 8 approved values |
| `source_record_id` for dedup | Ready | External system IDs |
| `source_created_at` for attribution | Ready | Critical for cat-request linking windows |
| Source change detection | Ready | `source.sync_runs`, `source.sync_record_state`, `source.change_events` |

### 4.2 Audit Trail

**Status: Ready**

Entity modifications tracked via `ops.entity_edits` table.

| Column | Type | Notes |
|--------|------|-------|
| `entity_type` | TEXT | person, cat, place, request |
| `entity_id` | UUID | The modified entity |
| `edit_type` | TEXT | create, update, merge, delete |
| `field_name` | TEXT | Which field changed |
| `old_value` | JSONB | Previous value |
| `new_value` | JSONB | New value |
| `edited_by` | UUID (nullable) | Staff who made the change (NULL for migrations) |
| `change_source` | TEXT | Migration ID or UI action |
| `reason` | TEXT | Why the change was made |

**Adoption:** 26 references in API routes. Most entity-modifying routes log edits, but coverage has not been comprehensively audited.

### 4.3 Permission System

**Status: Ready**

Role-permission matrix with admin UI, SWR-cached client hook, and legacy fallback.

| Component | Status | Notes |
|-----------|--------|-------|
| `ops.app_config` permission matrix | Ready | 24 permissions, 3 roles (admin, staff, volunteer) |
| `usePermission(key)` hook | Ready | 13 usages, with legacy fallback |
| Admin UI (`/admin/roles`) | Ready | Full matrix editor |
| Server-side `getSession()` | Ready | Session-based auth in `lib/auth.ts` |

**Helix notes:** The permission system is functional but coarse-grained (role-based, not resource-based). For multi-tenant white-label, per-org permission scoping would be needed.

### 4.4 API Response Contract

**Status: Ready**

Standardized response shapes with automatic unwrapping.

| Shape | Structure |
|-------|-----------|
| Success | `{ success: true, data: T, meta?: { total, limit, offset, hasMore } }` |
| Error | `{ success: false, error: { message, code, details? } }` |

Server-side: `apiSuccess()`, `apiError()`, `apiBadRequest()`, `apiNotFound()`, `apiServerError()`, `apiConflict()`, `apiUnprocessable()`, `apiUnauthorized()`, `apiForbidden()`.

Client-side: `fetchApi()` auto-unwraps both new `apiSuccess` format and legacy raw responses.

---

## Readiness Summary

### By Layer

| Layer | Ready | Partial | Not Ready |
|-------|-------|---------|-----------|
| **L1: Data Access** | Entity creation functions, identity engine, merge functions, entity linking, DB schema | API route helper adoption, enum validation in routes | — |
| **L2: Config Engine** | `ops.app_config`, config hooks, form-options registry, enum registry, status system, nav/permissions, display labels | Section-based form config (TS not DB), source system config | JSON form config layer, admin section editor |
| **L3: Presentation** | Layout components, preview system, shared interaction components, search/nav, data hooks, TabBar | Toast adoption, EmptyState adoption, modal system, print system | SharedPagination, DataTable, ConfirmDialog, DedupPageFramework, FilterBar, ReasonSelectionForm, print layout builder |

### Critical Gaps for White-Label Extraction

1. **JSON form config layer (FFS-496)** — Section configs are TypeScript objects, not DB-stored. Tenant-specific forms require DB-driven configuration.
2. **DedupPageFramework (FFS-623)** — 5 dedup pages with ~3,374 lines of ~80% identical code. Must be extracted before replication.
3. **DataTable (FFS-621)** — No shared sortable/paginated table component. Each list page rolls its own.
4. **Toast adoption (FFS-618)** — 61 pages still use inline toast state instead of the shared `useToast` hook.
5. **Source system as config** — The 8 `source_system` values are string constants, not a DB-registered enum. Multi-tenant would need per-org source systems.
6. **Permission scoping** — Current permissions are role-based (admin/staff/volunteer). No per-org or per-resource scoping exists.

---

## Known Incomplete Sections

The following areas have NOT been audited for Helix readiness. They are listed here as placeholders for future audit work.

### Colony Management Workflows

Colony estimation, colony site management, colony-caretaker assignment, colony health tracking. Relevant tables include `ops.place_colony_estimates`, `sot.place_colony_estimates`. Disease computation uses `should_compute_disease_for_place()` and `sot.place_soft_blacklist`. The colony workflow page structure and component architecture have not been mapped.

### Foster Program

Foster data flows from VolunteerHub (active fosters) and Airtable (signed agreements). ShelterLuv may provide foster-cat assignments. See `memory/foster-data-architecture.md` for known architecture. The foster management pages and API routes have not been audited.

### Admin Pages (Beyond FFS-506)

FFS-506 delivered the core admin infrastructure. The admin section now spans 70+ subdirectories under `/admin/`. Many are functional but their component reuse patterns, config-driven-ness, and extraction readiness have not been individually assessed. Known admin areas include:

- Data quality tools (address-dedup, cat-dedup, person-dedup, place-dedup, request-dedup, merge-review)
- AI tooling (ai-access, ai-extraction, classification-review)
- Communication (email, email-batches, email-jobs, email-settings, email-templates)
- Colony management (colonies, colony-estimation, disease-types, ecology)
- Ingest infrastructure (ingest, airtable-syncs, source-confidence)
- Beacon/analytics (beacon, beacon-data, beacon-map)
- Staff/org management (staff, departments, roles, known-organizations, partner-orgs)
- Data engine (data-engine, identity-health, review-queue, reviews)

### Map Layer Configuration

Map colors are admin-editable via `useMapColors()` and `ops.app_config`. Map center/zoom/bounds are configurable via `useGeoConfig()`. However, the full map layer stack (pin rendering, cluster configuration, layer toggling, filter integration) has not been audited for hardcoded assumptions about Sonoma County geography or FFSC-specific map logic.

**Key files not audited:**
- `apps/web/src/lib/map-colors.ts` (161 lines)
- `apps/web/src/lib/geo-config.ts` (61 lines)
- `apps/web/src/hooks/useMapData.ts`
- Map page components

### Airtable Sync Engine

Config-driven sync infrastructure (FFS-503 epic). FFS-504/505/507/508 done. FFS-510 (cutover) in backlog. The sync engine internals, error handling, and per-table configuration have not been audited for extraction readiness. See `memory/airtable-sync-engine.md`.

### Ingest Pipeline Internals

The ClinicHQ 3-file batch processing pipeline (`appointment_info` -> `cat_info` -> `owner_info`) is functional but the TypeScript processing routes (`/api/ingest/process/[id]/route.ts`) contain significant inline SQL. The pipeline's SQL/TS parity requirement and batch-scoped join patterns have not been fully mapped.

### Kitten Assessment Workflow

Kitten assessment scoring system exists as a queue prioritizer. The assessment workflow, scoring algorithm, and foster intake decision support have not been audited. See `memory/feedback_kitten_assessment_workflow.md`.

### Email System

Email batching, templates, and send infrastructure exist under `/admin/email*` and `/api/emails`. The template system, provider configuration, and send pipeline have not been mapped for extraction readiness.

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-03-19 | FFS-695 | Initial creation. Full audit of L1/L2/L3 with quantitative metrics. |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `ATLAS_NORTH_STAR_V2.md` | 3-layer data architecture, invariants, schema mapping |
| `CENTRALIZED_FUNCTIONS.md` | Full function signatures for entity creation |
| `CORE_FUNCTIONS.md` | Quick reference for centralized DB functions |
| `ATLAS_BEACON_ALIGNMENT.md` | Beacon spec alignment audit |
| `CLAUDE.md` | Development rules, invariants, component patterns |
