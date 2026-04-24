# Atlas Project — Claude Development Rules

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County (FFSC).

## Linear Tracking (MANDATORY)

**All work MUST be tracked in Linear.** Project: [linear.app/ffsc/project/atlas](https://linear.app/ffsc)

### Before Starting Any Work
1. Check Linear for existing issues: `mcp__linear__list_issues` with project "Atlas"
2. If issue exists, move to "In Progress" and add comment with approach
3. If no issue exists, create one with full code references BEFORE writing code

### During Work
- Add comments with file paths and line numbers being modified
- Reference specific functions, not just "the code"
- Include actual code snippets, not descriptions

### After Completing Work
1. Add comment with commit hash and files changed
2. Include verification steps that were run
3. Move issue to "Done"
4. Create follow-up issues for any new problems discovered

### What Every Issue MUST Have
- **File paths with line numbers** (e.g., `src/app/api/beacon/health/route.ts:54`)
- **Actual code snippets** showing current vs proposed
- **Root cause** — WHY the issue exists, not just symptoms
- **Verification steps** — Commands to confirm the fix works

### Commit Messages
```
fix(scope): Brief description

- Specific change with file reference
- Another change with file reference

Fixes FFS-XX
```

See Linear document "Development Workflow Standards" for full details.

---

## Core Invariants

These apply to ALL changes across ALL layers:

1. **No Data Disappears** — Use `merged_into_*` chains, never hard delete entities
2. **Manual > AI** — Staff-verified data (`is_verified = TRUE`) cannot be overwritten by AI/inferred data
3. **SoT Are Stable Handles** — Entity IDs in `sot.*` tables are permanent
4. **Provenance Is Required** — Every record needs `source_system` + `source_record_id` + `source_created_at`
5. **Identity By Identifier Only** — Email/phone only, NEVER match people by name alone
6. **One Write Path Per User Action** — Single INSERT per button click, no parallel write paths
7. **Merge-Aware Queries** — All queries MUST filter `merged_into_*_id IS NULL`
8. **Active Flows Are Sacred** — Staff-facing changes require Safety Gate validation (`docs/ACTIVE_FLOW_SAFETY_GATE.md`)
9. **Cat Identity Fallback Chain** — Match cats by: microchip first, then `clinichq_animal_id`. Cats without microchips (euthanasia, kittens died) still need records. Staff may enter microchip in Animal Name field for rechecks (15-digit pattern detection).
10. **Explore Data Before Accepting Low Coverage** — When a migration or script produces unexpectedly low coverage (<50%), ALWAYS explore the source/raw data tables first. Check `source.clinichq_raw`, `ops.*`, and related tables to verify data exists in another form. Data often exists in different columns (e.g., `owner_first_name`/`owner_last_name` vs `client_name`) or different tables that can be bridged. Never accept low coverage without investigation.

11. **ClinicHQ Ground Truth Is CATS + PLACES, Not People** — ClinicHQ bookings provide verified data about CATS (microchip, procedures, dates) and PLACES (addresses where cats live). Person links via email/phone indicate **WHO BOOKED**, not where cat lives:

    **Data Analysis (2026-02-24):**
    - **28.5%** - Reliable (person linked = where cat lives)
    - **25.0%** - Uncertain (moderate volume, could be either)
    - **46.5%** - Unreliable (person brought cat from elsewhere: trappers, caretakers, FFSC staff)

    **Why person links are unreliable:**
    - Trappers' contact info on colony accounts (they brought the cat, but don't live there)
    - High-volume users (>10 cats) are likely caretakers, not pet owners (43.5% of "resident" appointments)
    - Shared household phones (Cell Phone field shared by family members)
    - Family members using one email for all bookings
    - Org emails used for individual bookings

    **Implications:**
    - **Place is the anchor** — Show cats on map via `inferred_place_id`, NOT via person→place chain
    - **Person links are for contact** — Use email/phone for communication, NOT for determining cat location
    - **Address extraction from names** — When `Owner First Name` contains an address (e.g., "Old Stony Pt Rd"), extract a place from it
    - **clinic_accounts preserve original** — ALWAYS create a clinic_account for ALL bookings (not just pseudo-profiles)

    See `docs/DATA_RELIABILITY_ANALYSIS.md` for full methodology. See DATA_GAP_054, MIG_2496 for place extraction fix.

## Population Estimation (CATS System)

**Full documentation: `docs/POPULATION_ESTIMATION.md`**

12. **Colony Estimates Use Kalman Filter** — All colony population estimates come from `sot.place_population_state` via the Kalman filter. Never hardcode colony sizes or use raw `cat_place` counts for display.

13. **Floor Counts Are Attrition-Weighted** — `sot.get_attrition_weighted_floor()` weights each cat by `(1-0.13)^years_since_last_appointment`. Never use raw `COUNT(*)` from `cat_place` as a floor. Annual attrition rate is configurable via `ops.app_config` key `population.annual_attrition_rate`.

