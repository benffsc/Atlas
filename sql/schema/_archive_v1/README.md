# V1 Schema Migrations (Archived)

**Date Archived:** 2026-02-14
**Reason:** Migrated to V2 schema architecture (sot/ops schemas)

## What This Contains

These are legacy migrations that created objects in the `trapper` schema.
As of the V2 migration, all production data lives in:
- `sot.*` - Source of Truth tables (entities, identifiers, relationships)
- `ops.*` - Operations tables (workflows, email, appointments)

The `trapper` schema now only contains compatibility views that forward to sot/ops.

## Directories

- `sot/` - 636 migrations (MIG_130 through MIG_999)
- `raw/` - 3 migrations (early raw tables)
- `review/` - 1 migration (data review layer)

## Do Not Run

These migrations should NOT be run on a V2 database. They:
1. Reference the trapper schema which may be dropped
2. Create duplicate objects that already exist in sot/ops
3. May conflict with V2 migrations

## Current Migrations

Active migrations are in `sql/schema/v2/` starting with MIG_2000.

## Migration History

1. V1 (trapper schema): MIG_050 - MIG_999
2. V2 (sot/ops schemas): MIG_2000+
