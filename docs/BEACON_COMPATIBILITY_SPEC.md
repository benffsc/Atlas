# Beacon Compatibility Spec

Data contracts for Beacon Firebase consumers to follow for eventual merge compatibility with Atlas/Helix.

**Audience:** Daniel Chen (Beacon Firebase engineer), future platform consumers
**Linear:** FFS-696
**Last updated:** 2026-03-19

---

## Table of Contents

1. [Core Principles](#core-principles)
2. [ID Format & Timestamps](#id-format--timestamps)
3. [Entity Shapes](#entity-shapes)
4. [Enum Values](#enum-values)
5. [Provenance Pattern](#provenance-pattern)
6. [API Response Shapes](#api-response-shapes)
7. [Identity Resolution Contract](#identity-resolution-contract)
8. [Merge Protocol](#merge-protocol)
9. [Config System](#config-system)
10. [Centralized Entity Functions](#centralized-entity-functions)

---

## Core Principles

These invariants apply to ALL data across ALL layers. Beacon MUST respect these from day one to avoid painful rework at merge time.

1. **No Data Disappears** -- Use `merged_into_*` chains, never hard delete entities.
2. **Manual > AI** -- Staff-verified data (`is_verified = TRUE`) cannot be overwritten by AI/inferred data.
3. **SoT Are Stable Handles** -- Entity IDs in source-of-truth tables are permanent. Never recycle or reassign UUIDs.
4. **Provenance Is Required** -- Every record needs `source_system` + `source_record_id` + `source_created_at`.
5. **Identity By Identifier Only** -- Match people by email/phone only. NEVER match by name alone.
6. **One Write Path Per User Action** -- Single INSERT per button click, no parallel write paths.
7. **Merge-Aware Queries** -- All queries MUST filter `merged_into_*_id IS NULL`.

---

## ID Format & Timestamps

### IDs

All entity IDs are **UUID v4** strings. Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` where `y` is one of `[8, 9, a, b]`.

```
Example: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
```

Beacon MUST use UUIDs (not Firebase auto-IDs or integer sequences) for all entities that will sync to Atlas. If Beacon uses Firebase-native IDs internally, it must also store a `uuid` field for Atlas compatibility.

### Timestamps

All timestamps are **ISO 8601** strings in UTC when transmitted over the API. In the database they are stored as `TIMESTAMPTZ`.

| Field | Meaning | Required |
|-------|---------|----------|
| `created_at` | When the record was created in Atlas | Always present |
| `updated_at` | When the record was last modified | Always present |
| `source_created_at` | When the record was created in the **original source system** | Required for provenance |

Beacon should store `source_created_at` as the timestamp from its own system, and `created_at` as the timestamp when the record enters Atlas during sync.

---

## Entity Shapes

These are the canonical interfaces that Atlas API routes return. Beacon data must be transformable into these shapes at merge time.

### Cat (`VCatListRow`)

Source: `apps/web/src/lib/types/view-contracts.ts`

```typescript
interface VCatListRow {
  cat_id: string;             // UUID, primary key
  display_name: string;       // Cat name (may be "Unknown" for unnamed cats)
  sex: string | null;         // "male" | "female" | "unknown"
  altered_status: string | null; // "altered" | "intact" | "unknown"
  breed: string | null;
  microchip: string | null;   // 9-15 digit alphanumeric, primary identifier
  quality_tier: string;       // Data quality classification
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;   // UUID of primary location
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;         // ISO 8601
  last_appointment_date: string | null;
  appointment_count: number;
  source_system: string | null;
  photo_url: string | null;
  is_deceased: boolean;
  weight_lbs: number | null;
  age_group: string | null;
  health_flags: Array<{
    category: string;
    key: string;
    label: string;
    color?: string | null;
  }>;
  current_status: string | null;
}
```

**Key identifiers for cats:**
- `microchip` -- Primary identifier. 9-15 digit alphanumeric string, cleaned and uppercased.
- `clinichq_animal_id` -- Secondary identifier for cats without microchips (e.g., euthanasia cases, kittens that died before chipping).

### Person (`VPersonListRow`)

```typescript
interface VPersonListRow {
  person_id: string;          // UUID
  display_name: string;
  account_type: string | null;
  is_canonical: boolean;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
  source_quality: string;
  primary_role?: string | null;
  trapper_type?: string | null;
  do_not_contact?: boolean;
  entity_type?: string | null; // "individual" | "household" | "organization" | "clinic" | "rescue"
}
```

### Person Detail (`VPersonDetailRow`)

```typescript
interface VPersonDetailRow {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null; // Non-null means this record was merged
  created_at: string;
  updated_at: string;
  cats: unknown[] | null;
  places: unknown[] | null;
  person_relationships: unknown[] | null;
  cat_count: number;
  place_count: number;
  is_valid_name: boolean;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  identifiers: unknown[] | null;  // Array of { type, value, confidence }
  entity_type: string | null;
  verified_at: string | null;     // Non-null = staff-verified (Manual > AI)
  verified_by: string | null;
  verified_by_name: string | null;
  data_quality: string | null;
  primary_place_id: string | null;
  partner_orgs: unknown[] | null;
  associated_places: unknown[] | null;
  aliases: unknown[] | null;
}
```

### Place (`VPlaceListRow`)

```typescript
interface VPlaceListRow {
  place_id: string;           // UUID
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;  // See PLACE_KIND enum
  locality: string | null;    // City name
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
  last_appointment_date?: string | null;
  active_request_count?: number;
  watch_list?: boolean;
  disease_flags?: Array<{
    disease_key: string;
    short_code: string;
    status: string;
    color?: string | null;
    positive_cat_count?: number;
  }>;
}
```

### Place Detail (`VPlaceDetailRow`)

```typescript
interface VPlaceDetailRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: unknown[] | null;
  people: unknown[] | null;
  place_relationships: unknown[] | null;
  cat_count: number;
  person_count: number;
}
```

### Request (`VRequestListRow`)

```typescript
interface VRequestListRow {
  request_id: string;         // UUID
  status: string;             // See REQUEST_STATUS enum
  priority: string;           // "urgent" | "high" | "normal" | "low"
  summary: string | null;
  estimated_cat_count: number | null;  // Cats still needing TNR
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  source_created_at: string | null;    // Provenance timestamp
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  linked_cat_count: number;
  is_legacy_request: boolean;
  active_trapper_count: number;
  place_has_location: boolean;
  data_quality_flags: string[];
  no_trapper_reason: string | null;
  primary_trapper_name: string | null;
  assignment_status: string;
}
```

### Appointment (`VAppointmentDetailRow`)

```typescript
interface VAppointmentDetailRow {
  appointment_id: string;     // UUID
  appointment_date: string;
  cat_id: string | null;
  cat_name: string | null;
  cat_microchip: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  procedure_type: string | null;
  altered_status: string | null;
  source_system: string;
  created_at: string;
}
```

### Pagination Wrapper

All list endpoints return paginated results:

```typescript
interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

---

## Enum Values

Atlas uses a layered enum system. The flow is:

```
form-options.ts (canonical definitions with labels)
      |
      v
enums.ts (extracts value arrays for API validation)
      |
      v
API routes (validate incoming values against enums.ts)
      |
      v
Database CHECK constraints (enforce at storage layer)
```

Beacon MUST use these exact `value` strings. Labels can differ per org, but values must match for data compatibility.

### Request Status

4 primary + 2 special + 8 legacy statuses:

| Status | Type | Description |
|--------|------|-------------|
| `new` | Primary | Awaiting initial review |
| `working` | Primary | Actively being handled |
| `paused` | Primary | On hold |
| `completed` | Primary | Finished |
| `redirected` | Special | Sent to another organization (terminal) |
| `handed_off` | Special | Transferred to another request (terminal) |
| `triaged` | Legacy | Maps to `new` |
| `scheduled` | Legacy | Maps to `working` |
| `in_progress` | Legacy | Maps to `working` |
| `on_hold` | Legacy | Maps to `paused` |
| `cancelled` | Legacy | Maps to `completed` |
| `partial` | Legacy | Maps to `completed` |
| `needs_review` | Legacy | Maps to `new` |
| `active` | Legacy | Maps to `working` |

Beacon should only SET primary or special statuses on new records. Legacy statuses exist for historical data compatibility.

**Transition rules:**
```
new -> working, paused, completed, redirected, handed_off
working -> paused, completed, redirected, handed_off
paused -> new, working, completed, redirected, handed_off
completed -> (terminal, no transitions)
redirected -> (terminal)
handed_off -> (terminal)
```

### Request Priority

```
"urgent" | "high" | "normal" | "low"
```

### Cat Sex

```
"male" | "female" | "unknown"
```

### Altered Status

```
"altered" | "intact" | "unknown"
```

### Place Kind

```
"unknown" | "residential_house" | "apartment_unit" | "apartment_building" |
"business" | "clinic" | "neighborhood" | "outdoor_site" | "mobile_home_space"
```

### Property Type

```
"private_home" | "condo_townhome" | "duplex_multiplex" | "apartment_complex" |
"mobile_home_park" | "farm_ranch" | "rural_unincorporated" | "business" |
"industrial" | "public_park" | "school_campus" | "church_religious" |
"government_municipal" | "vacant_lot" | "other"
```

### Person Entity Type

```
"individual" | "household" | "organization" | "clinic" | "rescue"
```

### Person-Place Role

```
"resident" | "property_owner" | "colony_caretaker" | "colony_supervisor" |
"feeder" | "transporter" | "referrer" | "neighbor" | "site_contact" |
"works_at" | "volunteers_at" | "contact_address" |
"owner" | "manager" | "caretaker" | "requester" | "trapper_at"
```

### Trapper Type

```
"coordinator" | "head_trapper" | "ffsc_trapper" | "community_trapper" | "volunteer"
```

### Hold Reason

```
"weather" | "callback_pending" | "access_issue" | "resource_constraint" |
"client_unavailable" | "scheduling_conflict" | "trap_shy" | "other"
```

### Permission Status

```
"yes" | "pending" | "no" | "not_needed" | "unknown"
```

### Colony Duration

```
"under_1_month" | "1_to_6_months" | "6_to_24_months" | "over_2_years" | "unknown"
```

### Count Confidence

```
"exact" | "good_estimate" | "rough_guess" | "unknown"
```

### Feeding Frequency

```
"daily" | "free_fed" | "few_times_week" | "occasionally" | "rarely" | "not_fed"
```

### Eartip Estimate

```
"none" | "few" | "some" | "most" | "all" | "unknown"
```

### Death Cause

```
"unknown" | "natural" | "vehicle" | "predator" | "disease" | "euthanasia" |
"injury" | "starvation" | "weather" | "other"
```

### Date Precision

```
"exact" | "week" | "month" | "season" | "year" | "estimated"
```

### Resolution Outcome

```
"successful" | "partial" | "unable_to_complete" | "no_longer_needed" | "referred_out"
```

### Kitten Assessment Status

```
"pending" | "assessed" | "follow_up" | "not_assessing" | "placed"
```

### Kitten Assessment Outcome

```
"taken_in" | "tnr" | "redirected" | "temp_hold" | "no_action"
```

### Call Type

```
"pet_spay_neuter" | "wellness_check" | "single_stray" | "colony_tnr" |
"kitten_rescue" | "medical_concern" | "relocation" | "caretaker_support" | "info_only"
```

### Preferred Contact Method

```
"call" | "text" | "email"
```

---

## Provenance Pattern

Every entity record in Atlas tracks where it came from. This is non-negotiable for data integrity and multi-system merges.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `source_system` | `TEXT NOT NULL` | Which system created this record |
| `source_record_id` | `TEXT` | The ID of this record in the source system |
| `source_created_at` | `TIMESTAMPTZ` | When the record was created in the source system |

### Valid `source_system` Values

| Value | System | Authoritative For |
|-------|--------|-------------------|
| `airtable` | Airtable | Legacy requests, public intake, Project 75 |
| `clinichq` | ClinicHQ | Clinic clients, TNR procedures, medical records, microchips |
| `shelterluv` | ShelterLuv | Program animals, outcomes (adoption, foster, mortality), intake |
| `volunteerhub` | VolunteerHub | Volunteer people (trappers, fosters), user group memberships |
| `web_intake` | Web Intake | Public web form submissions |
| `petlink` | PetLink | Microchip registry data |
| `google_maps` | Google Maps | Place geocoding and address normalization |
| `atlas_ui` | Atlas UI | Records created directly by staff in the Atlas interface |

### Beacon Integration

Beacon will register its own `source_system` value(s) before the merge. Proposed convention:

```
"beacon"           -- For records created in the Beacon app
"beacon_firebase"  -- If distinguishing Firebase-origin data is needed
```

The exact value(s) will be agreed upon before sync is implemented. Once registered, they become permanent -- source_system values are never renamed or recycled.

### Source Confidence

When multiple systems provide data about the same entity, the source system determines which value "wins" (survivorship):

| Source System | Confidence |
|---------------|------------|
| `clinichq` | 0.95 |
| `shelterluv` | 0.90 |
| `airtable` | 0.70 |
| `atlas_ui` | 0.65 |
| `web_intake` | 0.60 |

Beacon should propose its confidence level based on its data verification model.

---

## API Response Shapes

All Atlas API routes use a standardized envelope format.

### Success Response

```typescript
interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    limit: number;
    offset: number;
    hasMore?: boolean;
  };
}
```

Example:

```json
{
  "success": true,
  "data": {
    "cats": [
      { "cat_id": "abc-123", "display_name": "Whiskers", "sex": "female" }
    ]
  },
  "meta": {
    "total": 142,
    "limit": 50,
    "offset": 0
  }
}
```

### Error Response

```typescript
interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code: number;       // HTTP status code
    details?: unknown;  // Optional structured error details
  };
}
```

Example:

```json
{
  "success": false,
  "error": {
    "message": "Invalid cat ID format",
    "code": 400,
    "details": { "field": "cat_id", "received": "not-a-uuid" }
  }
}
```

### Standard HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, PATCH, PUT |
| 201 | Created | Successful POST (new entity) |
| 400 | Bad Request | Invalid input, malformed UUID, enum validation failure |
| 401 | Unauthorized | Missing or invalid auth |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Entity does not exist |
| 409 | Conflict | Duplicate entry, merge conflict |
| 422 | Unprocessable Entity | Well-formed request but semantically invalid |
| 500 | Internal Server Error | Unexpected failures |

### Pagination

All list endpoints accept:

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `limit` | integer | 50 | 100 |
| `offset` | integer | 0 | -- |

Invalid values (negative, NaN) are silently corrected to defaults.

### Client-Side Consumption

Atlas provides a client utility that automatically unwraps the `{ success, data }` envelope:

```typescript
// Automatic unwrapping
const cats = await fetchApi<{ cats: VCatListRow[] }>("/api/cats?limit=50");
// cats = { cats: [...] }  (already unwrapped)

// With pagination metadata
const result = await fetchApiWithMeta<{ cats: VCatListRow[] }>("/api/cats");
// result.data = { cats: [...] }
// result.meta = { total: 142, limit: 50, offset: 0 }
```

Beacon consumers should implement equivalent unwrapping or handle both formats:
```typescript
const data = json.success === true && "data" in json ? json.data : json;
```

---

## Identity Resolution Contract

Atlas uses a probabilistic identity resolution engine (Data Engine) that matches people by identifiers, not names.

### Rules

1. **Email and phone are the only matching signals.** Names are used for scoring weight, never as standalone match criteria.
2. **Phone matching requires address verification.** Same phone + different address = different household members, not the same person. Phone match must verify address similarity (> 0.5 score) or address unknown.
3. **PetLink emails are fabricated.** All `person_identifiers` queries for display/matching MUST include `AND confidence >= 0.5` to exclude synthetic identifiers.
4. **Phone order matters.** Always prefer Owner Phone over Cell Phone. Cell phones are shared across households.

### Person Identifiers Table

```
person_identifiers
  id            UUID PRIMARY KEY
  person_id     UUID NOT NULL REFERENCES sot.people
  id_type       TEXT NOT NULL         -- "email" | "phone"
  id_value      TEXT NOT NULL         -- Raw value
  id_value_norm TEXT NOT NULL         -- Normalized value (lowercase email, 10-digit phone)
  confidence    NUMERIC DEFAULT 1.0   -- [0.0, 1.0], filter >= 0.5 for display
  source_system TEXT
  created_at    TIMESTAMPTZ

  UNIQUE (id_type, id_value_norm)     -- An identifier belongs to exactly one person
```

### Scoring Model

| Signal | Weight | Example |
|--------|--------|---------|
| Email match | 40% | `john@example.com` matches existing |
| Phone match | 25% | `7075551234` matches existing |
| Name similarity | 25% | Jaro-Winkler >= 0.75 required for Phase 0.5 guard |
| Address context | 10% | Same address adds confidence |

### Decision Thresholds

| Score | Decision | Action |
|-------|----------|--------|
| >= 0.95 | `auto_match` | Return existing person_id |
| 0.50 -- 0.94 | `review_pending` | Create new entity, flag for staff review |
| < 0.50 | `new_entity` | Create new person |

These thresholds are configurable via `ops.app_config`:
- `identity.auto_match_weight` (default: 0.95)
- `identity.review_weight` (default: 0.50)
- `identity.phase05_name_similarity` (default: 0.75)
- `identity.phone_hub_threshold` (default: 10)
- `identity.email_hub_threshold` (default: 5)

### What Beacon Must Do

Beacon MUST store email and phone as separate, normalized identifiers -- not embedded in a user profile document. At merge time, the Data Engine will run identity resolution against these identifiers.

Beacon MUST NOT:
- Match people by name alone
- Assume two records with the same phone are the same person (address check required)
- Store organization emails (e.g., `marinferals@yahoo.com`) as person identifiers -- these go on a soft blacklist

---

## Merge Protocol

Atlas never hard-deletes entities. When duplicates are found, one record is "merged into" the other.

### Merge Chain Pattern

```
Loser record:  merged_into_person_id = <winner_id>    -- Loser points to winner
Winner record: merged_into_person_id = NULL            -- Winner is canonical
```

Every query MUST filter:
```sql
WHERE merged_into_person_id IS NULL    -- For people
WHERE merged_into_place_id IS NULL     -- For places
WHERE merged_into_cat_id IS NULL       -- For cats
```

### Merge Safety Checks

Before any merge, call the corresponding safety check function:

| Entity | Safety Function |
|--------|----------------|
| Person | `sot.person_safe_to_merge(loser_id, winner_id)` |
| Place | `sot.place_safe_to_merge(loser_id, winner_id)` |
| Cat | `sot.cat_safe_to_merge(loser_id, winner_id)` |

These functions check for:
- Circular merge chains
- Already-merged records
- Conflicting verified data
- Cross-entity type merges (you cannot merge a person into a place)

### Merge Function

```sql
sot.merge_place_into(
  p_loser_id    UUID,
  p_winner_id   UUID,
  p_reason      TEXT,       -- Why the merge happened
  p_changed_by  TEXT        -- Who initiated it
)
```

The merge function:
1. Validates via `*_safe_to_merge()`
2. Transfers all relationships (cat-place, person-place, etc.) from loser to winner
3. Sets `loser.merged_into_*_id = winner_id`
4. Logs to `ops.entity_edits`
5. Does NOT delete the loser record

### Verified Data Protection

Records where `is_verified = TRUE` (staff-confirmed) cannot be overwritten by inferred or automated data. This is the "Manual > AI" invariant.

| Field | `is_verified` | Can Be Overwritten By |
|-------|---------------|----------------------|
| Person name | `TRUE` | Only staff via UI |
| Person name | `FALSE` | Data Engine, ingest pipeline |
| Cat microchip | `TRUE` | Only staff via UI |
| Place address | `TRUE` | Only staff via UI |

Beacon should implement the same pattern: once a staff member verifies a field, automated processes must not overwrite it.

---

## Config System

Atlas uses a key-value config table for all runtime configuration.

### Schema

```sql
ops.app_config (
  key       TEXT PRIMARY KEY,    -- Dot-notation path, e.g., "map.default_center_lat"
  value     JSONB NOT NULL,      -- Any JSON value
  category  TEXT NOT NULL,        -- Grouping for admin UI
  label     TEXT,                 -- Human-readable name
  description TEXT               -- Help text
)
```

### Access Patterns

**Server-side (TypeScript):**
```typescript
const value = await getServerConfig("map.default_center_lat", 38.4405);
```

**SQL:**
```sql
SELECT ops.get_config('map.default_center_lat', '38.4405')::NUMERIC;
SELECT ops.get_config_numeric('identity.auto_match_weight', 0.95);
```

**Client-side (React):**
```typescript
const { value, loading } = useAppConfig("map.default_center_lat", 38.4405);
```

### Seeding for New Orgs

When onboarding a new org (the white-label scenario), seed `ops.app_config` with org-specific values. Categories include:

| Category | Examples |
|----------|----------|
| `map` | `default_center_lat`, `default_center_lng`, `default_zoom` |
| `identity` | `auto_match_weight`, `review_weight`, `phone_hub_threshold` |
| `display` | `org_name`, `org_short_name`, `primary_color` |
| `alerts` | `high_colony_threshold`, `disease_alert_threshold` |
| `triage` | `urgency_scoring_weights` |

Beacon should plan for per-org configuration from the start, using a similar key-value structure rather than hardcoding org-specific values.

---

## Centralized Entity Functions

Atlas prohibits direct INSERT statements to source-of-truth tables. All entity creation goes through centralized functions that enforce deduplication, identity resolution, normalization, and audit trails.

### Function Reference

| Entity | Function | Key Parameters |
|--------|----------|----------------|
| Person | `sot.find_or_create_person()` | email, phone, first_name, last_name, source_system |
| Place | `sot.find_or_create_place_deduped()` | formatted_address, display_name, lat, lng, source_system |
| Cat (with microchip) | `sot.find_or_create_cat_by_microchip()` | microchip, name, sex, breed, altered_status, source_system |
| Cat (no microchip) | `sot.find_or_create_cat_by_clinichq_id()` | animal_id, name, sex, source_system |
| Request | `ops.find_or_create_request()` | source_system, source_record_id, source_created_at, place_id, summary |
| Cat-Place link | `sot.link_cat_to_place()` | cat_id, place_id, relationship_type, evidence_type |
| Person-Cat link | `sot.link_person_to_cat()` | person_id, cat_id, relationship_type, evidence_type |
| Place merge | `sot.merge_place_into()` | loser_id, winner_id, reason, changed_by |

### What These Functions Do

1. **Validate input** -- Reject junk data (test names, PO boxes, invalid microchips)
2. **Normalize** -- Lowercase emails, 10-digit phones, uppercase microchips, standardize addresses
3. **Deduplicate** -- Check for existing records before creating new ones
4. **Resolve identity** -- Run Data Engine scoring for person records
5. **Track provenance** -- Set `source_system`, `source_record_id`, `source_created_at`
6. **Queue follow-ups** -- Auto-queue addresses for geocoding, flag records for review
7. **Return existing or new** -- Idempotent: same input returns same entity

### Beacon Implication

When Beacon data syncs to Atlas, it should flow through these functions rather than direct inserts. This means Beacon's sync adapter must:

1. Map Beacon fields to function parameters
2. Call the appropriate `find_or_create_*` function
3. Handle the returned UUID as the Atlas-canonical ID
4. Store the Atlas UUID back in Beacon for future reference

### Monitoring

```sql
-- View pending identity reviews (matches scoring 0.50-0.94)
SELECT * FROM sot.v_data_engine_review_queue;

-- Audit all identity decisions for an email
SELECT * FROM sot.match_decisions
WHERE input_data->>'email' = 'jane@example.com'
ORDER BY created_at DESC;

-- Entity edit history
SELECT * FROM ops.entity_edits
WHERE entity_type = 'person' AND entity_id = '<uuid>'
ORDER BY created_at DESC;
```

---

## Beacon Analytics Views

Atlas already has Beacon-specific analytics views. These are the interfaces Beacon should consume:

### Zone Alteration Rollup (`VZoneAlterationRollupRow`)

Aggregated TNR metrics by geographic zone.

```typescript
interface VZoneAlterationRollupRow {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  service_zone: string;
  centroid_lat: number;
  centroid_lng: number;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  zone_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  appointments_last_90d: number;
  alterations_last_90d: number;
  estimated_population: number | null;
  adequate_estimates: number;
  total_estimates: number;
}
```

### Place Comparison (`BeaconPlaceComparisonRow`)

Side-by-side metrics for comparing locations.

```typescript
interface BeaconPlaceComparisonRow {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  lat: number;
  lng: number;
  service_zone: string | null;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  colony_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  first_appointment_date: string | null;
  estimated_population: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
  sample_adequate: boolean | null;
  people_count: number;
  days_since_last_activity: number | null;
}
```

### Population Estimate (`BeaconPopulationEstimate`)

Chapman mark-recapture estimates for colony size.

```typescript
interface BeaconPopulationEstimate {
  place_id: string;
  estimated_population: number;
  ci_lower: number;
  ci_upper: number;
  marked_count: number;
  capture_count: number;
  recapture_count: number;
  sample_adequate: boolean;
  confidence_level: string;
  observation_start: string;
  observation_end: string;
  last_calculated_at: string;
}
```

### Map Data Filtered (`BeaconMapDataFilteredRow`)

Map pin data with date-range filtering.

```typescript
interface BeaconMapDataFilteredRow {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  lat: number;
  lng: number;
  service_zone: string | null;
  place_kind: string | null;
  cat_count: number;
  altered_count: number;
  intact_count: number;
  alteration_rate_pct: number | null;
  appointment_count: number;
  request_count: number;
  last_activity_date: string | null;
  colony_status: string;
}
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/types/view-contracts.ts` | All entity shape interfaces |
| `apps/web/src/lib/form-options.ts` | Canonical form option values with labels |
| `apps/web/src/lib/enums.ts` | Central enum registry for API validation |
| `apps/web/src/lib/request-status.ts` | Request status system (states, transitions, mapping) |
| `apps/web/src/lib/api-response.ts` | API response envelope helpers |
| `apps/web/src/lib/api-client.ts` | Client-side API consumption utilities |
| `apps/web/src/lib/api-validation.ts` | Server-side validation (UUID, pagination, enums) |
| `docs/CENTRALIZED_FUNCTIONS.md` | Full function signatures for entity creation |