14. **Evidence Date = Appointment Date, Not created_at** — `cat_place.created_at` reflects when entity linking ran (often recently), NOT when the cat was actually seen. Always use `appointment_date` for recency calculations.

15. **Departed Cats Don't Count** — All cat counts for display MUST include `AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')`. Both `departed` (explicitly left) and `presumed_departed` (not seen in 3+ years) are excluded from active counts. Use `sot.is_present(status)` in SQL functions. MIG_3110.

16. **Kittens That Enter Custody Don't Count** — Kittens taken into FFSC custody (ShelterLuv intake → foster/adoption) get `presence_status = 'departed'` automatically. Only kittens returned to field (TNR'd) count toward colony estimates.

17. **Kalman Observations Are Non-Blocking** — All Kalman update calls MUST be wrapped in try/catch. Failure to update the population estimate should never block the primary operation (observation creation, request update, etc.).

**Key Functions:**
- `sot.update_population_estimate(place_id, count, source_type, date, source_record_id)` — Core Kalman update
- `sot.get_attrition_weighted_floor(place_id)` — Returns raw_floor, weighted_floor, freshness breakdown
- `sot.get_altered_cat_count_at_place(place_id)` — Raw non-departed altered cat count

**Key Tables:**
- `sot.place_population_state` — Current estimate + variance per place
- `sot.population_observations` — Audit log of every Kalman update
- `sot.v_place_colony_status` — View with Kalman estimate + CI + confidence level
- `sot.v_place_cat_freshness` — Per-cat freshness categories

## API Route Invariants

These rules apply to ALL API routes in `/apps/web/src/app/api/`:

46. **UUID Parameters Must Be Validated** — All `[id]` routes MUST call `requireValidUUID(id, entityType)` from `@/lib/api-validation` before any database query. Returns 400 for invalid format, not 500.

47. **Pagination Must Use Helper** — All list routes MUST use `parsePagination(searchParams)` from `@/lib/api-validation`. Never parse limit/offset inline. Prevents negative values, NaN, and enforces max limits.

48. **Enums From Central Registry** — All enum validation MUST use `ENTITY_ENUMS` from `@/lib/enums`. Never define `VALID_*` constants inline in routes.

49. **View Contracts Required** — Routes querying views MUST have a corresponding interface in `@/lib/types/view-contracts.ts`. Interface must match view columns exactly.

50. **Standardized Error Responses** — All errors MUST use helpers from `@/lib/api-response`. Shape: `{ success: false, error: { message, code, details? } }`.

51. **Error Handler Wrapper** — Routes with complex logic SHOULD use `withErrorHandling()` wrapper from `@/lib/api-validation` to catch and format errors consistently.

52. **Frontend Must Unwrap apiSuccess** — All frontend fetch calls MUST handle the `apiSuccess` response wrapper. API responses are `{ success: true, data: T }`. Always unwrap: `const data = result.data || result;` to support both old and new formats. Use `fetchApi()` from `@/lib/api-client.ts` for automatic unwrapping. **CRITICAL:** When standardizing API routes to use `apiSuccess`, ALSO update frontend consumers.

**Key Files:**
- `@/lib/api-validation.ts` — `requireValidUUID()`, `parsePagination()`, `requireValidEnum()`, `withErrorHandling()`, `ApiError`
- `@/lib/api-response.ts` — `apiSuccess()`, `apiError()`, `apiNotFound()`, `apiBadRequest()`
- `@/lib/api-client.ts` — `fetchApi()`, `postApi()`, `unwrapApiResponse()` — client-side helpers that auto-unwrap
- `@/lib/enums.ts` — `ENTITY_ENUMS`, `REQUEST_STATUS`, `PLACE_KIND`, etc.
- `@/lib/types/view-contracts.ts` — `VCatListRow`, `VPersonListRow`, `VPlaceListRow`, `VRequestListRow`, etc.

## Identity & Data Engine Rules

**Confidence Filter Required**: All `person_identifiers` queries for display/matching MUST include `AND confidence >= 0.5`. PetLink emails are fabricated (MIG_887).

**Phone Order**: Always `COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')`. Cell phones are shared in households (MIG_881).

**Name Classification**: `classify_owner_name()` uses ref tables (Census surnames, SSA names, business keywords). Business names → `'organization'`. Pseudo-profiles (addresses, orgs) go to `clinic_owner_accounts`, not `sot.people`.

**Soft Blacklist**: Org emails (`marinferals@yahoo.com`, etc.) must be in `data_engine_soft_blacklist`. Appointment linking must respect soft blacklist (MIG_888).

