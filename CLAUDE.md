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

## API Route Invariants

These rules apply to ALL API routes in `/apps/web/src/app/api/`:

46. **UUID Parameters Must Be Validated** — All `[id]` routes MUST call `requireValidUUID(id, entityType)` from `@/lib/api-validation` before any database query. Returns 400 for invalid format, not 500.

47. **Pagination Must Use Helper** — All list routes MUST use `parsePagination(searchParams)` from `@/lib/api-validation`. Never parse limit/offset inline. Prevents negative values, NaN, and enforces max limits.

48. **Enums From Central Registry** — All enum validation MUST use `ENTITY_ENUMS` from `@/lib/enums`. Never define `VALID_*` constants inline in routes.

49. **View Contracts Required** — Routes querying views MUST have a corresponding interface in `@/lib/types/view-contracts.ts`. Interface must match view columns exactly.

50. **Standardized Error Responses** — All errors MUST use helpers from `@/lib/api-response`. Shape: `{ success: false, error: { message, code, details? } }`.

51. **Error Handler Wrapper** — Routes with complex logic SHOULD use `withErrorHandling()` wrapper from `@/lib/api-validation` to catch and format errors consistently.

**Key Files:**
- `@/lib/api-validation.ts` — `requireValidUUID()`, `parsePagination()`, `requireValidEnum()`, `withErrorHandling()`, `ApiError`
- `@/lib/api-response.ts` — `apiSuccess()`, `apiError()`, `apiNotFound()`, `apiBadRequest()`
- `@/lib/enums.ts` — `ENTITY_ENUMS`, `REQUEST_STATUS`, `PLACE_KIND`, etc.
- `@/lib/types/view-contracts.ts` — `VCatListRow`, `VPersonListRow`, `VPlaceListRow`, `VRequestListRow`, etc.

## Identity & Data Engine Rules

**Confidence Filter Required**: All `person_identifiers` queries for display/matching MUST include `AND confidence >= 0.5`. PetLink emails are fabricated (MIG_887).

**Phone Order**: Always `COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')`. Cell phones are shared in households (MIG_881).

**Name Classification**: `classify_owner_name()` uses ref tables (Census surnames, SSA names, business keywords). Business names → `'organization'`. Pseudo-profiles (addresses, orgs) go to `clinic_owner_accounts`, not `sot.people`.

**Soft Blacklist**: Org emails (`marinferals@yahoo.com`, etc.) must be in `data_engine_soft_blacklist`. Appointment linking must respect soft blacklist (MIG_888).

**TS/SQL Parity**: `/api/ingest/process/[id]/route.ts` must mirror SQL processor (MIG_573): `should_be_person()`, `clinic_owner_accounts`, soft blacklist filters.

## Entity Linking Rules

**Cat-Place Linking** (MIG_889/892):
- `link_cats_to_appointment_places()` — uses `inferred_place_id` (highest priority)
- `link_cats_to_places()` — uses LIMIT 1 per person + staff exclusion
- Never link to ALL person_place_relationships (causes pollution)

**After Backfills**: Always re-run `trapper.run_all_entity_linking()`. Backfills create edges but don't propagate.

**It's OK If Cats Have No Person Link** — Don't force bad matches. PetLink cats (956) are registry-only. ClinicHQ may have no contact info.

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

**Trapper Types**: `coordinator`, `head_trapper`, `ffsc_trapper` (FFSC). `community_trapper` (not FFSC).

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
