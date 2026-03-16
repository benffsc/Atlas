# Trapper Statistics System

## Overview

Atlas calculates trapper performance metrics by correlating request assignments and site visits with clinic procedure records from ClinicHQ. This feature helps measure trapper effectiveness, track FeLV encounter rates, and manage manual catch credits.

---

## Trapper Types

| Type | Description | Represents FFSC? |
|------|-------------|------------------|
| `coordinator` | FFSC trapping coordinator (staff) | Yes |
| `head_trapper` | FFSC head trapper | Yes |
| `ffsc_trapper` | FFSC trained volunteer (completed orientation) | Yes |
| `community_trapper` | Community trapper (signed contract, limited, NOT FFSC representative) | No |

**Key Distinction:**
- **FFSC Trappers** go through volunteer orientation and represent FFSC
- **Community Trappers** sign a contract but are limited in scope and don't represent FFSC

---

## Data Model

### Clinic Matching

Trappers are matched to clinic visits by comparing their email/phone identifiers with the booking person on clinic visits:

```sql
-- Match via email
clinichq_visits.client_email = person_identifiers.id_value_norm (email)

-- Match via phone
clinichq_visits.client_cell_phone matches person_identifiers.id_value_norm (phone)
clinichq_visits.client_phone matches person_identifiers.id_value_norm (phone)
```

### Statistics Sources

| Metric | Source |
|--------|--------|
| Cats brought to clinic | `clinichq_visits` matched by email/phone |
| FeLV encounter rate | `clinichq_visits.felv_fiv_result` |
| Site visits | `trapper_site_visits` table |
| First visit success rate | `trapper_site_visits` where `visit_type='assessment'` |
| Assignments | `ops.requests.assigned_trapper_id` |
| Manual catches | `trapper_manual_catches` table |

---

## Key Calculations

### Average Cats Per Clinic Day
```
avg_cats_per_day = total_clinic_cats / unique_clinic_days
```

### FeLV Encounter Rate
```
felv_positive_rate_pct = (felv_positive_count / felv_tested_count) * 100
```

### First Visit Success Rate
```
first_visit_success_rate_pct = (assessments_with_catches / assessment_visits) * 100
```

### Total Cats Caught
```
total_cats_caught = cats_from_visits + manual_catches
```

---

## Database Objects

### Table: `trapper_manual_catches`

Tracks cats caught by trappers outside of formal requests.

| Column | Type | Description |
|--------|------|-------------|
| `catch_id` | UUID | Primary key |
| `trapper_person_id` | UUID | FK to sot.people |
| `cat_id` | UUID | FK to sot.cats (optional) |
| `microchip` | TEXT | Microchip if cat not yet in system |
| `catch_date` | DATE | When caught |
| `catch_location` | TEXT | Where caught (optional) |
| `notes` | TEXT | Additional notes |
| `linked_at` | TIMESTAMPTZ | When cat was linked (if applicable) |

### View: `v_trapper_clinic_stats`

Per-trapper clinic-derived statistics.

**Key Columns:**
- `person_id`, `display_name`, `trapper_type`
- `total_clinic_cats` - Cats brought to clinic
- `unique_clinic_days` - Distinct days with appointments
- `avg_cats_per_day` - Cats per clinic day
- `felv_tested_count`, `felv_positive_count`, `felv_positive_rate_pct`
- `first_clinic_date`, `last_clinic_date`

### View: `v_trapper_full_stats`

Comprehensive trapper statistics combining all sources.

**Key Columns:**
- All from `v_trapper_clinic_stats`
- `active_assignments`, `completed_assignments`
- `total_site_visits`, `assessment_visits`
- `first_visit_success_rate_pct`
- `cats_from_visits`, `manual_catches`, `total_cats_caught`
- `first_activity_date`, `last_activity_date`

### View: `v_trapper_aggregate_stats`

Organization-wide trapper statistics.

**Key Columns:**
- `total_active_trappers`, `ffsc_trappers`, `community_trappers`
- `all_clinic_cats`, `all_clinic_days`, `avg_cats_per_day_all`
- `felv_positive_rate_pct_all`
- `all_site_visits`, `first_visit_success_rate_pct_all`
- `all_cats_caught`

### Function: `add_trapper_catch()`

Adds a cat to a trapper's manual catch counter.

```sql
sot.add_trapper_catch(
  p_trapper_person_id UUID,
  p_microchip TEXT DEFAULT NULL,
  p_cat_id UUID DEFAULT NULL,
  p_catch_date DATE DEFAULT CURRENT_DATE,
  p_catch_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'web_user'
) RETURNS UUID
```

**Behavior:**
- Validates person is an active trapper
- Requires either microchip or cat_id
- Auto-links to sot.cats if microchip found
- Returns the new catch_id

### Function: `get_trapper_info()`

Checks if a person is a trapper and returns their type.

```sql
sot.get_trapper_info(p_person_id UUID)
RETURNS TABLE (
  is_trapper BOOLEAN,
  trapper_type TEXT,
  is_ffsc_trapper BOOLEAN,
  role_status TEXT,
  started_at DATE
)
```

---

## API Endpoints

