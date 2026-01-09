# Hybrid Transition Guide

> **Purpose**: Describe how Airtable and Cockpit work together during the hybrid phase.
> Staff continues using Airtable; Cockpit provides enhanced views and optional entry points.
>
> **Current Phase**: Phase 0-1 (Airtable writes, Cockpit reads)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        STAFF                                │
│   (Receptionist, Trapping Coordinator, Foster Team)         │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│     AIRTABLE        │   │     COCKPIT         │
│  (Staff-facing SoT) │   │  (Enhanced views)   │
│                     │   │                     │
│  • Daily workflows  │   │  • /ops dashboard   │
│  • Automations      │   │  • /focus page      │
│  • Forms/Views      │   │  • /requests        │
│  • Email triggers   │   │  • /new-request*    │
└─────────┬───────────┘   └──────────┬──────────┘
          │                          │
          │   ┌──────────────────┐   │
          │   │   SCHEDULED      │   │
          └──►│   INGEST         │◄──┘ (* writes to Airtable)
              │   (Python)       │
              └────────┬─────────┘
                       │
                       ▼
              ┌────────────────┐
              │   POSTGRES     │
              │   (Read Model) │
              │                │
              │  • requests    │
              │  • people      │
              │  • places      │
              │  • addresses   │
              └────────────────┘
```

---

## Phase Definitions

### Phase 0: Airtable Writes Only, Cockpit Reads Only
**Status**: CURRENT

| Actor | Interface | Capability |
|-------|-----------|------------|
| Staff | Airtable | Create, Read, Update |
| Staff | Cockpit | Read only (dashboards) |
| System | Ingest | Airtable → Postgres sync |

**Data Flow**:
```
Staff → Airtable → Ingest → Postgres → Cockpit (read)
```

**Automations**: All run in Airtable

---

### Phase 1: Cockpit Write Pilot (Airtable-First)
**Status**: FEATURE-FLAGGED

| Actor | Interface | Capability |
|-------|-----------|------------|
| Staff | Airtable | Full access (unchanged) |
| Staff | Cockpit | Read + Write Pilot |

**Data Flow** (Write Pilot):
```
Staff → Cockpit → Airtable API → Airtable
                                    ↓
                              Automations fire
                                    ↓
                              Ingest → Postgres
```

**Key Point**: Cockpit writes INTO Airtable, not around it. All automations still trigger normally.

**Feature Flag**: `NEXT_PUBLIC_WRITE_PILOT_ENABLED=true`

---

### Phase 2: Scheduled Ingest (Enhanced)
**Status**: ACTIVE

| Process | Schedule | Source | Target |
|---------|----------|--------|--------|
| Trapping Requests | Hourly | Airtable | `trapper.requests` |
| Appointment Requests | Hourly | Airtable | `trapper.appointment_requests` |
| ClinicHQ Appointments | Daily | XLSX Export | `trapper.clinichq_*` |

**Ingest Scripts**:
- `ingest_airtable_trapping_requests.py`
- `ingest_clinichq_historical.py`

---

### Phase 3: Dual-Write (FUTURE)
**Status**: NOT IMPLEMENTED

| Actor | Interface | Write Target |
|-------|-----------|--------------|
| Staff | Airtable | Airtable only |
| Staff | Cockpit | Airtable + DB |

**Data Flow** (Dual-Write):
```
Staff → Cockpit → Airtable API → Airtable → Automations
                 ↓
                 → Postgres (direct)
```

**Benefit**: Faster DB updates, less ingest lag
**Requirement**: Explicit approval before enabling

---

### Phase 4: Cockpit-First (FAR FUTURE)
**Status**: NOT PLANNED

Optional evolution where:
- Cockpit becomes primary entry point
- Airtable receives sync writes
- Automations migrated to Cockpit/DB jobs

**Requirement**: Full workflow audit and staff buy-in

---

## How Staff Continues to Work in Airtable

### Guaranteed Unchanged Workflows

| Workflow | Airtable Location | Impact |
|----------|-------------------|--------|
| Appointment Request review | Gallery view | None |
| Trapping Request creation | Trapping Requests table | None |
| Email batch staging | Ready to Email checkbox | None |
| Out-of-county email | Out of County Email checkbox | None |
| Trapper onboarding | Potential Trappers table | None |
| Foster contract intake | JotForm → Foster tables | None |

### What Cockpit Adds (Optional)

| Feature | Staff Can... | Airtable Impact |
|---------|--------------|-----------------|
| `/ops` | View org dashboard | None |
| `/focus` | See "this week" priorities | None |
| `/requests/{id}` | View request details | None |
| `/new-request` | Create request via wizard | Creates Airtable record |
| Reality Check | See data issues + next steps | None |

### Staff Choice

- **Airtable-only staff**: Continue exactly as before
- **Cockpit-curious staff**: Try dashboards for visibility
- **Ben (Coordinator)**: Use Cockpit for triage + write pilot

---

## Technical Details

### Airtable API Integration

**Read Operations** (Schema Snapshot):
```python
# GET https://api.airtable.com/v0/meta/bases/{baseId}/tables
# Requires: PAT with schema.bases:read scope
```

**Write Operations** (Write Pilot):
```typescript
// POST https://api.airtable.com/v0/{baseId}/{tableName}
// Requires: PAT with data.records:write scope
```

### Environment Variables

```bash
# Required for schema snapshots
AIRTABLE_API_KEY=pat...         # schema.bases:read scope
AIRTABLE_BASE_ID=app...

# Required for write pilot
NEXT_PUBLIC_WRITE_PILOT_ENABLED=true
AIRTABLE_TRAPPING_REQUESTS_TABLE=Trapping Requests

# Future: schema apply tooling
AIRTABLE_SCHEMA_WRITE_ENABLED=false
```

### Database Sync

**Ingest frequency**: Configurable (default: hourly)

**Tables synced**:
| Airtable Table | Postgres Table |
|----------------|----------------|
| Trapping Requests | `trapper.requests` |
| Appointment Requests | `trapper.appointment_requests` |
| Clients | `trapper.people` |
| Places | `trapper.places` |
| Address Registry | `trapper.addresses` |

---

## FAQ

### Q: Will my Airtable automations break?
**A**: No. We never modify protected fields. See `AIRTABLE_COMPAT_MATRIX.md`.

### Q: Can I ignore Cockpit?
**A**: Yes. Cockpit is additive. Airtable continues working independently.

### Q: What if the write pilot creates bad data?
**A**: Write pilot is feature-flagged. It writes to Airtable, so staff can fix records there as usual.

### Q: When does Cockpit become mandatory?
**A**: Not planned. Cockpit is an enhancement, not a replacement (yet).

### Q: How do I turn off the write pilot?
**A**: Set `NEXT_PUBLIC_WRITE_PILOT_ENABLED=false` in environment.

---

*This document describes the hybrid architecture. For implementation details, see `ZAP_SAFE_TRANSITION_PLAN.md`.*
