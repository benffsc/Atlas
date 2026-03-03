# Atlas Project — Claude Development Rules

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County (FFSC).

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
- Never link to ALL person_place_relationships (causes pollution)
- **CRITICAL (MIG_2430):** NEVER use COALESCE fallback to clinic address. If `inferred_place_id IS NULL`, skip the cat and log to `ops.entity_linking_skipped`. Clinic fallback polluted data with cats incorrectly linked to 845 Todd/Empire Industrial.

**Entity Linking Pipeline Monitoring** (MIG_2435):
- `ops.check_entity_linking_health()` — Returns health metrics (clinic_leakage, cat_place_coverage, etc.)
- `ops.v_clinic_leakage` — View showing cats incorrectly linked to clinic addresses (should be 0)
- `ops.v_entity_linking_skipped_summary` — View showing skipped entities by reason
- `ops.v_cat_place_coverage` — View showing cat-place linking coverage metrics

**After Backfills**: Always re-run `trapper.run_all_entity_linking()`. Backfills create edges but don't propagate.

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
| Person | `trapper.find_or_create_person(email, phone, first, last, addr, source)` |
| Place | `trapper.find_or_create_place_deduped(address, name, lat, lng, source)` |
| Cat (microchip) | `trapper.find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` |
| Cat (no microchip) | `sot.find_or_create_cat_by_clinichq_id(animal_id, name, sex, ...)` — MIG_2460 |
| Request | `trapper.find_or_create_request(source, record_id, source_created_at, ...)` |
| Cat→Place | `trapper.link_cat_to_place(cat_id, place_id, rel_type, evidence_type, ...)` |
| Person→Cat | `trapper.link_person_to_cat(person_id, cat_id, rel_type, evidence_type, ...)` |
| Coord Place | `trapper.create_place_from_coordinates(lat, lng, display_name, source)` — 10m dedup |
| Place merge | `trapper.merge_place_into(loser_id, winner_id, reason, changed_by)` |

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
- Don't create cat_place_relationships by joining ALL person_place_relationships — Use LIMIT 1

**Identity:**
- Don't match people by name only — Email/phone required
- Don't merge without `*_safe_to_merge()` checks
- Don't match on PetLink emails without `confidence >= 0.5` filter
- Don't COALESCE Cell Phone before Owner Phone

**Data Integrity:**
- Don't hardcode boolean checks — Use `trapper.is_positive_value()` (handles Yes/TRUE/Y/Checked/1/Left/Right/Bilateral)
- Don't modify TS upload route without checking SQL processor for parity
- Don't create fixed time windows — Use `v_request_alteration_stats` view
- Don't skip `merged_into_*_id IS NULL` filters in queries

**Map/UI:**
- Don't use `AddressAutocomplete` for place input — Use `PlaceResolver`
- Don't use `ST_DWithin` for cross-place aggregation — Use `get_place_family()`

**API Routes:**
- Don't parse pagination inline — Use `parsePagination()` from `@/lib/api-validation`
- Don't validate UUIDs with inline regex — Use `requireValidUUID()` from `@/lib/api-validation`
- Don't define `VALID_*` constants in routes — Import from `@/lib/enums`
- Don't return `{ error: "message" }` directly — Use `apiError()` from `@/lib/api-response`
- Don't query views without a contract interface — Add to `@/lib/types/view-contracts.ts`

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
| `docs/ATLAS_NORTH_STAR.md` | System layers, invariants, failure modes |
| `docs/CENTRALIZED_FUNCTIONS.md` | Full function signatures |
| `docs/INGEST_GUIDELINES.md` | Data ingestion rules |
| `docs/DATA_FLOW_ARCHITECTURE.md` | Data pipeline from sources to Beacon |
| `docs/CLINIC_DATA_STRUCTURE.md` | ClinicHQ data flow rules |
| `docs/DATA_GAP_RISKS.md` | Edge cases & unusual scenarios |
| `docs/CLAUDE_REFERENCE.md` | Detailed reference |
