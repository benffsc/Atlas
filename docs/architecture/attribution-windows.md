# Cat-Request Attribution Windows

## Overview

When a cat is brought to the clinic, we need to attribute it to the correct trapping request. This document describes how the attribution window system works.

## Core Concept

The **attribution window** is the time period during which a clinic visit can be linked to a request. If a cat's clinic procedure falls within the window, it's attributed to that request.

## Window Types

### 1. Legacy Fixed Window
- **Applies to**: Requests with `source_created_at` before May 1, 2025
- **Window**: Fixed ±6 months from request creation date
- **Rationale**: Prevents old Airtable data from incorrectly linking to new clinic visits
- **Badge color**: Yellow (Legacy)

### 2. Active Rolling Window
- **Applies to**: Active requests (not completed/cancelled) from May 2025 onwards
- **Window**: Request date - 6 months → NOW + 6 months
- **Rationale**: Ongoing trapping efforts should capture cats as they're brought to clinic
- **Badge color**: Green (Rolling)

### 3. Resolved with Buffer
- **Applies to**: Completed or cancelled requests from May 2025 onwards
- **Window**: Request date - 6 months → resolved_at + 3 months
- **Rationale**: Grace period for late clinic visits after trapping is complete
- **Badge color**: Gray (Closed)

## Window Logic (SQL)

```sql
CASE
  -- Legacy: Fixed window
  WHEN source_created_at < '2025-05-01'
    THEN source_created_at + INTERVAL '6 months'

  -- Resolved: Buffer after completion
  WHEN resolved_at IS NOT NULL
    THEN resolved_at + INTERVAL '3 months'

  -- Active: Rolling to future
  ELSE NOW() + INTERVAL '6 months'
END AS window_end
```

## Matching Rules

Cats are matched to requests via three methods, with confidence scores:

| Match Type | Confidence | Description |
|------------|------------|-------------|
| `explicit_link` | 100% | Manual link via `request_cat_links` table |
| `place_and_requester` | 95% | Cat linked to both place AND requester |
| `place_match` | 85% | Cat has relationship to request's place |
| `requester_match` | 80% | Cat linked to requester via booking email/phone |

## Important Rules for Data Ingests

### When Importing ClinicHQ Data

1. **Always preserve clinic visit dates** - These are the truth for procedures
2. **Match by email/phone normalization** - Use `norm_phone_us()` for phones
3. **Don't backfill old data into new windows** - Respect the May 2025 cutoff

### When Creating Requests

1. **Set `source_created_at`** for imported data to preserve original timestamps
2. **Set `resolved_at`** when marking requests as completed/cancelled
3. **Update `last_activity_at`** when significant changes occur

### When Linking Cats Manually

1. Use `request_cat_links` table for explicit links (100% confidence)
2. Log the linking action to `entity_edits` for audit trail

## Data Chain

The full attribution chain:

```
Requester (person)
    ↓ person_identifiers (email/phone)
    ↓
Request ←→ Place ←→ Cats (via sot.cat_place)
    ↓
Clinic Visit (matched by booking person email/phone)
    ↓
Cat Procedure (spay/neuter with date)
```

## Views

- `v_request_alteration_stats` - Per-request cat attribution with window info
- `v_place_alteration_history` - Aggregated stats per place over time
- `v_trapper_full_stats` - Trapper statistics including attributed cats

## UI Indicators

The `AlterationStatsCard` component shows:
- Window type badge (Rolling/Closed/Legacy)
- Window date range
- Linked cats with match confidence
- Alteration rate calculation

## Troubleshooting

### Cats not linking to a request

1. Check `window_type` - if Legacy, window may have closed
2. Check `window_end` - is the clinic visit date within range?
3. Check matching - does requester have matching email/phone in `person_identifiers`?
4. Check place linking - is the cat linked to the request's place?

### Request showing wrong cat count

1. Verify `effective_request_date` is correct (uses `source_created_at` if available)
2. Check if cats were linked BEFORE the request (pre-altered)
3. Check if multiple requesters have same email (deduplication issue)

## Changelog

- **MIG_200**: Initial clinic stats view with fixed ±6 month window
- **MIG_208**: Rolling attribution windows based on request status