**TS/SQL Parity**: `/api/ingest/process/[id]/route.ts` must mirror SQL processor (MIG_573): `should_be_person()`, `clinic_owner_accounts`, soft blacklist filters.

**Phone Matching Requires Address Check** (MIG_2548, MIG_2560): Never match people by phone alone across different addresses. Same phone + different address = household members, not same person. Phone matching must verify address similarity (>0.5) or unknown. See DATA_GAP_056.

**Places MUST Link to sot.addresses** (MIG_2562-2565): Every place with `formatted_address` MUST have `sot_address_id` set. Use `sot.find_or_create_address()` for address creation. `find_or_create_place_deduped()` now ensures this automatically.

## Entity Linking Rules

**Cat-Request Attribution Window** (MIG_2480):
Cats are linked to requests based on appointment date relative to request lifecycle:
- **6 months BEFORE request**: People often fix cats before requesting trapper help
- **DURING request**: From creation until resolution
- **3 months AFTER resolution**: Grace period for late arrivals
- Uses `COALESCE(source_created_at, created_at)` for legacy Airtable dates
- Function: `sot.link_cats_to_requests_attribution()`

**Cat-Place Linking** (MIG_889/892/2430-2435):
- `link_cats_to_appointment_places()` — uses `inferred_place_id` ONLY (no fallback)
- `link_cats_to_places()` — uses LIMIT 1 per person + staff exclusion
- Never link to ALL `sot.person_place` rows (causes pollution)
- **CRITICAL (MIG_2430):** NEVER use COALESCE fallback to clinic address. If `inferred_place_id IS NULL`, skip the cat and log to `ops.entity_linking_skipped`. Clinic fallback polluted data with cats incorrectly linked to 845 Todd/Empire Industrial.

**Entity Linking Pipeline Monitoring** (MIG_2435):
- `ops.check_entity_linking_health()` — Returns health metrics (clinic_leakage, cat_place_coverage, etc.)
- `ops.v_clinic_leakage` — View showing cats incorrectly linked to clinic addresses (should be 0)
- `ops.v_entity_linking_skipped_summary` — View showing skipped entities by reason
- `ops.v_cat_place_coverage` — View showing cat-place linking coverage metrics

**After Backfills**: Always re-run `sot.run_all_entity_linking()`. Backfills create edges but don't propagate.

**It's OK If Cats Have No Person Link** — Don't force bad matches. PetLink cats (956) are registry-only. ClinicHQ may have no contact info. Better to skip than link incorrectly.

**Entity Linking Monitoring Tables** (MIG_2430-2435):
| Table | Purpose |
|-------|---------|
| `ops.entity_linking_skipped` | Tracks entities that couldn't be linked with reasons |
| `ops.entity_linking_runs` | Run history with coverage metrics, duration, warnings |

**Confidence Helper Functions** (MIG_2421): Use these instead of inline `confidence >= 0.5`:
| Function | Purpose |
|----------|---------|
| `sot.get_email(person_id)` | Returns high-confidence email (>= 0.5) |
| `sot.get_phone(person_id)` | Returns high-confidence phone (>= 0.5) |
| `sot.has_high_confidence_identifier(person_id, type)` | Boolean check |
| `sot.get_all_identifiers(person_id)` | Returns JSONB array of all identifiers |

## Disease & Ecological Data

**Disease Is Ecological, Not Medical** (MIG_2304): Disease status is about WHERE CATS LIVE, not where tested. Must:
1. Call `should_compute_disease_for_place()` (rejects clinic/blacklisted)
2. Filter by residential relationship types only (`home`, `residence`, `colony_member`)
3. Exclude transient relationships (`treated_at`, `trapped_at`)

**Place Soft Blacklist**: `sot.place_soft_blacklist` excludes places from `disease_computation`, `cat_linking`, or `all`.

## MANDATORY: Centralized Functions

**NEVER create inline INSERT statements for core entities:**

| Entity | Function |
|--------|----------|
| Person | `sot.find_or_create_person(email, phone, first, last, addr, source)` |
| Place | `sot.find_or_create_place_deduped(address, name, lat, lng, source)` |
| Cat (microchip) | `sot.find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` |
| Cat (no microchip) | `sot.find_or_create_cat_by_clinichq_id(animal_id, name, sex, ...)` — MIG_2460 |
| Request | `ops.find_or_create_request(source, record_id, source_created_at, ...)` |
| Cat→Place | `sot.link_cat_to_place(cat_id, place_id, rel_type, evidence_type, ...)` |
| Person→Cat | `sot.link_person_to_cat(person_id, cat_id, rel_type, evidence_type, ...)` |
| Place merge | `sot.merge_place_into(loser_id, winner_id, reason, changed_by)` |

**Place family**: `get_place_family(place_id)` returns UUID[] of parent, children, siblings, co-located. Never use arbitrary distance radius.

See `docs/CENTRALIZED_FUNCTIONS.md` for full signatures.

