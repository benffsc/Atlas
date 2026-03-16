# Legacy Request Enhancement & Alteration Rate

## Overview

Atlas calculates alteration rates for TNR requests by correlating request dates with clinic procedure records from ClinicHQ. This feature helps measure TNR program effectiveness and provides a pathway to upgrade legacy Airtable requests to modern Atlas format.

---

## Data Model

### Time Window

For each request, we define a 12-month data window centered on the request date:
- **Window Start**: `request_date - 6 months`
- **Window End**: `request_date + 6 months`

For legacy Airtable requests, we use `source_created_at` (the original Airtable timestamp) as the request date.

### Cat Matching Rules

Cats are linked to requests using a multi-tier matching system with confidence scoring:

| Match Type | Confidence | Description |
|------------|------------|-------------|
| `explicit_link` | 100% | Cat explicitly linked via `request_cat_links` table |
| `place_and_requester` | 95% | Cat at same place AND linked to requester |
| `place_match` | 85% | Cat has appointment history at request's place |
| `requester_match` | 80% | Cat linked to requester via `sot.person_cat` |
| `booking_person_match` | 70% | Booking person's email/phone matches requester |

---

## Calculation Formulas

### Alteration Rate

```
eligible_for_alteration = cats_caught - already_altered_before
alteration_rate = (cats_altered / eligible_for_alteration) * 100
```

Where:
- **cats_caught**: Distinct cats with spay/neuter procedures in the time window
- **cats_altered**: Cats where `procedure_date > request_date` (work we did)
- **already_altered_before**: Cats where `procedure_date < request_date` (already fixed)

### Example Calculation

```
Request Date: 2023-06-15
Window: 2022-12-15 to 2023-12-15

Cat        | Procedure Date | Category
-----------|----------------|------------------
Whiskers   | 2023-01-10     | already_altered_before
Mittens    | 2023-08-20     | cats_altered
Shadow     | 2023-09-15     | cats_altered
Tiger      | NULL           | caught but intact

cats_caught = 4
cats_altered = 2
already_altered_before = 1
eligible = 4 - 1 = 3
alteration_rate = (2 / 3) * 100 = 66.7%
```

---

## Database Objects

### View: `v_request_alteration_stats`

Per-request clinic-derived statistics.

**Key Columns:**
- `request_id` - Request identifier
- `effective_request_date` - Actual date used (source_created_at for legacy)
- `window_start`, `window_end` - 12-month window boundaries
- `cats_caught` - Total cats with procedures in window
- `cats_altered` - Cats altered after request date
- `already_altered_before` - Cats altered before request date
- `males`, `females` - Sex breakdown
- `alteration_rate_pct` - Calculated rate (NULL if no eligible cats)
- `linked_cats` - JSONB array with cat details and match reasons
- `is_legacy_request` - TRUE if source_system = 'airtable'
- `can_upgrade` - TRUE if eligible for upgrade

### View: `v_place_alteration_history`

Per-place colony management statistics aggregated across all requests.

**Key Columns:**
- `place_id`, `place_name`, `formatted_address`
- `total_requests`, `total_cats_caught`, `total_cats_altered`
- `place_alteration_rate_pct` - Overall place rate
- `first_request_date`, `latest_request_date` - Activity timeline
- `yearly_breakdown` - JSONB with per-year stats

### Function: `upgrade_legacy_request()`

Upgrades a legacy Airtable request to modern Atlas format.

**Parameters:**
```sql
upgrade_legacy_request(
  p_request_id UUID,
  p_upgraded_by TEXT,
  p_permission_status TEXT,
  p_access_notes TEXT,
  p_traps_overnight_safe BOOLEAN,
  p_access_without_contact BOOLEAN,
  p_colony_duration TEXT,
  p_count_confidence TEXT,
  p_is_being_fed BOOLEAN,
  p_feeding_schedule TEXT,
  p_best_times_seen TEXT,
  p_urgency_reasons TEXT[],
  p_urgency_notes TEXT,
  p_kittens_already_taken BOOLEAN,
  p_already_assessed BOOLEAN
) RETURNS UUID
```

**What it does:**
1. Creates new request with `source_system = 'airtable_upgraded'`
2. Uses original Airtable date as `source_created_at`
3. Copies `request_cat_links` to new request
4. Archives original (status = 'cancelled', links to new request)
5. Logs both operations to `entity_edits`

---

## API Endpoints

### GET `/api/requests/{id}/alteration-stats`

Returns clinic-derived statistics for a request.

**Response:**
```json
{
  "request_id": "uuid",
  "effective_request_date": "2023-06-15T00:00:00Z",
  "window_start": "2022-12-15T00:00:00Z",
  "window_end": "2023-12-15T00:00:00Z",
  "cats_caught": 4,
  "cats_altered": 2,
  "already_altered_before": 1,
  "males": 2,
  "females": 2,
  "alteration_rate_pct": 66.7,
  "avg_match_confidence": 0.85,
  "linked_cats": [
    {
      "cat_id": "uuid",
      "cat_name": "Whiskers",
      "microchip": "900000001234567",
      "sex": "female",
      "match_reason": "place_match",
      "confidence": 0.85,
      "procedure_date": "2023-01-10",
      "is_spay": true,
      "altered_after_request": false
    }
  ],
  "is_legacy_request": true,
  "can_upgrade": true
}
```

