# Source of Truth (SoT) Schema

Canonical, deduplicated entities. The single source of truth for Atlas.

## Tables

| Table | Purpose |
|-------|---------|
| `trapper.addresses` | Geocode-validated addresses with city/postal |
| `trapper.places` | Named locations (may be approximate) |
| `trapper.people` | Deduplicated contacts |
| `trapper.canonical_cats` | Identified cats with microchip tracking |

## Design Principles

1. **Deduplicated** — Each entity appears once
2. **Validated** — Addresses are geocoded; data quality verified
3. **Linked** — Relations to raw sources preserved
4. **Stable IDs** — Primary keys don't change after creation

## Creation Flow

```
Raw Tables (ingested data)
    ↓
[scripts/normalize/*]
    ↓
Review Queues (human triage)
    ↓
SoT Tables (canonical entities)
```

## Files

- `MIG_130__sot_layer_link_tables.sql` — Core SoT linking infrastructure