### source_system Values (use EXACTLY)

`'airtable'` | `'clinichq'` | `'shelterluv'` | `'volunteerhub'` | `'web_intake'` | `'petlink'` | `'google_maps'` | `'atlas_ui'`

### Source System Authority

| System | Authoritative For |
|--------|------------------|
| **ClinicHQ** | Clinic clients, TNR procedures, medical records, microchips |
| **VolunteerHub** | Volunteer PEOPLE (trappers, fosters), user group memberships |
| **ShelterLuv** | Program animals, outcomes (adoption, foster, mortality), intake |
| **Airtable** | Legacy requests, public intake, Project 75 |

## Clinic Data Processing

**Clinic data flows to Cats, Places, Appointments — NOT necessarily People.** See `docs/CLINIC_DATA_STRUCTURE.md`.

| Has Email/Phone? | Person Created? | Cat Links To |
|------------------|-----------------|--------------|
| Yes | Yes | Place (via person) |
| No | No | Place (directly) |

**Cat Animal IDs**: ClinicHQ `Number` → `clinichq_animal_id`. ShelterLuv ID → `shelterluv_animal_id`. Critical for cross-system linkage.

## Client & Account Tracking (DATA_GAP_053 Fix)

**Problem**: ClinicHQ bookings may use one family member's name/email (e.g., "Elisha Togneri" using `michaeltogneri@yahoo.com`), but identity resolution matches to the email owner (Michael Togneri). The original client name is lost.

**Solution**: Three-layer architecture separating SOURCE from IDENTITY:

```
┌─────────────────────────────────────────────────────────┐
│ SOURCE LAYER: ops.clinic_accounts                       │
│ "Who the source system said booked this"                │
│ - Preserves original ClinicHQ client name               │
│ - Does NOT do identity resolution                       │
└─────────────────────────────────────────────────────────┘
                    ↓ resolved_person_id
┌─────────────────────────────────────────────────────────┐
│ IDENTITY LAYER: sot.people                              │
│ "Who this resolves to via email/phone"                  │
│ - Canonical identity via Data Engine (INV-5)            │
│ - Multiple accounts can resolve to same person          │
└─────────────────────────────────────────────────────────┘
                    ↓ household_id
┌─────────────────────────────────────────────────────────┐
│ RELATIONSHIP LAYER: sot.households                      │
│ "Family/property relationships"                         │
│ - Groups accounts with shared identifiers               │
└─────────────────────────────────────────────────────────┘
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `ops.clinic_accounts` | Source tracking - ALL ClinicHQ owners (not just pseudo-profiles) |
| `sot.households` | Family grouping - shared email/phone detection |
| `ops.trapper_contracts` | Atlas-native community trapper contracts (replacing Airtable) |

### Appointment Linking

| Column | Meaning |
|--------|---------|
| `appointment.owner_account_id` | Who booked (Elisha's account) - ALWAYS set |
| `appointment.person_id` | Who resolved to (Michael) - set by Data Engine |

### Account Types

| Type | Description |
|------|-------------|
| `resident` | Regular resident/owner (real person) |
| `colony_caretaker` | Manages a colony |
| `community_trapper` | Community trapper (Tier 2/3) |
| `rescue_operator` | Runs a home-based rescue |
| `organization` | Known org (shelter, rescue, vet clinic) |
| `site_name` | Trapping site name (Silveira Ranch) |
| `address` | Address as name (5403 San Antonio Road) |

### Key Functions

| Function | Purpose |
|----------|---------|
| `ops.upsert_clinic_account_for_owner()` | Create/update account for ClinicHQ owner |
| `sot.classify_owner_name()` | Classify name as person/org/address |
| `sot.should_be_person()` | Gate: determines if owner should create a person record |

### Ingest Pipeline Flow (MIG_2489/2490)

```
owner_info →
  1. ALWAYS create ops.clinic_accounts (preserves original name)
  2. Call should_be_person()
     ├─ FALSE → account.resolved_person_id = NULL (pseudo-profile)
     └─ TRUE → Call data_engine_resolve_identity()
               Set account.resolved_person_id = person_id
  3. Link appointment:
     - owner_account_id = account_id (ALWAYS)
     - person_id = account.resolved_person_id (if resolved)
