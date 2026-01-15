# Atlas Launch Runbook

**Launch Date: January 2025**

This document covers all systems, features, and data integrity for Atlas launch.

---

## System Status

### Data Quality ✅

| System | Status | Notes |
|--------|--------|-------|
| Place Deduplication | Working | 3-layer system: address normalization, coordinate matching, Google canonical |
| Cat Identity | Working | Microchip primary key, ClinicHQ animal ID fallback |
| Cat-Place Linking | Working | Via appointments and owner relationships |
| Geocoding | Working | Queue-based with retry logic, ~8k places geocoded |
| Colony Estimation | Working | Ecology-based with manual override support |

### Integrations ✅

| Integration | Status | Frequency |
|-------------|--------|-----------|
| Airtable Sync | Active | Every 30 min via Vercel cron |
| Google Geocoding | Active | Queue-based, processes pending places |
| ClinicHQ Import | Manual | Scripts in `/scripts/ingest/` |

---

## New Features (January 2025)

### 1. Intake Queue Improvements

- **Search Bar**: Search by name, email, phone, or address
- **Legacy Mode**: Shows all historical submissions (limit increased to 2000)
- **Consistent UI**: Dashboard and queue now use same modal view

### 2. Create Request Wizard

When converting an intake submission to a trapping request, staff now complete a 3-step wizard:

1. **Priority & Permission**: Set priority level, permission status, property owner info
2. **Access & Urgency**: Access notes, best contact times, urgency reasons
3. **Review & Create**: Summary and final notes before creation

### 3. Journal System

Full note-taking system linked to entities:
- Available on: Cats, People, Places, Requests
- Staff-linked entries with audit trail
- Supports: notes, status updates, follow-ups
- Tags and pinning for organization

### 4. Colony Size Estimation

Ecology-based population estimation with:
- **Never shows less than verified count**: Uses `GREATEST(a_known, n_recent_max)`
- **Manual Overrides**: Staff can set confirmed counts that override calculations
- **Configurable Parameters**: Admin page at `/admin/ecology`
- **Multiple Methods**: Lower-bound, mark-resight (Chapman estimator)

### 5. Cat Movement Tracking

Tracks when cats (by microchip) appear at different addresses:
- **Movement Timeline**: Visual history of location changes
- **Pattern Classification**: Stationary, two-homes, local mover, mobile, wide roamer
- **Distance Tracking**: Calculates travel between locations

### 6. Reunification Tracking

Record when cats are reunited with previous owners:
- **Quick Action Button**: On cat profile page
- **Status Tracking**: Pending, confirmed, declined
- **History Log**: All reunification attempts recorded

### 7. Airtable → Atlas Sync Pipeline

Automated sync from Jotform → Airtable → Atlas:
- Vercel cron runs every 30 minutes
- Processes up to 50 records per run
- Deduplicates by `source_record_id`
- Updates sync status back to Airtable

---

## Key Migrations to Apply

Before launch, ensure these migrations are applied:

```bash
export $(cat .env | grep -v '^#' | xargs)

# Movement tracking and reunification
psql "$DATABASE_URL" -f sql/schema/sot/MIG_236__cat_movement_tracking.sql
```

---

## API Endpoints Added

### Colony Management
- `GET /api/places/[id]/colony-estimates` - Get colony data and ecology stats
- `POST /api/places/[id]/colony-override` - Set manual override
- `DELETE /api/places/[id]/colony-override` - Clear override
- `GET /api/places/[id]/colony-override` - Get override history

### Cat Movement
- `GET /api/cats/[id]/movements` - Get movement timeline and pattern
- `POST /api/cats/[id]/movements` - Record manual movement

### Cat Reunification
- `GET /api/cats/[id]/reunification` - Get reunification history
- `POST /api/cats/[id]/reunification` - Record reunification
- `PATCH /api/cats/[id]/reunification` - Update status

### Journal
- `GET /api/journal` - Fetch entries (filter by entity)
- `POST /api/journal` - Create entry
- `PATCH /api/journal` - Update entry

### Airtable Sync
- `GET /api/cron/airtable-sync` - Triggered by Vercel cron
- `POST /api/cron/airtable-sync` - Manual trigger

---

## Configuration

### Ecology Parameters

Configured via `/admin/ecology` page or directly in database:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cat_lifespan_years` | 15 | Expected cat lifespan |
| `recent_report_window_days` | 180 | Window for recent reports |
| `eartip_observation_window_days` | 90 | Window for mark-resight |
| `high_alteration_threshold` | 80% | "High" status threshold |
| `complete_colony_threshold` | 95% | "Complete" status threshold |

### Vercel Cron

Configured in `apps/web/vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/airtable-sync", "schedule": "*/30 * * * *" }
  ]
}
```

---

## Staff Training Notes

### Intake Queue Workflow

1. Check "Needs Attention" tab for new submissions
2. Use search bar to find specific submitters
3. Click submission to view details in modal
4. Click "Create Request" to open wizard
5. Complete all three steps with TNR-specific info
6. Request is created and linked to submission

### Colony Management

1. Go to Place detail page → Colony Estimates section
2. View ecology-based estimates and stats
3. Click "Set Manual Override" to input confirmed counts
4. Override persists until cleared
5. All changes are audited

### Recording Reunifications

1. Go to Cat detail page → Movement & Reunification section
2. Click "Record Reunification" button
3. Select status: Confirmed, Pending, or Declined
4. Add notes about how the cat was identified
5. Submit to record

---

## Monitoring

### Cron Job Status

Check Vercel dashboard for cron execution logs.

Manual check:
```bash
curl -X GET https://atlas.ffsc.org/api/cron/airtable-sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Geocoding Queue

```bash
curl https://atlas.ffsc.org/api/places/geocode-queue
```

Returns stats on pending, completed, and failed geocoding.

---

## Troubleshooting

### Intake Submissions Not Syncing

1. Check Airtable `Sync Status` column - should be "pending"
2. Check `Sync Error` column for error messages
3. Verify required fields: Email/Phone, Cats Address
4. Check Vercel cron logs for execution status

### Colony Estimate Shows Wrong Number

1. Check if manual override is set (yellow badge)
2. Clear override if computed values are preferred
3. Review `v_place_ecology_stats` view for calculation details

### Cat Not Linked to Place

1. Check cat has microchip identifier
2. Verify appointment exists for the cat
3. Check owner has address in system
4. Run linking function if needed:
   ```sql
   SELECT * FROM trapper.link_clinic_cats_to_places();
   ```

---

## Emergency Contacts

- Database issues: Check Supabase dashboard
- Vercel issues: Check Vercel dashboard
- Application errors: Check browser console and server logs

---

## Post-Launch Tasks

1. Monitor cron job execution for first 24 hours
2. Verify geocoding queue is processing
3. Check intake submissions are syncing from Airtable
4. Train staff on new features
5. Collect feedback for iteration
