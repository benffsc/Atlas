# CATS — Credibility-Weighted Attrition-Temporal System

## Overview

CATS is Beacon's population estimation engine. It fuses observations from 9+ entry points into a single credibility-weighted estimate per place, using a 1D Kalman filter with attrition-aware floor counts.

**No existing TNR software implements population decay.** The closest analogues are in wildlife management (Pollock's Robust Design, Jolly-Seber models). CATS is genuinely novel in the TNR space.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  OBSERVATION SOURCES (9 entry points)                        │
│  Intake forms, site visits, clinic records, requests,        │
│  Chapman estimates, AI-parsed, kiosk, trip reports, overrides │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  KALMAN FILTER — sot.update_population_estimate()            │
│  • Prediction: variance grows Q=1.0/month between obs       │
│  • Update: pulls estimate toward observation, weighted by R  │
│  • Floor: attrition-weighted (not raw) verified cat count    │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  STATE — sot.place_population_state (one row per place)      │
│  estimate, variance, floor_count, observation_count          │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  DISPLAY — v_place_colony_status, ColonyEstimates.tsx         │
│  ~14 cats (10-18) · Medium confidence                        │
│  121 verified → ~43 likely still here (13% annual attrition) │
└─────────────────────────────────────────────────────────────┘
```

## Source Credibility (R values)

Lower R = more trusted. R scales with count magnitude: `R_adjusted = R_base * (1 + count/10)`.

| Source | R_base | Example |
|--------|--------|---------|
| `clinic_records` | 1.0 | Verified altered cat linked to place |
| `chapman_estimate` | 3.0 | Mark-recapture calculation |
| `trapper_site_visit` | 4.0 | Field trapper observation |
| `staff_observation` | 5.0 | Staff phone call or admin entry |
| `trapping_request` | 12.0 | `total_cats_reported` on a request |
| `intake_form` | 15.0 | Web intake form / requester update |
| `ai_parsed` | 18.0 | AI-extracted data |

## Attrition Decay (MIG_3094)

### The Problem

A cat linked to a place via a 2018 clinic appointment, with no lifecycle event showing departure, still counts in the floor. Without attrition, a place with 121 cats altered over 10 years shows floor=121. But many have died, moved, or been adopted without being tracked in ShelterLuv.

### The Solution

Each cat's contribution to the floor count is weighted by survival probability:

```
contribution = (1 - annual_attrition_rate)^years_since_last_appointment
```

**Default annual attrition: 13%** (admin-configurable via `ops.app_config`).

| Years Since Last Appointment | Survival Weight | Category |
|----|----|----|
| 0 (< 90 days) | 100% | Current |
| 1 (< 1 year) | 87% | Recent |
| 3 (< 3 years) | 66% | Stale |
| 5 | 50% | Historical |
| 7 | 38% | Historical |
| 10 | 25% | Historical |

### Evidence Date

The freshness function uses **appointment_date** (actual clinical visit), NOT `cat_place.created_at` (which reflects when entity linking created the row, often years after the actual visit).

### Config Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `population.annual_attrition_rate` | 0.13 | Annual probability cat has left |
| `population.freshness_current_days` | 90 | "Current" threshold |
| `population.freshness_recent_days` | 365 | "Recent" threshold |
| `population.freshness_stale_days` | 1095 | "Stale" threshold (3yr) |

### Research Basis

- **Levy, Gale & Gale (2003)** — UCF 11-year study. Managed colony declined 68→23 (9-10% annual attrition).
- **Natoli et al. (2006)** — Rome 10-year study. 12-15% annual attrition for sterilized adults.
- **Spehar & Wolf (2018)** — Chicago study. 10-15% annual attrition for managed adult cats.
- **ASPCA Community Cat Programs** — Flag colonies as unreliable after 12-18 months without observation.
- **FCCO (Feral Cat Coalition of Oregon)** — 3-tier: Active (<12mo), Presumed present (12-36mo), Historical (>36mo).

## Kitten Handling

### Key Principle

**Kittens that enter FFSC custody should NOT inflate colony estimates.** If 5 kittens are reported at a place and 5 kittens appear in ShelterLuv intake shortly after → they went into foster/adoption → they should be `departed` from the colony. But kittens that are TNR'd (altered and returned to field) DO count.

### How It Works

1. **Intake reports kittens** → `kitten_count` field on request, `has_kittens` flag
2. **Site observations track kittens** → `kittens_seen` on `ops.site_observations`
3. **ShelterLuv intake event** → Cat enters custody → `presence_status = 'departed'` + `departure_reason = 'in_foster'` or `'adopted'` via `sot.update_cat_place_from_lifecycle_events()`
4. **TNR'd kittens** → Go through clinic, get altered, returned to field → `presence_status = 'current'` (confirmed by RTF lifecycle event)
5. **Colony estimate** → Only counts kittens with `presence_status != 'departed'`

### What `total_cats_reported` Means for Kittens

When a requester reports "8 cats" — this typically includes kittens. The Kalman filter processes this as a `trapping_request` observation (R=12.0, moderate credibility). If subsequently:
- 5 kittens go into foster → their cat_place rows get `departed` → floor drops
- 3 adult cats remain → floor settles at 3
- The Kalman estimate converges toward actual remaining population

### Kitten Count Is Not Colony Size

`kitten_count` on a request/intake is informational — it helps staff prioritize (kitten rescue is time-sensitive). It does NOT directly feed the Kalman filter. What feeds the filter:
- `total_cats_reported` (includes kittens) → observation
- `cats_seen_total` on site observations → observation
- Actual cat_place links from clinic appointments → floor count

## Presence Status (FFS-1280)

| Status | Meaning | Counts in Colony? |
|--------|---------|-------------------|
| `current` | Confirmed still at place (RTF event, recent observation) | Yes |
| `departed` | Left the place (adopted, relocated, transferred, deceased, in_foster) | No |
| `unknown` | No lifecycle event either way (default) | Yes (decayed by attrition) |
| NULL | Legacy row, not yet processed | Yes (decayed by attrition) |

## Time Decay Cron

**Weekly (Sunday 4 AM):** `/api/cron/population-decay` increases variance for all places not observed in 30+ days. This makes confidence labels degrade over time:
- Variance ≤ 5 → High confidence
- Variance ≤ 20 → Medium confidence
- Variance > 20 → Low confidence

After enough time without observation, even a previously high-confidence estimate shows "Low confidence" — signaling the place needs a fresh site visit.

## Key Functions

| Function | Purpose |
|----------|---------|
| `sot.update_population_estimate(place_id, count, source, date)` | Core Kalman update |
| `sot.get_altered_cat_count_at_place(place_id)` | Raw floor (non-departed altered cats) |
| `sot.get_attrition_weighted_floor(place_id)` | Attrition-weighted floor + freshness breakdown |
| `sot.trg_cat_place_kalman_update()` | Trigger: updates estimate when altered cat linked |
| `sot.update_cat_place_from_lifecycle_events()` | Marks cats departed from ShelterLuv events |

## Key Tables

| Table | Purpose |
|-------|---------|
| `sot.place_population_state` | Current Kalman state per place |
| `sot.population_observations` | Audit log of every Kalman update |
| `sot.v_place_colony_status` | View: estimate + CI + confidence + floor |
| `sot.v_place_cat_freshness` | View: per-cat freshness at each place |
| `ops.app_config` | Configurable parameters (attrition rate, thresholds) |

## Key Views

| View | Purpose |
|------|---------|
| `sot.v_place_colony_status` | Colony summary with Kalman estimate, CI, backward compat |
| `sot.v_place_cat_freshness` | Per-cat freshness category + survival probability |
| `ops.v_colony_cat_paths` | Per-place outcome breakdown (departed/current/unknown) |
| `ops.mv_beacon_place_metrics` | Map pins use `colony_estimate` from Kalman |

## Migrations

| MIG | Purpose |
|-----|---------|
| MIG_3087 | Core Kalman: state table, function, trigger, backfill, view |
| MIG_3088 | Beacon map integration: matview uses Kalman estimates |
| MIG_3091 | Cat path: presence_status + lifecycle event function |
| MIG_3092 | Map pins exclude departed cats |
| MIG_3093 | Kalman filters departed cats from floor count |
| MIG_3094 | Attrition-weighted floor + freshness view |

## Frontend Components

| Component | What It Shows |
|-----------|---------------|
| `ColonyEstimates.tsx` | Full colony panel: Kalman estimate, CI, freshness, ecology, classification |
| `KalmanEstimateChart.tsx` | SVG chart: estimate line, CI band, observation dots, floor |
| `PopulationEstimateCard.tsx` | Beacon analytics card |
| `PopulationTimeline.tsx` | Lifecycle events at place |

## Display Format

**Standard:** `~14 cats (10-18) · Medium confidence`

**With freshness:** `121 verified → ~43 likely still here (0 current, 0 recent, 0 stale, 121 historical)`

**Progress bar:** `[████████░░░░░░░░] 43 verified altered | ~14 remaining`

## How Requests Interact

When a new trapping request comes in reporting N cats:

1. N is stored as `total_cats_reported` on the request
2. The Kalman filter receives this as a `trapping_request` observation (R=12.0)
3. If the existing estimate is much higher (stale historical data), the new observation pulls it DOWN
4. The attrition-weighted floor prevents the estimate from going below what's likely really there
5. Work remaining = estimate - verified altered at place

**Example:** Place has 121 historical cats (floor weighted to 43). New request says "5 cats here." Kalman processes this with R≈18 (12.0 × (1+5/10)). High existing variance (stale data) → high Kalman gain → estimate drops significantly toward 5. Floor at 43 won't prevent this because the weighted floor likely matches or is below the fresh observation.

## What CATS Does NOT Do (yet)

- AI-assisted observation parsing (CATS-8) — deferred
- Predictive population forecasting with birth rates — deferred
- Individual cat survival modeling (per-cat, not per-place) — deferred
- Kitten-specific attrition rates (higher mortality in first year) — deferred
- Seasonal breeding cycle adjustment — deferred