```

### Ingest Stability Rules (MIG_2400-2404)

**ClinicHQ batch processing order MUST be:**
1. `appointment_info` — Creates appointment records FIRST (anchor)
2. `cat_info` — Creates cats, links to EXISTING appointments
3. `owner_info` — Creates people/places, links to EXISTING appointments

**Before creating ingest-related triggers or functions:**
- Run `scripts/pipeline/validate-ingest-schema.sh` to verify columns exist
- ON CONFLICT clauses require pre-existing unique indexes
- Enum casts must be explicit (`value::ops.test_result`)
- Create indexes in SAME migration as trigger (not separate)

**Required columns (verified by `/api/health/ingest`):**
- `ops.file_uploads`: batch_id, batch_ready, processing_order, file_hash
- `ops.appointments`: client_name, owner_account_id
- `ops.cat_test_results`: evidence_source, extraction_confidence, raw_text, updated_at

**After modifying ingest infrastructure:**
- Verify `/api/health/ingest` returns `status: "healthy"`
- Test a real ClinicHQ batch upload end-to-end

## Beacon / Ground Truth

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.** FFSC clinic data = verified alterations (ground truth). Chapman mark-recapture: `N = ((M+1)(C+1)/(R+1)) - 1`.

## Request & Cat Semantics

**Request Lifecycle**: `new → triaged → scheduled → in_progress → completed`. Set `resolved_at = NOW()` for `completed`/`cancelled`.

**Cat Counts**:
| Field | Meaning |
|-------|---------|
| `estimated_cat_count` | Cats still needing TNR (request progress) |
| `total_cats_reported` | Total cats at location (colony size) |

Use **"Cats Needing TNR"** in UI labels.

## Trapper Classification (Three Tiers)

**This is an important distinction that affects attribution, permissions, and representation.**

### Source Authority Rules (CRITICAL)

| Tier | Source System | How Identified |
|------|---------------|----------------|
| **Tier 1: FFSC Trappers** | VolunteerHub ONLY | Must be in "Approved Trappers" group |
| **Tier 2: Community Trappers** | Airtable ONLY | Signed community trapper contract |
| **Tier 3: Unofficial/Legacy** | Data patterns | Detected via `sot.detect_unofficial_trappers()` |

### Tier Details

| Tier | Database Value | Represents FFSC? | Description |
|------|----------------|------------------|-------------|
| **Tier 1** | `ffsc_staff`, `ffsc_volunteer` | ✅ Yes | Went through full VolunteerHub volunteer process. Most "official" trappers. |
| **Tier 2** | `community_trapper` + `has_signed_contract=TRUE` | ❌ No | Signed contract limiting them to SPECIFIC AREAS ONLY. Do NOT represent FFSC. |
| **Tier 3** | `community_trapper` + `is_legacy_informal=TRUE` | ❌ No | Remnants of old informal processes (e.g., Toni Price). No formal contract. |

### Key Distinctions
- **FFSC Trappers** (Tier 1): VolunteerHub → "Approved Trappers" group. Represent FFSC officially.
- **Community Trappers** (Tier 2): Airtable trappers list. Signed contract. Limited to specific areas. Do NOT represent FFSC.
- **Unofficial Trappers** (Tier 3): Derived from data patterns (frequent appointments from multiple places without VH/Airtable status).

### Rescues vs Trappers
A trapper may ALSO run a rescue (e.g., Katie Moore runs "Cat Rescue of Cloverdale" at her home). This is tracked via:
- `rescue_name` on `sot.trapper_profiles` — The rescue name (if any)
- `rescue_place_id` — Where the rescue operates
- The trapper's `trapper_type` remains their actual tier (e.g., `community_trapper`), NOT `rescue_operator`

### Database Schema (MIG_2485-2488)
- `sot.trapper_profiles` — Extended trapper info (type, rescue name, contract status)
- `sot.trapper_service_places` — Links trappers to places they regularly work
- `sot.v_trapper_tiers` — View showing tier classification
- `sot.find_trappers_for_place()` — Find who services a location
- `sot.detect_unofficial_trappers()` — Find Tier 3 candidates from data patterns

## Map & Search

- Search API: `/api/search?q=...&limit=8&suggestions=true` (no `type=` filter)
- Google-Atlas matching: `atlasPins` array, 0.001° tolerance (~111m)
- Multi-unit places: `requires_unit_selection = TRUE`, never auto-link

## Data Cleaning Pipeline

**Key Files:**
- `scripts/pipeline/run_audit.sh` — Check for data quality issues
- `scripts/pipeline/run_entity_linking.sh` — Run entity linking
- `scripts/pipeline/run_full_reprocess.sh` — All fixes + linking + audit
- `docs/DATA_GAPS.md` — Active data gaps tracker

**Key Functions:**
- `should_be_person()` — Gate: rejects org emails and location names
- `classify_owner_name()` — Classifies names as person/org/address/garbage
- `data_engine_resolve_identity()` — Single fortress for identity resolution
- `should_compute_disease_for_place()` — Gate: rejects clinic/shelter/blacklisted
- `sot.find_or_create_cat_by_clinichq_id()` — Creates cats without microchips (MIG_2460)

**Monitoring Views:**
- `ops.v_unhandled_recheck_duplicates` — Alert: microchip-in-name pattern not matched (should be 0)
- `ops.v_potential_recheck_duplicates` — All detected recheck patterns with status

## Don't Do

**Entity Creation:**
- Don't INSERT directly into `sot_*` tables — Use `find_or_create_*` functions
- Don't create cats without identifier (microchip, clinichq_animal_id, or airtable_id)
- **Cats without microchips:** Use `clinichq_animal_id` as primary identifier. The ingest pipeline (Step 1c) creates cats with `clinichq_animal_id` when microchip is missing. Euthanasia cases often never get microchipped - this is expected.
- **Recheck visits:** Staff may enter microchip in Animal Name field. Pipeline Step 1b detects 15-digit patterns and matches to existing cats.
- Don't create people without email/phone — Data Engine rejects no-identifier cases
- Don't create `sot.cat_place` rows by joining ALL `sot.person_place` — Use LIMIT 1

**Identity:**
- Don't match people by name only — Email/phone required
- Don't merge without `*_safe_to_merge()` checks
- Don't match on PetLink emails without `confidence >= 0.5` filter
- Don't COALESCE Cell Phone before Owner Phone

**Data Integrity:**
- Don't hardcode boolean checks — Use `sot.is_positive_value()` (handles Yes/TRUE/Y/Checked/1/Left/Right/Bilateral)
- Don't modify TS upload route without checking SQL processor for parity
- Don't create fixed time windows — Use `v_request_alteration_stats` view
- Don't skip `merged_into_*_id IS NULL` filters in queries

**Beacon Porting (NEW — all new code must follow):**
- Don't hardcode hex colors in inline styles — Use CSS variables (`var(--primary)`, `var(--success-text)`, etc.) from `globals.css`
- Don't hardcode "Atlas" in user-visible strings — Use `useProduct().brandName` or `useOrgConfig().nameShort`
- Don't hardcode product-specific logic without a config gate — Use `useProduct().isBeacon` or `ops.app_config`
- Don't prefix localStorage/CSS keys with "atlas-" — Use product-neutral names
- Don't add new pages under `/beacon/*` without ensuring they're wrapped by the beacon layout (ProductProvider + ThemeSyncer)

**Key Files (Beacon Porting):**
- `@/lib/product-context` — `useProduct()` returns `{ product, brandName, isBeacon, isAtlas }`
- `@/components/ThemeSyncer` — Syncs admin design tokens → CSS variables, applies product overrides
- `@/app/beacon/layout.tsx` — Beacon layout with ProductProvider + ThemeSyncer + BeaconSidebar
- `@/hooks/useDesignTokens` — Admin-configurable theme colors (brand, status, entity)
- `@/hooks/useOrgConfig` — Org name, phone, website, tagline

**UX Polish (FFS-762+):**
- Don't use "Loading..." text for loading states — Use `Skeleton*` from `@/components/feedback/Skeleton`
- Don't create inline button style objects — Use `Button` from `@/components/ui/Button`
- Don't use emoji icons in navigation — Use `Icon` from `@/components/ui/Icon` with Lucide names (see `@/lib/icon-map.ts`)
- Don't hardcode box-shadow values — Use CSS variables `var(--shadow-xs)` through `var(--shadow-lg)` from `globals.css`

**Key Files (UX Polish):**
- `@/components/ui/Button.tsx` — Shared button: variants (primary/secondary/ghost/danger/outline), sizes, loading state, icon prop
- `@/components/ui/Icon.tsx` — Renders Lucide icon by name with emoji fallback
- `@/lib/icon-map.ts` — Maps string keys → Lucide components (used by DB-driven nav items)
- `@/components/feedback/Skeleton.tsx` — `Skeleton`, `SkeletonText`, `SkeletonTable`, `SkeletonStats`, `SkeletonList`

**Map/UI:**
- Don't use `AddressAutocomplete` for place input — Use `PlaceResolver`
- Don't use `ST_DWithin` for cross-place aggregation — Use `get_place_family()`
- Don't build custom split-view/preview panels — Use `ListDetailLayout` + `EntityPreviewPanel`
- Don't build custom slide-over drawers — Use `ActionDrawer` from `@/components/shared`
- Don't build custom dropdown menus for row actions — Use `RowActionMenu` from `@/components/shared`
- Don't build custom hover popovers — Use `EntityPreview` from `@/components/search`
- Don't hardcode back buttons on detail pages — Use `Breadcrumbs` + `useNavigationContext` with `?from=` param
- Don't add inline toast state (`showToast`/`toastMessage`/`setTimeout`) — Use `useToast` from `@/components/feedback/Toast` (FFS-618 migrates remaining pages)
- Don't copy dedup page structure from another dedup page — FFS-623 extracts `DedupPageFramework`
- Don't build inline tab bars — Use existing `TabBar` from `@/components/ui/TabBar` (FFS-624 migrates remaining pages)
- Don't add inline pagination — FFS-617 extracts `SharedPagination` with URL sync

**API Routes:**
- Don't parse pagination inline — Use `parsePagination()` from `@/lib/api-validation`
- Don't validate UUIDs with inline regex — Use `requireValidUUID()` from `@/lib/api-validation`
- Don't define `VALID_*` constants in routes — Import from `@/lib/enums`
- Don't return `{ error: "message" }` directly — Use `apiError()` from `@/lib/api-response`
- Don't query views without a contract interface — Add to `@/lib/types/view-contracts.ts`

## UI Component Patterns (List-Detail Management UX)

**FFS-602 built a reusable management UX toolkit. Use these components — don't rebuild them.**

### List-Detail Split View

For any entity list page that needs inline preview (trappers, fosters, people, requests):

| Component | Purpose |
|-----------|---------|
| `@/components/layouts/ListDetailLayout` | Split-view wrapper (list + detail pane). Escape closes panel. Mobile-responsive. |
| `@/components/preview/EntityPreviewPanel` | Generic preview panel (sticky header, stats grid, contact, sections). |
| `@/components/preview/TrapperPreviewContent` | Maps `Trapper` interface → `EntityPreviewPanel`. No extra API call. |

**To add a new entity:** Create `*PreviewContent.tsx` mapping entity data → `EntityPreviewPanel` props. Wire into `ListDetailLayout` on the list page. Use `useUrlFilters` with a `selected` key for URL-driven selection.

### Drawers & Inline Actions

| Component | Purpose |
|-----------|---------|
| `@/components/shared/ActionDrawer` | Right-side slide-over (sm/md/lg widths). Focus trap, Escape/backdrop close. |
| `@/components/shared/RowActionMenu` | Three-dot kebab menu for table/card rows. Dropdown with dividers + danger variant. |
| `@/components/trappers/EditTrapperDrawer` | Edit trapper type/status/availability via drawer. PATCHes `/api/trappers`. |

### Navigation & Context

| Component | Purpose |
|-----------|---------|
| `@/components/shared/Breadcrumbs` | Simple breadcrumb with "›" separators. |
| `@/hooks/useNavigationContext` | Derives breadcrumbs from route + `?from=` URL param. |
| `@/components/search/EntityPreview` | Hover popover for cross-entity links (300ms delay, portal-based). |
| `@/hooks/useEntityDetail` | Fetches full entity detail for preview hover/modal/panel. |

**Pattern:** Preview panel "Open Full Profile" links include `?from=trappers` (or fosters/people) so breadcrumbs on the detail page know the origin context.

### Planned Shared Components (FFS-616 Epic)

The following extractions are tracked in Linear epic FFS-616. **Do not create new inline implementations** of these patterns — use or wait for the shared version:

| Issue | Component | Replaces |
|-------|-----------|----------|
| FFS-617 | `SharedPagination` — unified pagination with URL sync | 5+ inline pagination implementations |
| FFS-618 | `useToast` hook + `ToastContainer` — **EXISTS** (`components/feedback/Toast.tsx`), needs adoption | 8+ pages with duplicated inline toast state |
| FFS-619 | `StatCard` / `StatGrid` — consistent stat display | 6+ pages with inline stat cards |
| FFS-620 | `ReasonSelectionForm` — reason + conditional notes | 4 modals with near-identical reason selection |
| FFS-621 | `DataTable` — sortable, selectable, paginated table | Inconsistent table patterns across list pages |
| FFS-622 | `ConfirmDialog` — standardized confirm/cancel | Multiple inline confirmation patterns |
| FFS-623 | `DedupPageFramework` — shared dedup resolution UI | 5 dedup pages (~3,374 lines, 80% identical) |
| FFS-624 | Migrate all inline tabs to `TabBar` component | 17+ pages with hand-rolled tab bars |
| FFS-625 | `EmptyState` — **EXISTS** (`components/feedback/EmptyState.tsx`), needs adoption | Inconsistent empty states across pages |
| FFS-626 | `FilterBar` — composable filter chips + search | Duplicated filter UI patterns |

## Helix Readiness (Design Principles)

All new development must move toward kernel-extractability. Reference `docs/HELIX_ARCHITECTURE.md` for the full 3-layer mapping (Kernel, Shell, Outer Ring).

### When Adding New Code, Route It Here

| Adding... | Must go to... |
|-----------|--------------|
| New form field options | `form-options.ts` → derive in `enums.ts` |
| New configuration value | `ops.app_config` (admin-editable, NOT hardcoded constant) |
| New entity creation | `find_or_create_*` centralized function (never direct INSERT) |
| New UI list page | `DataTable` + `FilterBar` + `ListDetailLayout` |
| New slide-over form | `ActionDrawer` from `@/components/shared` |
| New row actions | `RowActionMenu` from `@/components/shared` |
| New confirmation prompt | `ConfirmDialog` from `@/components/feedback` (not `window.confirm()`) |
| New empty state | `EmptyState` from `@/components/feedback/EmptyState.tsx` |
| New toast notification | `useToast` from `@/components/feedback/Toast` (not inline state) |
| New stat display | `StatCard` from `@/components/ui/StatCard` |
| New entity preview | `EntityPreviewPanel` + `*PreviewContent.tsx` pattern |
| New hover popover | `EntityPreview` from `@/components/search` |
| New breadcrumbs | `Breadcrumbs` + `useNavigationContext` with `?from=` param |
| New API error | `apiError()` / `apiNotFound()` from `@/lib/api-response` |
| New enum validation | `ENTITY_ENUMS` from `@/lib/enums` |
| New pagination | `DataTablePagination` built into `DataTable` |
| New soft blacklist entry | `sot.soft_blacklist` table (via admin UI or migration) |
| New inline color | CSS variable from `globals.css` (never raw hex in `style={{}}`) |
| New user-visible app name | `useProduct().brandName` or `useOrgConfig().nameShort` (never hardcode "Atlas"/"Beacon") |
| New Beacon page | Under `/beacon/*` route (auto-gets ProductProvider + ThemeSyncer + BeaconSidebar) |
| New product-specific behavior | Gate with `useProduct().isBeacon` or `ops.app_config` key |
| New button | `Button` from `@/components/ui/Button` |
| New loading state | `Skeleton*` from `@/components/feedback/Skeleton` |
| New icon in nav/UI | `Icon` from `@/components/ui/Icon` + add to `@/lib/icon-map.ts` |
| New elevation/shadow | CSS variable `var(--shadow-sm)` through `var(--shadow-lg)` or `.card-elevated` class |

### Kernel Layer (must be org-agnostic)

These modules form the extractable core. Changes here must work for ANY TNR org:
- `lib/guards.ts` — Identity gates (`shouldBePerson`, `classifyOwnerName`)
- `lib/api-validation.ts` / `lib/api-response.ts` — Request/response helpers
- `lib/enums.ts` / `lib/form-options.ts` — Option registries
- `components/data-table/` — DataTable + pagination
- `components/layouts/ListDetailLayout.tsx` — Split-view pattern
- `components/shared/` — ActionDrawer, RowActionMenu, Breadcrumbs
- `components/feedback/` — EmptyState, Toast, ConfirmDialog
- `components/ui/` — StatCard, TabBar, Button, Icon
- SQL: `sot.*` schema functions, `ops.app_config`

### Don't Do (Helix)

- Don't hardcode form option values inline — add to `form-options.ts`
- Don't create new config constants — add to `ops.app_config`
- Don't create bespoke entity creation — use `find_or_create_*` pattern
- Don't use `window.confirm()` — use `ConfirmDialog`
- Don't add org-specific logic to kernel-layer modules without a config gate

## Phone Display (TypeScript)

| Function | Purpose |
|----------|---------|
| `formatPhone()` | Display: `7075551234` → `(707) 555-1234` |
| `formatPhoneAsYouType()` | Auto-format during input |
| `isValidPhone()` | Validates 10/11 digits |
| `extractPhones()` | Extract ALL phones from multi-phone fields |

SQL: `norm_phone_us()` for identity matching/storage.

## Documentation Process

**Data Quality Issues**: Document in `docs/DATA_GAPS.md` with ID, status, evidence, root cause, fix.

**Edge Cases**: Document in `docs/DATA_GAP_RISKS.md` with scenario, pattern, handling.

**Schema Migrations**: Document column mapping, write before/after verification, test on staging.

## File Locations

```
/apps/web/          - Next.js web application
/scripts/ingest/    - Data sync scripts
/scripts/pipeline/  - Data cleaning pipeline
/sql/schema/v2/     - Database migrations
/docs/              - Documentation
```

## Key Documentation

| Document | Purpose |
|----------|---------|
| `docs/ATLAS_NORTH_STAR_V2.md` | System layers, invariants, failure modes |
| `docs/CENTRALIZED_FUNCTIONS.md` | Full function signatures |
| `docs/INGEST_GUIDELINES.md` | Data ingestion rules |
| `docs/DATA_FLOW_ARCHITECTURE.md` | Data pipeline from sources to Beacon |
| `docs/CLINIC_DATA_STRUCTURE.md` | ClinicHQ data flow rules |
| `docs/DATA_GAP_RISKS.md` | Edge cases & unusual scenarios |
| `docs/CORE_FUNCTIONS.md` | Quick reference for centralized DB functions |
| `docs/RUNBOOKS/out_of_service_area_email_golive.md` | **Go-Live checklist for out-of-service-area email pipeline (FFS-1181 / FFS-1190)** — manual verification before flipping production |
