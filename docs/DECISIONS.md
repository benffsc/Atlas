# Architecture Decision Records (ADRs)

Append-only log of significant design decisions. Each entry explains the context, decision, and rationale.

---

## ADR-001: Separate SoT from Raw Tables

**Date:** 2026-01-08
**Status:** Accepted

### Context
We ingest data from multiple sources (Airtable, ClinicHQ, form submissions). Each source has its own schema and quirks. We need a way to:
1. Preserve original data for audit/debugging
2. Create clean, canonical entities for the UI
3. Surface data quality issues for human review

### Decision
Establish three distinct table categories:
- **Raw** (`sql/schema/raw/`): Staging tables that mirror source format. Ingests are append/upsert.
- **SoT** (`sql/schema/sot/`): Canonical entities created by normalizing raw data.
- **Review** (`sql/schema/review/`): Queues for human triage.

### Rationale
- Raw tables enable re-processing without re-fetching from sources
- SoT tables are the single source of truth for UI/reports
- Review queues make data quality visible and actionable
- Clear separation makes it obvious where to look for issues

---

## ADR-002: Manual Migration Application

**Date:** 2026-01-08
**Status:** Accepted

### Context
Auto-applying migrations on startup can be dangerous. A typo or logic error could affect production data before anyone notices.

### Decision
Migrations are applied manually via psql or Supabase SQL Editor. The app does NOT auto-apply migrations.

### Rationale
- Explicit human review before any schema change
- Easier to rollback (just don't apply)
- Matches Supabase workflow (SQL Editor is the primary interface)
- Prevents "it worked on my machine" deployment surprises

---

## ADR-003: Anchor Locations for Approximate Places

**Date:** 2026-01-08
**Status:** Accepted

### Context
Cats aren't always at clean street addresses. Examples:
- "Joe Rodota Trail near the overpass"
- "Apartment complex behind the shopping center"
- "The barn on Johnson property"

Forcing these into street addresses loses critical context.

### Decision
Introduce "anchor locations" — places with:
- A lat/lng point (best approximation)
- Explicit `location_precision` flag (exact, approximate, area)
- Preserved notes/context in `location_notes`

### Rationale
- Preserves operational context that trappers need
- Doesn't pretend false precision
- Allows UI to display appropriate uncertainty indicators
- Notes survive even if geocoding fails

---

## ADR-004: Airtable Remains Primary During Transition

**Date:** 2026-01-08
**Status:** Accepted

### Context
Airtable is the current operational system. Staff know it, trust it, and rely on it daily. Switching to a new system is risky.

### Decision
During transition:
- Airtable remains the primary system for data entry and daily ops
- Atlas reads from Airtable (via exports) but does not write back
- New features can be Atlas-only if they don't disrupt Airtable workflows
- Transition happens incrementally as trust builds

### Rationale
- Minimizes disruption to daily operations
- Allows Atlas to prove itself before taking on critical workflows
- Staff can compare Atlas views to Airtable to validate accuracy
- If Atlas has bugs, Airtable is still the fallback

---

## ADR-005: No Destructive Database Operations

**Date:** 2026-01-08
**Status:** Accepted

### Context
Accidental data loss is catastrophic. A mistyped `DROP TABLE` or `DELETE FROM` can destroy months of work.

### Decision
- Never use `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`, or `DELETE FROM` without WHERE in migrations
- "Deletes" are soft-deletes (set archived_at or is_deleted flag)
- Bad data goes to review queues, not the void
- Destructive operations require explicit approval with full backup

### Rationale
- Data is irreplaceable; disk space is cheap
- Soft deletes allow recovery and audit trails
- Review queues make data quality visible rather than hiding problems
- Forces us to think about data lifecycle explicitly

---

*Add new decisions below. Never edit or remove existing entries.*
