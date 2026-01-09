# Review Schema

Tables and views for human triage. Surfaces data quality issues for cleanup.

## Tables

| Table | Purpose |
|-------|---------|
| `trapper.data_issues` | Flagged problems with severity and resolution status |

## Views

| View | Purpose |
|------|---------|
| `v_address_review_queue` | Addresses needing geocoding or validation |
| `v_triage_counts` | Summary counts by issue type |
| `v_open_issues` | Active issues for triage UI |

## Design Principles

1. **Issues Are Additive** — New issues are inserted, never deleted
2. **Resolution Tracked** — `is_resolved`, `resolved_at`, `resolved_by`
3. **Severity Levels** — 1 (high) to 5 (low) for prioritization
4. **Entity Links** — Issues link to the affected entity (request, address, person)

## Issue Types

| Type | Description |
|------|-------------|
| `needs_geo` | Address needs geocoding |
| `raw_address` | Address couldn't be parsed |
| `missing_contact` | Request has no contact info |
| `duplicate_suspect` | Possible duplicate entity |
| `stale_request` | Request hasn't been updated in too long |

## UI Integration

Review queues are surfaced in:
- `/triage` — Triage dashboard
- `/ops` — Ops dashboard data quality section

## Files

- `MIG_100__ops_lens_and_data_issues.sql`
