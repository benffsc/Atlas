# Atlas Data Flow Rules

## Source of Truth (SoT) Architecture

Atlas serves as the **Source of Truth** for Beacon and all downstream systems. This document defines the rules for how data flows into and through Atlas.

## Sacred Tables (Protected SoT)

These tables are protected and require validated data:

1. **Intake Queue** (`web_intake_submissions`)
   - Receives external data from web forms, phone calls, etc.
   - First line of defense against bad data
   - Auto-triage scores new submissions
   - Geocoding normalizes addresses

2. **Trapping Requests** (`sot_requests`)
   - Created only from validated intake submissions
   - Links to validated People and Places
   - Tracks full lifecycle of TNR work

3. **Places** (`places`)
   - Canonical address registry
   - Geocoded and validated addresses
   - Linked to requests and people

4. **People** (`sot_people`)
   - Canonical person registry
   - Identified by email, phone, name
   - Linked via `person_identifiers`

## Data Validation Rules

### Rule 1: All External Data Goes Through Intake

Any data from external sources must enter through the intake pipeline:
- Web forms
- Phone calls
- Paper forms
- Legacy imports

**Never** directly insert into sot_requests, sot_people, or places without validation.

### Rule 2: Bad Data Must Not Be Lost

Data that fails validation should be:
- Flagged with confidence levels (exact, approximate, city, failed)
- Preserved in original form
- Reviewed by staff

**Never** discard data - flag it for review instead.

### Rule 3: Link Through Validation, Not Direct Insert

When linking intake to People or Places:
- Use matching scripts to suggest links
- Auto-link only high-confidence matches (email exact match)
- Staff review for ambiguous matches

### Rule 3.5: Third-Party Reports Require Permission

When intake is submitted by someone other than the property owner (volunteers, neighbors, etc.):
- Submission is automatically flagged as "needs_review"
- Staff must contact property owner to get permission before scheduling
- Property owner contact info is captured if known (name, phone, email)
- Third-party relationship is tracked (volunteer, neighbor, concerned_citizen, etc.)
- These submissions cannot be converted to requests until owner permission is obtained

### Rule 4: Source Tracking Required

All intake submissions must be tagged with source:
- `web` - Atlas web form (auto-set for online submissions)
- `phone` - Phone call intake (staff enters via intake form)
- `in_person` - Walk-in (staff enters via intake form)
- `paper` - Paper form digitized (staff enters via intake form)
- `legacy_airtable` - Old Airtable imports
- `legacy_website` - Old website form

**Paper Form Workflow:**
1. Print form from `/intake/print` or `/admin` → Print Intake Form
2. Give paper form to community member to fill out
3. Staff enters completed form data via `/intake` web form
4. Set source to "paper" when entering (or add via staff intake entry page)

### Rule 5: Geocoding for Address Normalization

All addresses should be geocoded to:
- Normalize formatting
- Get lat/long coordinates
- Enable deduplication
- Flag addresses outside service area

Confidence levels:
- `exact` - Rooftop precision
- `approximate` - Street level
- `city` - City only match
- `failed` - Could not geocode
- `skip` - Invalid address pattern

## Data Flow Diagram

```
External Sources (web form, phone, paper, legacy)
      |
      v
+------------------+
| Intake Queue     |  <- First filter, auto-triage, geocode
| (web_intake)     |     Third-party reports flagged here
+------------------+
      |
      | Staff review & validate
      | (contact property owner for third-party reports)
      v
+------------------+     +------------------+
| sot_requests     | <-> | places           |
| (trapping work)  |     | (addresses)      |
+------------------+     +------------------+
      |                         |
      v                         v
+------------------+     +------------------+
| sot_cats         |     | sot_people       |
| (cat registry)   |     | (person registry)|
+------------------+     +------------------+
      |
      v
    Beacon (downstream consumer)
```

## Triage Categories

Intake submissions are automatically triaged into these categories:

| Category | Score Range | Description |
|----------|-------------|-------------|
| `high_priority_tnr` | 60+ | Large colonies (10+), kittens, emergencies |
| `standard_tnr` | 25-59 | Typical TNR requests (2-9 cats, unfixed) |
| `wellness_only` | - | All cats already fixed, need wellness care |
| `owned_cat_low` | - | Owned cats (redirect to low-cost clinics) |
| `out_of_county` | - | Outside Sonoma County service area |
| `needs_review` | - | Ambiguous, third-party reports, manual review needed |

### Scoring Factors