### POST `/api/requests/{id}/upgrade`

Upgrades a legacy request to Atlas format.

**Request Body:**
```json
{
  "permission_status": "yes",
  "traps_overnight_safe": true,
  "colony_duration": "6_to_24_months",
  "count_confidence": "good_estimate",
  "is_being_fed": true,
  "feeding_schedule": "6am and 6pm",
  "urgency_reasons": ["kittens"],
  "kittens_already_taken": false,
  "already_assessed": true
}
```

**Response:**
```json
{
  "success": true,
  "new_request_id": "uuid",
  "archived_request_id": "uuid",
  "message": "Legacy request successfully upgraded to Atlas format"
}
```

### GET `/api/requests/legacy`

Lists all legacy Airtable requests with stats.

**Query Parameters:**
- `status` - Filter by status
- `limit` - Max results (default 50)
- `offset` - Pagination offset

### GET `/api/places/{id}/alteration-history`

Returns colony management statistics for a place.

---

## UI Components

### AlterationStatsCard

Displays clinic statistics on the request detail page.

**Features:**
- Alteration rate with color coding (green ≥80%, orange 50-80%, red <50%)
- Cats caught, altered, and pre-altered counts
- Male/female breakdown
- Match confidence indicator
- Expandable linked cats table with match reasons
- "Upgrade to Atlas" button for legacy requests

### LegacyUpgradeWizard

5-step modal wizard for upgrading legacy requests.

**Steps:**
1. Kitten status check
2. Access & permission questions
3. Colony information
4. Urgency factors
5. Confirmation & submit

### PlaceAlterationHistory

Colony statistics section on place detail page.

**Features:**
- Overall place alteration rate
- Total requests, cats caught, cats altered
- Year-by-year breakdown table

---

## Data Flow

```
Legacy Airtable Request
         │
         ▼
┌─────────────────────────┐
│  source_system='airtable'│
│  source_created_at      │
│  source_record_id       │
└─────────────────────────┘
         │
         ▼ (User clicks "Upgrade to Atlas")
         │
┌─────────────────────────┐
│  LegacyUpgradeWizard    │
│  (5-step questionnaire) │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│  POST /upgrade          │
│  → upgrade_legacy_request()
└─────────────────────────┘
         │
         ├─────────────────────────────┐
         ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  NEW Request            │   │  ARCHIVED Request       │
│  source_system=         │   │  status='cancelled'     │
│    'airtable_upgraded'  │   │  resolution_notes=      │
│  (has questionnaire data)│   │    'Upgraded to...'    │
└─────────────────────────┘   └─────────────────────────┘
```

---

## Audit Trail

All upgrade operations are logged to `entity_edits`:

1. **New request creation:**
   ```sql
   INSERT INTO entity_edits (entity_type, entity_id, edit_type, reason)
   VALUES ('request', new_id, 'create', 'Upgraded from legacy: old_id')
   ```

2. **Original request archival:**
   ```sql
   INSERT INTO entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value)
   VALUES ('request', old_id, 'update', 'status', 'new', 'cancelled')
   ```

---

## Testing

### Manual Testing

1. Find a legacy request: `SELECT * FROM ops.requests WHERE source_system = 'airtable' LIMIT 5`
2. Check alteration stats: `GET /api/requests/{id}/alteration-stats`
3. Test upgrade flow via UI or: `POST /api/requests/{id}/upgrade`
4. Verify new request created and old archived

### Edge Cases

- Request with no cats in window → alteration_rate_pct = NULL
- All cats already altered → eligible = 0, rate = NULL
- Request has no place_id → only requester matching available
- Upgrade already-upgraded request → Error: "already been upgraded"

---

## Files Reference

| File | Purpose |
|------|---------|
| `sql/schema/sot/MIG_200__legacy_clinic_stats.sql` | SQL views and upgrade function |
| `apps/web/src/app/api/requests/[id]/alteration-stats/route.ts` | Stats API |
| `apps/web/src/app/api/requests/[id]/upgrade/route.ts` | Upgrade API |
| `apps/web/src/app/api/requests/legacy/route.ts` | Legacy list API |
| `apps/web/src/app/api/places/[id]/alteration-history/route.ts` | Place stats API |
| `apps/web/src/components/AlterationStatsCard.tsx` | Stats UI component |
| `apps/web/src/components/LegacyUpgradeWizard.tsx` | Upgrade wizard |
| `apps/web/src/components/PlaceAlterationHistory.tsx` | Place stats component |
| `apps/web/src/components/SafeLinkingIndicators.tsx` | Match confidence badges |

---

## Questions?

Contact Ben Mis (ben@ffsc.org) for questions about data lineage or business rules.
