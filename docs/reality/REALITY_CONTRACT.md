# Reality Contract

*Single source of truth mapping operational reality to logic layer.*
*Based on Ben's questionnaire answers (2026-01-03).*

---

## Status Semantics

| Status | Meaning | TNR Stage |
|--------|---------|-----------|
| `new` | Request received, not yet reviewed | intake |
| `needs_review` | Flagged for coordinator attention | intake |
| `in_progress` | Acknowledged by coordinator, understood | fieldwork |
| `active` | Truly actively being worked, trapper engaged | fieldwork |
| `paused` | Temporarily on hold (multiple reasons) | paused |
| `closed` | Done operationally until further notice | closed |
| `resolved` | Similar to closed, but partial success (4/5 cats) | closed |

### Key Distinctions
- **in_progress vs active**: `in_progress` = coordinator has seen/acknowledged; `active` = resources actively deployed
- **closed vs resolved**: Both are terminal; `resolved` may indicate partial completion or soft-close
- **Trigger to fieldwork**: When coordinator reviews and understands the case (manual)

### Pause Reasons (should track)
- Weather hold
- Waiting for callback
- Property access issue
- Resource constraints (moving to other priorities)
- Other (freeform)

---

## Stage Mapping Policy

```
intake     → new, needs_review
fieldwork  → in_progress, active
paused     → paused
closed     → closed, resolved
unknown    → (default to intake for visibility)
```

All unknown/unmapped statuses surface as `intake` to ensure visibility in triage.

---

## Request-to-Appointment Linking

**Reality**: Linking is **probabilistic**, not guaranteed.

### Why Linking Is Fuzzy
- Reporter may not be the final contact person
- Property owner vs feeder vs neighbor can swap
- Same cats may span multiple requests/contacts
- Business lots vs residential boundaries unclear

### Linking Strategy
- **Primary**: Address + contact phone (fuzzy match)
- **Secondary**: Case number in notes (if entered)
- **Fallback**: Manual linking or unlinked
- **Multiple appointments per request**: Yes, typically 2-5 visits

### Handle With Care
- One request can have multiple appointments
- One appointment might relate to multiple requests (rare)
- System should support but not enforce 1:1

---

## Location & Places

**~30% of requests** are at fuzzy locations (parks, trails, "behind the barn").

### Address Normalization Principles
1. Geocode when possible (clean street addresses)
2. For fuzzy locations: pin nearby address + preserve original text in notes
3. Maintain canonical address registry for deduplication
4. Use radius matching (~200m) for near-duplicate detection
5. **Watch for**: Owner of pinned address later becoming involved

### Place vs Address
- `places` = named locations (apartment complex, park, business)
- `addresses` = geocoded street addresses
- Many places share one address; one place may span multiple addresses

---

## Trapper Assignment Model

**Current State**: Ben (coordinator) assigns, Crystal (head trapper) executes, volunteers help.

### Roles
- **Coordinator** (Ben): Reviews requests, assigns, tracks
- **Head Trapper** (Crystal): Primary trapper, paid staff
- **FFSC Trappers**: Volunteers who completed orientation + contract
- **Community Trappers**: Informal helpers, varying experience

### Assignment Logic
- All requests visible (no "my requests" filter for now)
- Sort by priority + date
- Consider geographic clustering (Rohnert Park/Petaluma = quick action)

---

## Historical Data Usage

**All history matters** for context, safety, and patterns.

### Key Uses (ranked)
1. "Have we helped this person before?"
2. "How many cats at this address?"
3. "Is this a repeat request (same location, new cats)?"
4. "When was last appointment at this location?"
5. "What was the outcome last time?"
6. **Safety notes**: "Is it safe to send a trapper here?"

---

## Dashboard Priorities

### What Ben Wants to See First
1. Most pressing/active requests needing trapper assignment
2. Backlog of lower-priority requests being pushed too long
3. Hotspot addresses/zones
4. Upcoming appointments (especially MW clinic days)

### Alerts (context-dependent)
- Before clinic day (Mon/Wed): Tomorrow's appointments
- Other days: Duplicate detection, stale requests

---

## Feature Priority (from Ben's ranking)

1. Quick-create request from dashboard
2. Search by address or client name
3. Upload photos/attachments
4. Assign requests to trappers
5. Track status change history
6. See all appointments for a request

---

## Clinic Operations Context

- **Target**: 40-47 cats per clinic day
- **Booking**: 60-75 appointments (accounting for no-shows)
- **Days**: Monday + Wednesday (TNR), Thursday (tame cats, max 13 spays)
- **Mass trapping**: Thursdays without tame clinic, target 50 cats, 2-3 sites
- **Gender split**: ~48-52% target

---

## Migration Policy

**Ben's preference**: Auto-apply all migrations (trusts the system).

*For now, continue manual-apply pattern until tooling is proven stable.*

---

## Data Import Strategy

**Current**: Both Airtable CSV + API sync
**Future**: Phase out Airtable when tool is 100% trusted

---

## Guardrails

Validate logic layer against reality with:

```bash
make reality-check
```

This runs `sql/queries/QRY_141__reality_guardrails.sql` which checks:
- Status distribution
- TNR stage distribution
- Triage bucket counts
- Open data issues
- Assignment coverage

---

*This contract should be updated when operational realities change.*
*Last updated: 2026-01-03*