### GET `/api/people/{id}/trapper-stats`

Returns clinic-derived statistics for a trapper.

**Response (200):**
```json
{
  "person_id": "uuid",
  "display_name": "Jean Worthey",
  "trapper_type": "head_trapper",
  "is_ffsc_trapper": true,
  "active_assignments": 2,
  "completed_assignments": 18,
  "total_site_visits": 45,
  "assessment_visits": 20,
  "first_visit_success_rate_pct": 65.0,
  "cats_from_visits": 47,
  "manual_catches": 5,
  "total_cats_caught": 52,
  "total_clinic_cats": 47,
  "unique_clinic_days": 23,
  "avg_cats_per_day": 2.0,
  "spayed_count": 25,
  "neutered_count": 22,
  "total_altered": 47,
  "felv_tested_count": 45,
  "felv_positive_count": 3,
  "felv_positive_rate_pct": 6.7,
  "first_clinic_date": "2022-03-15",
  "last_clinic_date": "2024-01-10"
}
```

**Response (404):** Person is not a trapper

### GET `/api/people/{id}/trapper-cats`

Lists manual catches for a trapper.

**Response:**
```json
{
  "catches": [
    {
      "catch_id": "uuid",
      "cat_id": "uuid",
      "microchip": "900000001234567",
      "catch_date": "2024-01-05",
      "catch_location": "Oak Street Colony",
      "notes": "Caught outside formal request",
      "cat_name": "Whiskers",
      "created_at": "2024-01-05T14:30:00Z"
    }
  ]
}
```

### POST `/api/people/{id}/trapper-cats`

Adds a new manual catch.

**Request Body:**
```json
{
  "microchip": "900000001234567",
  "catch_date": "2024-01-05",
  "catch_location": "Oak Street Colony",
  "notes": "Caught outside formal request"
}
```

**Response:**
```json
{
  "success": true,
  "catch_id": "uuid"
}
```

### GET `/api/trappers`

Lists all active trappers with stats.

**Query Parameters:**
- `type` - Filter: `ffsc`, `community`, or `all`
- `sort` - Sort by: `total_clinic_cats`, `total_cats_caught`, `active_assignments`, `display_name`, etc.
- `limit` - Max results (default 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "trappers": [...],
  "aggregates": {
    "total_active_trappers": 15,
    "ffsc_trappers": 10,
    "community_trappers": 5,
    "all_clinic_cats": 450,
    "avg_cats_per_day_all": 2.1,
    "felv_positive_rate_pct_all": 4.5
  },
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

## UI Components

### TrapperBadge

Displays trapper type with color-coded badge.

| Type | Color | Label |
|------|-------|-------|
| `coordinator` | Purple | Trapping Coordinator |
| `head_trapper` | Blue | Head Trapper |
| `ffsc_trapper` | Green | FFSC Trapper |
| `community_trapper` | Orange | Community Trapper |

### TrapperStatsCard

Displays clinic-derived statistics. Has two modes:
- **Compact** - Summary stats for person detail page
- **Full** - Detailed stats for trapper detail page

### Pages

| URL | Purpose |
|-----|---------|
| `/trappers` | List all active trappers with stats |
| `/trappers/{id}` | Detailed trapper profile with stats and manual catch management |

---

## Integration Points

### Person Detail Page

When viewing a person who is a trapper:
1. TrapperBadge displays in header next to name
2. "Trapper Statistics" section shows compact stats card
3. Link to `/trappers/{id}` for full profile

### Trapper Detail Page

Full trapper profile with:
1. Comprehensive statistics
2. FeLV encounter rate visualization
3. First visit success rate
4. Manual catch management (add/view catches)

---

## Files Reference

| File | Purpose |
|------|---------|
| `sql/schema/sot/MIG_206__trapper_statistics.sql` | SQL views, tables, and functions |
| `apps/web/src/app/api/people/[id]/trapper-stats/route.ts` | Trapper stats API |
| `apps/web/src/app/api/people/[id]/trapper-cats/route.ts` | Manual catches API |
| `apps/web/src/app/api/trappers/route.ts` | Trappers list API |
| `apps/web/src/app/trappers/page.tsx` | Trappers list page |
| `apps/web/src/app/trappers/[id]/page.tsx` | Trapper detail page |
| `apps/web/src/components/TrapperBadge.tsx` | Trapper type badge |
| `apps/web/src/components/TrapperStatsCard.tsx` | Stats display component |

---

## Example: Trapper Statistics

For a head trapper with 23 clinic days:

```
+-----------------------------------------------+
| Jean Worthey              [Head Trapper]      |
|                                               |
| Cats to Clinic: 47    Clinic Days: 23         |
| Avg Cats/Day: 2.0     Total Caught: 52        |
|                                               |
| FeLV Tested: 45       FeLV Positive: 3 (6.7%) |
|                                               |
| First Visit Success: 65% of assessments       |
| yielded catches (20 assessments)              |
|                                               |
| Alterations: 25 spayed, 22 neutered (47 total)|
+-----------------------------------------------+
```

---

## Questions?

Contact Ben Mis (ben@ffsc.org) for questions about trapper data or business rules.
