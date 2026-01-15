# Atlas Project - Claude Development Rules

This file contains rules and context for AI-assisted development on the Atlas project.

## Project Overview

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County (FFSC). It tracks:
- **People** (requesters, trappers, volunteers)
- **Cats** (with microchips, clinic visits)
- **Requests** (trapping requests, TNR operations)
- **Places** (addresses where cats are)

## Architecture

### Three-Layer Data Model
1. **Raw** (`staged_records`) - Immutable audit trail
2. **Identity Resolution** - Matching via email/phone
3. **Source of Truth** (`sot_*` tables) - Canonical records

### Key Tables (in `trapper` schema)
- `sot_people` - All people
- `sot_cats` - All cats with microchips
- `sot_requests` - All service requests
- `places` - All addresses
- `person_identifiers` - Email/phone for identity matching
- `person_roles` - Role assignments (trapper, volunteer, etc.)
- `request_trapper_assignments` - Many-to-many request-trapper links

## Critical Rules

### Attribution Windows (MIG_208)

When linking cats to requests, use the **rolling window system**:

```sql
-- Legacy requests (before May 2025): Fixed window
WHEN source_created_at < '2025-05-01' THEN source_created_at + '6 months'

-- Resolved requests: Buffer after completion
WHEN resolved_at IS NOT NULL THEN resolved_at + '3 months'

-- Active requests: Rolling to future
ELSE NOW() + '6 months'
```

**DO NOT** create custom time window logic. Always use `v_request_alteration_stats` view.

### Identity Matching

- **Email**: Exact match via `person_identifiers.id_value_norm`
- **Phone**: Use `trapper.norm_phone_us()` for normalization
- **Never match by name alone** - Too many false positives

### Trapper Types

| Type | Is FFSC? | Description |
|------|----------|-------------|
| `coordinator` | Yes | FFSC staff coordinator |
| `head_trapper` | Yes | FFSC head trapper |
| `ffsc_trapper` | Yes | FFSC trained volunteer (completed orientation) |
| `community_trapper` | No | Signed contract only, limited, does NOT represent FFSC |

**"Legacy Trapper"** in Airtable = `ffsc_trapper` (grandfathered FFSC volunteer)

### Data Provenance

Always track:
- `source_system` - Where data came from ('airtable', 'clinichq', 'web_app')
- `source_record_id` - Original ID in source system
- `source_created_at` - Original creation timestamp (important for windows!)
- Log changes to `entity_edits` table

### Request Lifecycle

```
new → triaged → scheduled → in_progress → completed
                    ↓
                on_hold (with hold_reason)
                    ↓
                cancelled
```

When setting `status = 'completed'` or `'cancelled'`, also set `resolved_at = NOW()`.

## Common Tasks

### Adding a New Ingest Script

1. Create `scripts/ingest/{source}_{table}_sync.mjs`
2. Stage raw records in `staged_records`
3. Use `find_or_create_*` functions
4. Log changes to `data_changes` or `entity_edits`
5. Update `docs/DATA_INGESTION_RULES.md`

### Creating a New Migration

1. Name: `sql/schema/sot/MIG_{NNN}__{description}.sql`
2. Start with `\echo` banner
3. Use `IF NOT EXISTS` for creates
4. Add `COMMENT ON` for documentation
5. End with summary `\echo`

### Adding API Endpoints

1. Location: `apps/web/src/app/api/{resource}/route.ts`
2. Use `queryOne` / `queryRows` from `@/lib/db`
3. Return JSON with proper error handling
4. Validate inputs before database calls

## File Locations

```
/apps/web/          - Next.js web application
/scripts/ingest/    - Data sync scripts
/sql/schema/sot/    - Database migrations
/docs/              - Documentation
```

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - Postgres connection string
- `AIRTABLE_PAT` - Airtable Personal Access Token
- `GOOGLE_PLACES_API_KEY` - For geocoding

## Views to Know