- **Cat count**: 1 cat (5pts) → 10+ cats (40pts)
- **Fixed status**: None fixed (30pts) → All fixed (0pts)
- **Kittens**: +35pts (newborn +15 extra)
- **Emergency**: +50pts
- **Medical concerns**: +20pts
- **New situation (<1 week)**: +15pts
- **Third-party report**: Auto-assigned to `needs_review`

## Intake to Request Conversion

When an intake submission is converted to a trapping request:

### Standard Flow
```
web_intake_submissions → sot_requests
                      → places (linked or created)
                      → sot_people (reporter contact)
```

### Third-Party Report Flow
```
web_intake_submissions
  ├── Reporter contact → person_identifiers (as "reporter")
  ├── Property owner contact → sot_people (as "property_owner") [if provided]
  ├── Location → places
  └── → sot_requests (with notes about permission needed)
```

### Data Mapping

| Intake Field | Request Field | Notes |
|--------------|---------------|-------|
| `first_name + last_name` | `requester_person_id` → display_name | Linked via person matching |
| `email` | `person_identifiers.id_value` | Email identifier |
| `phone` | `person_identifiers.id_value` | Phone identifier |
| `cats_address` | `place_id` → raw_address | Geocoded to place |
| `cat_count_estimate` | `raw_estimated_cat_count` | |
| `fixed_status` | `raw_eartip_estimate` | Mapped to eartip values |
| `is_emergency` | `raw_priority` = 'urgent' | |
| `is_third_party_report` | `raw_notes` | Added to request notes |
| `property_owner_*` | Separate person record | Created as property owner contact |

### Permission Tracking for Third-Party Reports

When converting a third-party report to a request:
1. Request is created with `permission_status = 'pending_owner_contact'`
2. Property owner contact (if provided) is stored as a separate person
3. Notes are added explaining the third-party nature
4. Staff must update permission status before scheduling

## Legacy Data Compatibility

Legacy data from Airtable maintains compatibility through:

### Legacy Fields (web_intake_submissions)
- `is_legacy`: Boolean flag for pre-Atlas data
- `legacy_status`: Original Airtable "Status" field
- `legacy_submission_status`: Original "Submission Status" field
- `legacy_appointment_date`: Original appointment date
- `legacy_notes`: Original notes/comments
- `legacy_source_id`: Airtable record ID

### Workflow States (Jami's Current Workflow)
| Legacy Status | Atlas Equivalent |
|---------------|------------------|
| "Pending Review" | status = 'triaged' |
| "Booked" | status = 'reviewed', has appointment |
| "Declined" | status = 'archived' |
| "Complete" | status = 'request_created' |

### Export Compatibility
When re-exporting from Airtable, use `legacy_source_id` to match and update:
```bash
node scripts/ingest/legacy_intake_submissions.mjs --update-existing
```

## Legacy Data Handling

Legacy data (before October 2025) is:
- Tagged as `is_legacy = true`
- Has `legacy_status`, `legacy_submission_status` fields
- Filtered from active queue by default
- Still searchable with `include_old=true` parameter

Legacy submissions with status "Complete" or "Declined" are considered done.

## Scripts

### Geocoding
```bash
node scripts/ingest/geocode_intake_addresses.mjs
node scripts/ingest/geocode_intake_addresses.mjs --dry-run --verbose
node scripts/ingest/geocode_intake_addresses.mjs --reprocess-failed
```

### Smart Matching
```bash
node scripts/ingest/smart_match_intake.mjs           # Preview matches
node scripts/ingest/smart_match_intake.mjs --apply   # Apply high-confidence matches
node scripts/ingest/smart_match_intake.mjs --verbose # Show all matches
```

### Name Normalization
```bash
node scripts/ingest/normalize_intake_names.mjs       # Normalize ALL CAPS names
node scripts/ingest/normalize_intake_names.mjs --dry-run
```

### Categorize Pending Reviews
```bash
node scripts/ingest/categorize_pending_reviews.mjs   # Auto-categorize stale reviews
node scripts/ingest/categorize_pending_reviews.mjs --dry-run
```

### Legacy Import
```bash
node scripts/ingest/legacy_intake_submissions.mjs    # Import from Airtable CSV
```

## API Filters

The intake queue API supports filtering:

- `status_filter=active` - Only unprocessed submissions
- `source=legacy` - Only legacy imports
- `source=new` - Only new Atlas submissions
- `include_old=true` - Include pre-October 2025 legacy data

Example:
```
GET /api/intake/queue?status_filter=active
GET /api/intake/queue?source=legacy&include_old=true
```
