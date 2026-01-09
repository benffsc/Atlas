# Reality Docs

These documents describe the **operational reality** — how trapping operations actually work, what constraints exist, and what the data means.

## Core Documents

| Document | Purpose |
|----------|---------|
| [AI_CONTEXT_PACK.md](AI_CONTEXT_PACK.md) | High-level context for AI assistants. What we're building, core problem (location ambiguity), system roles. |
| [REALITY_CONTRACT.md](REALITY_CONTRACT.md) | Detailed mapping of status semantics, stage logic, request-to-appointment linking, location handling. |
| [COCKPIT_FIELD_MENTAL_MODEL.md](COCKPIT_FIELD_MENTAL_MODEL.md) | Mental model of how coordinators think about the field (geography, priorities, constraints). |

## Workflow Documents

| Document | Purpose |
|----------|---------|
| [AIRTABLE_WORKFLOWS_CATALOG.md](AIRTABLE_WORKFLOWS_CATALOG.md) | Current Airtable workflows and Zap automations. Reference for what Atlas must support or replace. |
| [HYBRID_TRANSITION.md](HYBRID_TRANSITION.md) | Plan for running Airtable + Atlas in parallel during transition. |

## Key Concepts

### Location Ambiguity
~30% of requests are at "fuzzy" locations — parks, trails, "behind the barn". Atlas preserves these as **anchor locations** with notes, rather than forcing them into fake street addresses.

### Airtable Remains Primary
Airtable is the trusted operational system. Atlas reads from Airtable but does not (yet) write back. Transition happens as trust builds.

### Status Semantics
- `new` → Intake, not reviewed
- `in_progress` → Coordinator has reviewed
- `active` → Trapper is engaged
- `closed` → Done operationally

See [REALITY_CONTRACT.md](REALITY_CONTRACT.md) for full status/stage mapping.

---

*These docs should be updated when operational realities change.*