| View | Purpose |
|------|---------|
| `v_request_alteration_stats` | Per-request cat attribution with windows |
| `v_trapper_full_stats` | Comprehensive trapper statistics |
| `v_trapper_appointment_stats` | Trapper stats from direct appointment links |
| `v_place_alteration_history` | Per-place TNR progress over time |
| `v_request_current_trappers` | Current trapper assignments |

## Key Tables

| Table | Purpose |
|-------|---------|
| `intake_custom_fields` | Admin-configured custom intake questions |
| `web_intake_submissions` | All intake form submissions (has `custom_fields` JSONB) |

## Custom Intake Fields (MIG_238)

Custom intake questions can be added via admin UI without code changes.

### Admin UI
- Path: `/admin/intake-fields`
- Features: Add/edit/delete custom questions, sync to Airtable

### Database Table: `trapper.intake_custom_fields`
| Column | Purpose |
|--------|---------|
| `field_key` | Snake_case identifier (e.g., `how_heard_about_us`) |
| `field_label` | Human-readable label |
| `field_type` | text, textarea, number, select, checkbox, date, phone, email |
| `options` | JSONB array of `{value, label}` for select fields |
| `show_for_call_types` | Array of call types to show for (null = all) |
| `is_beacon_critical` | Important for Beacon analytics |
| `airtable_synced_at` | When last synced to Airtable |

### Airtable Sync
Click "Sync to Airtable" in admin UI to push new fields to Airtable table.
After sync: add same question to Jotform and map to new Airtable column.

### Custom Field Values
Stored in `web_intake_submissions.custom_fields` as JSONB.

### Cat Ownership Types
Standard options for `ownership_status`:
- `unknown_stray` - Stray cat (no apparent owner)
- `community_colony` - Outdoor cat I/someone feeds
- `newcomer` - Newcomer (just showed up recently)
- `neighbors_cat` - Neighbor's cat
- `my_cat` - My own pet

### Feeding Behavior Fields (MIG_236)
- `feeds_cat` - Does requester feed the cat?
- `feeding_frequency` - Daily, few times/week, occasionally, rarely
- `feeding_duration` - How long feeding/aware
- `cat_comes_inside` - Yes regularly, sometimes, never

### Emergency Handling
- `is_emergency` - Flagged as urgent
- `emergency_acknowledged` - User acknowledged FFSC is not a 24hr hospital

## Colony Size Tracking (MIG_209)

Colony size != cats caught. Colony size is an estimate of total cats at a location.

### Adding Colony Data

```sql
-- 1. Add source confidence (if new source type)
INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
VALUES ('new_source', 0.65, 'Description');

-- 2. Insert estimate
INSERT INTO trapper.place_colony_estimates (
  place_id, total_cats, source_type, observation_date, source_system, source_record_id
) VALUES (...);
```

### Source Confidence Levels
- `verified_cats`: 100% (ground truth)
- `post_clinic_survey`: 85% (Project 75)
- `trapper_site_visit`: 80%
- `trapping_request`: 60%
- `intake_form`: 55%
- `appointment_request`: 50%

### Key View
`v_place_colony_status` - Aggregates all estimates with weighted confidence

## Cat-Place Linking (MIG_235)

Cats from clinic appointments are linked to places via owner contact info:
1. Find cat via microchip in `cat_identifiers`
2. Match owner email/phone from appointment to `person_identifiers`
3. Get place from `person_place_relationships`
4. Create `cat_place_relationships` with type `'appointment_site'`

Run to re-link: `SELECT * FROM trapper.link_appointment_cats_to_places();`

## Trapper-Appointment Linking (MIG_238)

Trappers are linked to appointments directly for accurate stats:
- `sot_appointments.trapper_person_id` - Direct link to trapper
- Use `v_trapper_appointment_stats` for clinic stats
- Run to re-link: `SELECT * FROM trapper.link_appointments_to_trappers();`

## Don't Do

- Don't match people by name only
- Don't create fixed time windows for new features
- Don't skip `entity_edits` logging for important changes
- Don't hardcode phone/email patterns (use normalization functions)
- Don't assume single trapper per request (use `request_trapper_assignments`)
- Don't confuse colony size (estimate) with cats caught (verified clinic data)
