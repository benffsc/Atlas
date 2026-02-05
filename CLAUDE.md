# Atlas Project — Claude Development Rules

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County (FFSC).

## System Invariants

These apply to ALL changes across ALL layers:

1. **No Data Disappears** — Use `merged_into_*` chains, never hard delete entities
2. **Manual > AI** — Staff-verified data (`is_verified = TRUE`, `evidence_type = 'manual'`) cannot be overwritten by AI/inferred data. Enrichment scripts must check `is_verified` and skip verified records.
3. **SoT Are Stable Handles** — Entity IDs in `sot_*` tables are permanent
4. **Provenance Is Required** — Every record needs `source_system` + `source_record_id` + `source_created_at`
5. **Identity By Identifier Only** — Email/phone only, NEVER match people by name alone
6. **Active Flows Are Sacred** — Changes to staff-facing pages/endpoints require Safety Gate validation (see `docs/ACTIVE_FLOW_SAFETY_GATE.md`)
7. **One Write Path Per User Action** — A single button click must produce exactly ONE INSERT into any destination table. Never create parallel write paths to the same table.
8. **Merge-Aware Queries** — All queries joining entity tables MUST filter `merged_into_*_id IS NULL`
9. **Pipeline Functions Must Reference Actual Schema** — Functions that reference columns must use actual column names. Verify columns exist with `information_schema.columns` in migrations.
10. **Ingest Must Be Serverless-Resilient** — Export `maxDuration`, scope processing to current upload, save intermediate progress, auto-reset stuck uploads, UI fire-and-forget + polling.
11. **ClinicHQ Relationships Must Not Assume Residency** — Trappers/staff have false resident links from trapping sites. For people with >3 clinichq resident links + active trapper/staff role, keep only highest-confidence as resident.
12. **Phone COALESCE Must Prefer Owner Phone Over Cell Phone** — In identity matching, always `COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')`. Cell phones are shared within households (spouses, family) and cause cross-linking when used as primary identity signal. See MIG_881.
13. **Display Surfaces Must Filter data_quality** — `v_map_atlas_pins`, `search_unified()`, and any volunteer/person-facing queries MUST exclude `data_quality IN ('garbage', 'needs_review')`. Ingest pipelines are independent and unaffected. See MIG_882.
14. **Entity Linking Must Re-run After Backfills** — After any backfill that creates `person_place_relationships` or `person_cat_relationships`, ALWAYS re-run `trapper.link_cats_to_places()` and/or `trapper.run_all_entity_linking()`. Backfills create the edges but downstream propagation only happens when the linking pipeline runs. MIG_884 demonstrated this: 4,542 edges were waiting because `link_cats_to_places()` hadn't been re-run after MIG_877.
15. **Owner Linking Must Support Phone-Only** — `link_appointments_to_owners()` currently requires `owner_email IS NOT NULL` (skips 106+ cats with phone-only contact). Any future version must handle `(owner_email IS NOT NULL OR owner_phone IS NOT NULL)` and call `find_or_create_person()` with phone when email is absent.
16. **ShelterLuv Outcomes Must Be Fully Processed** — 3,348 ShelterLuv adoption/foster events exist. `process_shelterluv_outcomes()` must process all of them to create `person_cat_relationships` for 1,461+ ShelterLuv-only cats. Run periodically until all events processed.
17. **Trapper-Appointment Linking Depends on Request Volume** — MIG_886 links appointments→requests→trappers. Only 289 requests exist (187 with trappers). Coverage (5.3%) grows organically as more requests are created via Atlas UI. Not a bug — structural ceiling from historical data sparsity.
18. **PetLink Cats Are External Registry Data** — 956 cats from PetLink bulk import have microchips but no FFSC appointments. These are expected unlinked cats — they exist in microchip registry but were never seen at FFSC clinic or ShelterLuv. Do not treat as a gap.
19. **PetLink Emails Are Fabricated — Confidence Filter Required** — FFSC staff fabricates emails for PetLink microchip registration (e.g., `gordon@lohrmanln.com`). MIG_887 classified 1,252 PetLink emails and lowered their confidence (0.1-0.2). ALL queries on `person_identifiers` for display or matching MUST include `AND pi.confidence >= 0.5`. person_identifiers.confidence has `NOT NULL DEFAULT 1.0` so non-PetLink records are unaffected. Never fall back to low-confidence emails in UI pre-fill or compose modals.
20. **ClinicHQ "Owner" Fields May Contain Site Names** — ClinicHQ appointment bookings sometimes use `Owner First Name` to store the trapping **site name** (e.g., "Silveira Ranch") and `Owner Last Name` to store the actual person's full name (e.g., "Toni Price"). `Owner Address` in these cases is the trapping site address (e.g., "San Antonio Rd"), not the person's home. This is a historical FFSC booking practice. When owner_info has no house number in the address, the place created may be street-only (e.g., "San Antonio Rd, Petaluma, CA 94952"). These are real trapping sites, not data bugs.
21. **Confidence >= 0.5 Filter Must Be Consistent Across All APIs** — Every API endpoint that reads `person_identifiers` for email/phone display must filter `AND confidence >= 0.5`. Endpoints already fixed: people/search, people/check-email, people/[id] (UI filter), requests/[id], cats/[id], requests/[id]/handoff, requests (PATCH). SQL function `data_engine_score_candidates()` also filters. Exception: `link_appointments_to_trappers()` (DB function, theoretical risk only since trappers don't have PetLink emails).
22. **TS Upload Route Must Mirror SQL Processor** — The TypeScript upload route (`/api/ingest/process/[id]/route.ts`) and SQL processor functions (MIG_573) must implement identical logic. SQL processor is source of truth. Key parity points: `should_be_person()` guard, `clinic_owner_accounts` routing, appointment linking, soft blacklist respect. See MIG_888.
23. **Organization Emails Must Be Soft-Blacklisted** — Org emails (`marinferals@yahoo.com`, etc.) must go in `data_engine_soft_blacklist` with `identifier_type = 'email'`. Shared emails auto-match to whoever registered first, creating phantom caretaker links for the wrong person and orphan duplicates for the actual person. MIG_888 added email soft blacklist check to `data_engine_score_candidates()`.
24. **Shared Identifiers Create Orphan Duplicates** — When `find_or_create_person()` encounters a taken identifier (email/phone already in `person_identifiers`), the new person gets NO identifiers (INSERT conflicts silently). Pattern: 10+ duplicates with zero identifiers = shared identifier collision. Fix: merge duplicates, soft-blacklist the shared identifier, seed a unique identifier on the canonical record.
25. **ClinicHQ Pseudo-Profiles Are NOT People** — "Owner First Name" in ClinicHQ stores site names/addresses/orgs (e.g., "5403 San Antonio Road Petaluma", "Silveira Ranch"). `classify_owner_name()` detects these. BOTH SQL processor AND TS upload route must use `should_be_person()` to filter. Pseudo-profiles go to `clinic_owner_accounts`, not `sot_people`. See MIG_573.
26. **Appointment Linking Must Respect Soft Blacklist** — Steps that link appointments to people via `person_identifiers` must filter out soft-blacklisted identifiers (`NOT EXISTS ... data_engine_soft_blacklist`), or they bypass the Data Engine's scoring. Applies to both SQL processor Step 6 and TS upload route Step 4. See MIG_888.

See `docs/ATLAS_NORTH_STAR.md` for full invariant definitions and real bug examples.

## Beacon Readiness — Gap Status (updated 2026-02-04)

| Metric | Before | After | Fix | Remaining |
|--------|--------|-------|-----|-----------|
| Cat-place coverage | 91.7% | 92.9% | MIG_884 backfill + requester role | 3,536 cats have no person link (ceiling) |
| Geocoding | 92.2% | 92.9% | MIG_885 re-queued 86 failed, max 5→10 | ~1,100 in queue, cron processing |
| Trapper-appointment | 3.2% | 5.3% | MIG_886 request chain (972 new) | Only 289 requests — grows with usage |
| Mortality | 138 | 138 | Cron limit 50→200; ShelterLuv done (MIG_874) | Comprehensive |

**What's solid:** Appointment-person (97.9%), disease tracking (2,178 tests, 93 places), colony estimates (2,995), intake events (3,707).

### Unlinked Cats Deep Dive (3,536 cats with no person_cat_relationships)

| Category | Count | Root Cause | Fix |
|----------|-------|------------|-----|
| ShelterLuv-only (no appointments) | 1,461 | SL adoption/foster events (3,348 total) not fully processed | Run `process_shelterluv_outcomes()` |
| ClinicHQ appointments, no contact info | 351 | Appointments have no owner_email or owner_phone | Cannot auto-link — no identifiers |
| ClinicHQ appointments, phone only | 106 | `link_appointments_to_owners()` requires `owner_email IS NOT NULL`, skips phone-only | **Future MIG: extend to phone-only** |
| ClinicHQ appointments, email exists | 205 | `link_appointments_to_owners()` LIMIT 2000 batch — may need multiple runs | Re-run entity linking pipeline |
| ClinicHQ, no appointments | 439 | Cat created from ClinicHQ but appointment has no cat_id link | Microchip matching or manual |
| PetLink-only (microchip registry) | 956 | Bulk PetLink import (2026-01-11) — registry cats never seen at FFSC | Expected — external registry data |
| Both ClinicHQ+ShelterLuv | 48 | Various | Mixed |
| No identifiers at all | 10 | ClinicHQ cats with no identifiers | Manual review |

### Trapper Assignment Gap (102 of 289 requests unassigned)

| Category | Count | Root Cause |
|----------|-------|------------|
| Airtable, never assigned | 69 | Genuinely no trapper recorded in Airtable |
| Airtable, "Client Trapping" | 24 | Pseudo-trapper (requester trapped themselves) — no real person_id |
| Atlas UI / Web Intake (new) | 9 | Not yet assigned — expected for new requests |

## Core Mission: Every Entity is Real and Distinct

**Atlas is the single source of truth for every real entity FFSC has ever interacted with:**

| Entity | Rule |
|--------|------|
| **Person** | Distinct records. Identity via email/phone only, NEVER name alone. |
| **Place** | Each physical location is distinct. Units are separate places. |
| **Cat** | Distinct records. Microchip is gold standard. |

> **When you search an address, you see ONLY data at that address.**
> Multi-unit complexes: units are children with their own data. Data from other addresses does NOT pollute the view.

**Two Complementary Layers:**
- **Layer 1 (Clean Data):** Centralized `find_or_create_*` functions, identity resolution via email/phone, audit trail, individualized places
- **Layer 2 (Ecological Predictions):** Calculations in VIEWS not stored on places, colony estimates in `place_colony_estimates`, Beacon visualizes on map

See `docs/ATLAS_MISSION_CONTRACT.md` for full alignment with Beacon.

## Two Tracks: Workflow vs Beacon

| Aspect | Track 1: Workflow (Be Careful) | Track 2: Beacon (More Freedom) |
|--------|-------------------------------|-------------------------------|
| Tables | `sot_people`, `sot_requests`, `sot_cats`, `web_intake_submissions` | `place_colony_estimates`, `cat_birth_events`, `cat_mortality_events`, `site_observations` |
| AI Role | Display assist only, NEVER modify SOT records | Active inference, freely infer colony sizes |
| Merging | Forbidden without proof | Encouraged for sites |
| Source | Must be explicit | Can be `'ai_parsed'` |

**Track 1 rules:** No inferring into SOT tables. Changes require `entity_edits` audit trail. Identity resolution ONLY via email/phone. Keep `source_system`/`source_record_id` intact.

**Track 2 rules:** AI can extract cat counts from notes, cluster places for estimates, estimate birth dates. All AI data labeled `source_type = 'ai_parsed'` in separate enrichment tables.

## Clinic Data Processing Rules

**Clinic data flows to Cats, Places, and Appointments — NOT necessarily to People.** See `docs/CLINIC_DATA_STRUCTURE.md`.

1. **Cats are booked under locations, not trappers** — The cat's link is to the PLACE, not the person who brought it
2. **Never create People from names alone** — Email OR phone required. `data_engine_resolve_identity()` returns NULL without identifiers.
3. **Places are the anchor** — Appointments ALWAYS link to a place. Cats link to places via appointments. Requests link to places. Beacon uses this for visualization.

| Has Email/Phone? | Person Created? | Cat Links To |
|------------------|-----------------|--------------|
| Yes | Yes | Place (via person) |
| No | No | Place (directly) |

## Beacon / Ground Truth

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.** FFSC clinic data = verified alterations (ground truth). External alteration rate ~ 2%. All alteration calculations use FFSC clinic records as numerator. Chapman mark-recapture: `N = ((M+1)(C+1)/(R+1)) - 1`. See `docs/architecture/colony-estimation.md`.

## MANDATORY: Centralized Functions

**NEVER create inline INSERT statements for core entities.** Always use these SQL functions:

| Entity | Function |
|--------|----------|
| Person | `trapper.find_or_create_person(email, phone, first, last, addr, source)` |
| Place | `trapper.find_or_create_place_deduped(address, name, lat, lng, source)` |
| Cat | `trapper.find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` |
| Request | `trapper.find_or_create_request(source, record_id, source_created_at, ...)` |
| Cat→Place | `trapper.link_cat_to_place(cat_id, place_id, rel_type, evidence_type, source_system, ...)` |
| Person→Cat | `trapper.link_person_to_cat(person_id, cat_id, rel_type, evidence_type, source_system, ...)` |
| Coord Place | `trapper.create_place_from_coordinates(lat, lng, display_name, source_system)` — 10m dedup |
| Place merge | `trapper.merge_place_into(loser_id, winner_id, reason, changed_by)` |
| Address relink | `trapper.relink_person_primary_address(person_id, new_place_id, new_address_id)` |

**Address safety:** `normalize_address()`, `extract_house_number()`, `address_safe_to_merge()` — always check before merging.

**Place family:** `get_place_family(place_id)` returns UUID[] of parent, children, siblings, and co-located places (within 1m). **NEVER use arbitrary distance radius for cross-place aggregation** — use this function.

See `docs/CENTRALIZED_FUNCTIONS.md` for full parameter signatures.

### source_system Values (use EXACTLY)

- `'airtable'` — All Airtable data (not 'airtable_staff' or 'airtable_project75')
- `'clinichq'` — All ClinicHQ data
- `'shelterluv'` — ShelterLuv API data
- `'volunteerhub'` — VolunteerHub API data
- `'web_intake'` — Web intake form submissions
- `'petlink'` — PetLink microchip data
- `'google_maps'` — Google Maps KML data
- `'atlas_ui'` — Atlas web app (pin-placing, manual edits)

See `docs/INGEST_GUIDELINES.md` for complete ingestion documentation.

### Source System Authority Map (MIG_875)

Each external system is **authoritative** for specific entity types. Code and Tippy must route queries to the correct source.

| System | Authoritative For | NOT Authoritative For |
|--------|------------------|----------------------|
| **ClinicHQ** | Clinic clients/owners, TNR procedures, medical records, microchips | Volunteers, program outcomes |
| **VolunteerHub** | Volunteer PEOPLE (trappers, fosters, clinic vols), user group memberships | Animals, outcomes, clinic data |
| **ShelterLuv** | Program animals, outcomes (adoption, foster placement, transfer, mortality), intake events | Volunteer people, clinic procedures |
| **Airtable** | Legacy requests, public intake submissions, Project 75 | Volunteer management, clinic data |

**Semantic Query Rules:**

| User Says | Means | Source |
|-----------|-------|--------|
| "Show me fosters" | Foster PEOPLE (volunteers) | VolunteerHub group "Approved Foster Parent" |
| "Show me foster cats" | Cats currently in foster | ShelterLuv Outcome.Foster events |
| "Show me trappers" | Trapper PEOPLE (volunteers) | VolunteerHub group "Approved Trappers" |
| "Show me adopters" | People who adopted cats | ShelterLuv Outcome.Adoption events |
| "Show me relo spots" | Relocation destination places | ShelterLuv Outcome.Adoption + Subtype=Relocation |
| "Show me volunteers" | All approved volunteers | VolunteerHub "Approved Volunteer" parent group |

**VolunteerHub Group Hierarchy:**
- Parent: "Approved Volunteer"
- Subgroups: "Approved Trappers", "Approved Foster Parent", "Clinic Volunteers"

**Database:** `trapper.source_semantic_queries` table + `trapper.v_source_authority_map` view. `orchestrator_sources.authority_domains` JSONB column.

### Attribution Windows

A cat is linked to a request if its appointment was within 6 months of request creation OR while the request was still active. **DO NOT** create custom time window logic — always use `v_request_alteration_stats` view. See `docs/architecture/attribution-windows.md`.

### Identity Matching

- **Email**: Exact match via `person_identifiers.id_value_norm`
- **Phone**: Use `trapper.norm_phone_us()` for normalization
- **Never match by name alone**

### Phone Display & Validation (UI Layer)

Use these TypeScript functions from `@/lib/formatters` for consistent phone display across all UI:

| Function | Purpose | Example |
|----------|---------|---------|
| `formatPhone()` | Display formatting | `7075551234` → `(707) 555-1234` |
| `isValidPhone()` | Validates 10 or 11 digits | `isValidPhone("707-555-1234")` → `true` |
| `extractPhone()` | Extract single valid phone from garbled input | `"(7073967923) 7073967923"` → `"7073967923"` |
| `extractPhones()` | Extract ALL valid phones from multi-phone fields | `"707 8782184 home 707 7910139"` → `["7078782184", "7077910139"]` |

**Important distinctions:**
- **SQL `norm_phone_us()`** — For identity matching/storage (returns 10-digit string)
- **TS `formatPhone()`** — For UI display only (returns formatted string)

**Known gap (INV-15):** `link_appointments_to_owners()` currently requires `owner_email IS NOT NULL`, skipping 106+ cats with phone-only contact info. Future migration should extend to handle `(owner_email IS NOT NULL OR owner_phone IS NOT NULL)`.

### Trapper Types

| Type | Is FFSC? | Description |
|------|----------|-------------|
| `coordinator` | Yes | FFSC staff coordinator |
| `head_trapper` | Yes | FFSC head trapper |
| `ffsc_trapper` | Yes | FFSC trained volunteer (completed orientation) |
| `community_trapper` | No | Signed contract only, limited, does NOT represent FFSC |

"Legacy Trapper" in Airtable = `ffsc_trapper`.

### Data Provenance

Always track: `source_system`, `source_record_id`, `source_created_at`. Log changes to `entity_edits` table.

### Request Lifecycle

```
new → triaged → scheduled → in_progress → completed
                    ↓
                on_hold → cancelled
```

When setting `completed` or `cancelled`, also set `resolved_at = NOW()`.

## Cat Count Semantic Distinction

**IMPORTANT:** `estimated_cat_count` and `total_cats_reported` are different concepts:

| Field | Meaning | Purpose |
|-------|---------|---------|
| `estimated_cat_count` | Cats still needing TNR | Request progress tracking |
| `total_cats_reported` | Total cats at location | Colony size for Beacon |
| `cat_count_semantic` | `'needs_tnr'` or `'legacy_total'` | Indicates field meaning |

Always use **"Cats Needing TNR"** in UI labels (not "Estimated Cats" or "Cat Count"). Add helper text: "Still unfixed (not total)".

## Multi-Source Data Transparency

When cats have data from multiple sources, use `record_cat_field_sources_batch()` in all ingest pipelines. Survivorship priority: `ClinicHQ > ShelterLuv > PetLink > Airtable > Legacy`. See `docs/CLAUDE_REFERENCE.md#multi-source-data-transparency` for details.

## Map & Search Rules

- **Search API must NOT filter by type** — use `/api/search?q=...&limit=8&suggestions=true` (no `type=` param)
- **Filter results by coordinates**, not entity type: `s.metadata?.lat && s.metadata?.lng`
- **Google Places → Atlas matching**: check `atlasPins` (not legacy `places` array), use coordinate tolerance `0.001` degrees (~111m)
- **Multi-unit places NEVER auto-link** to Google Maps entries — flagged with `requires_unit_selection = TRUE`
- **GM notes**: Always query both `place_id` and `linked_place_id` against full `get_place_family()` result

## Import Stability Guarantees

Manual edits made through the Atlas UI are **protected from being overwritten** by automated data imports. The system implements a "fill-only-if-empty" pattern:

| Protection | Mechanism | Evidence |
|-----------|-----------|----------|
| `primary_address_id` | Trigger `auto_set_primary_address()` only fires when `primary_address_id IS NULL` | MIG_557:63-80 |
| `person_place_relationships` | All imports use `ON CONFLICT DO NOTHING` | MIG_313:271 |
| `find_or_create_person()` | Never touches `primary_address_id`; only returns person_id | MIG_315:700-723 |
| `process_clinichq_owner_info()` | Creates relationships only, never modifies person fields | MIG_313:246-275 |
| Manual address changes | Audited via `entity_edits` table through `relink_person_primary_address()` | MIG_794 |
| Relationship deletion | Only `source_system = 'atlas_ui'` relationships can be deleted via API | API enforcement |

**Safe to do manually:**
- Change a person's primary address (old address remains as relationship)
- Add/remove person-place relationships via UI
- Edit person names (old name preserved as alias)
- Change entity_type, trapping_skill fields

**What imports CAN do:**
- Add NEW person_place_relationships (never overwrite existing)
- Set primary_address_id ONLY if currently NULL
- Create new entities via `find_or_create_*` functions

## Don't Do

**Entity Creation:**
- **Don't INSERT directly into `sot_people`** — Use `find_or_create_person()`
- **Don't INSERT directly into `places`** — Use `find_or_create_place_deduped()`
- **Don't INSERT directly into `sot_cats`** — Use `find_or_create_cat_by_microchip()` for chipped cats, or `enrich_cat()` for unchipped cats with `clinichq_animal_id`
- **Don't INSERT directly into `sot_requests`** — Use `find_or_create_request()`
- **Don't create cats without at least one identifier** — `enrich_cat()` requires microchip, clinichq_animal_id, or airtable_id
- **Don't INSERT directly into `cat_place_relationships`** — Use `link_cat_to_place()` with evidence validation
- **Don't INSERT directly into `person_cat_relationships`** — Use `link_person_to_cat()` with evidence validation
- Don't INSERT directly into `place_contexts` — Use `assign_place_context()`
- **Don't use custom `source_system` values** — Use the exact values listed above

**Identity & Merging:**
- Don't match people by name only — Email/phone only
- **Don't merge people without `person_safe_to_merge()`** — Use `/admin/person-dedup`
- **Don't merge places without `place_safe_to_merge()`** — Use `/admin/place-dedup`
- Don't write queries joining entity tables without `merged_into_*_id IS NULL` filters
- Don't link one person's cats to another person's place without verified evidence

**Data Integrity:**
- Don't create fixed time windows — Use `v_request_alteration_stats` view
- Don't skip `entity_edits` logging for important changes
- Don't hardcode phone/email patterns — Use normalization functions
- Don't confuse colony size (estimate) with cats caught (verified clinic data)
- Don't return 404 for merged entities — Check `merged_into_*_id` and redirect
- Don't forget `process_clinichq_owner_info()` after ClinicHQ ingest
- **Don't COALESCE Owner Cell Phone before Owner Phone** — Cell phones are shared in households, causing cross-linking. Always prefer `Owner Phone` for identity matching (MIG_881)
- **Don't match on PetLink emails without confidence filter** — Staff fabricates emails for PetLink microchip registration (street-address domains like `gordon@lohrmanln.com`). All PetLink emails get confidence ≤ 0.5 in `person_identifiers`. Identity matching queries MUST filter `pi.confidence >= 0.5`. Use `classify_petlink_email()` to detect fabricated vs likely-real (MIG_887)
- **Don't modify TS upload route without checking MIG_573 SQL processor for parity** — INV-22. Both paths must implement identical logic: `should_be_person()`, `clinic_owner_accounts`, soft blacklist filters
- **Don't assign org emails as personal identifiers without soft-blacklisting** — INV-23. Add shared org emails to `data_engine_soft_blacklist` with `identifier_type = 'email'`
- **Don't assume `find_or_create_person()` handles shared identifiers** — INV-24. It creates orphan duplicates with zero identifiers when email/phone conflicts. Merge + soft-blacklist + seed identifier
- **Don't link cats to ALL person_place_relationships** — INV-26. Use `link_cats_to_appointment_places()` (MIG_889) which uses `inferred_place_id` from most recent appointment. `link_cats_to_places()` now uses LIMIT 1 per person

**Map:**
- Don't hardcode `type=place` in map search API calls — excludes people
- Don't check coordinate matches against legacy `places` array — use `atlasPins`
- Don't use tight coordinate tolerance (< 0.001) for Google-Atlas matching
- Don't manually cluster pins — use `markerClusterGroup`
- Don't create a `historical_pins` layer — removed in MIG_820
- Don't set `is_address_backed = TRUE` without valid `sot_address_id`
- Don't bypass `create_place_from_coordinates()` for coordinate-only places
- **Don't use `ST_DWithin` for cross-place aggregation** — use `get_place_family()`

**UI:**
- **Don't use `AddressAutocomplete` for place input** — Use `PlaceResolver` component. AddressAutocomplete is only for address correction on `places/[id]`.
- Don't hardcode place context types — Use `place_context_types` table
- Don't assume single trapper per request — Use `request_trapper_assignments`

## Tippy Documentation Requirements

**When making data quality fixes or significant changes**, update `docs/TIPPY_DATA_QUALITY_REFERENCE.md`:

1. **Data Quality Fix Log:** Problem, Investigation, Solution, Result (quantified)
2. **Development Session Log:** Context, Key Discoveries, Changes Made, Staff Impact

Tippy uses this to explain data discrepancies to staff and provide context on system limitations.

## File Locations

```
/apps/web/          - Next.js web application
/scripts/ingest/    - Data sync scripts
/scripts/jobs/      - Enrichment and parsing jobs (AI-powered)
/sql/schema/sot/    - Database migrations
/docs/              - Documentation
```

## Key Documentation

| Document | What to read it for |
|----------|-------------------|
| `docs/ATLAS_NORTH_STAR.md` | System layers (L1-L7), invariants, Do-Not-Break contract, known failure modes |
| `docs/ATLAS_MISSION_CONTRACT.md` | Core mission, entity principles, Beacon science |
| `docs/CENTRALIZED_FUNCTIONS.md` | Full function signatures for all entity creation |
| `docs/INGEST_GUIDELINES.md` | Data ingestion rules, patterns, templates |
| `docs/DATA_FLOW_ARCHITECTURE.md` | Complete data pipeline from sources to Beacon |
| `docs/ARCHITECTURE_ENTITY_RESOLUTION.md` | Data Engine scoring, household modeling, review queue |
| `docs/CLINIC_DATA_STRUCTURE.md` | ClinicHQ data flow rules |
| `docs/ACTIVE_FLOW_SAFETY_GATE.md` | Safety checklist for changes to active workflows |
| `docs/architecture/attribution-windows.md` | Attribution window rules and matching logic |
| `docs/architecture/colony-estimation.md` | Colony size estimation methodology |
| `docs/PLACE_CONTEXTS.md` | Place context tagging system |
| `docs/TIPPY_VIEWS_AND_SCHEMA.md` | Tippy schema navigation, view catalog |
| `docs/TIPPY_DATA_QUALITY_REFERENCE.md` | Data quality fixes for Tippy context |
| `docs/CLAUDE_REFERENCE.md` | Detailed reference: integrations, map architecture, views catalog, pipelines |
