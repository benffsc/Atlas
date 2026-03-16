# Colony Size Estimation in Atlas

## Overview

Atlas uses a tiered approach to colony size estimation based on wildlife ecology best practices. This document explains the data sources, calculations, and how estimates improve over time.

---

## Why Colony Size Matters

Colony size estimation is essential for:
1. **Alteration Rate Calculation**: `altered / colony_size` tells us TNR progress
2. **Resource Allocation**: Prioritize places with more unaltered cats
3. **Impact Measurement**: Track population changes over time
4. **Program Effectiveness**: Research suggests 70-80% alteration rate needed for population stabilization

---

## Three-Tier Estimation Hierarchy

### Tier 1: Verified Altered (A_known) - Ground Truth

**Source**: Clinic procedures linked to places via `sot.cat_place`

**Confidence**: 100% (this is what we've actually done)

**Calculation**:
```sql
A_known = COUNT(DISTINCT cats with spay/neuter procedure at this place)
```

**What it tells us**: The absolute minimum number of altered cats we know exist at this location.

### Tier 2: Lower-Bound Estimate (p_lower) - Defensible Minimum

**Source**: Survey reports (P75, intake forms, trapper visits)

**Calculation**:
```
N_recent_max = MAX(reported_total_cats) within last 180 days
p_lower = A_known / MAX(A_known, N_recent_max)
```

**Why MAX instead of average?**
- Multiple reports of the same colony shouldn't inflate counts
- The maximum represents the most complete observation
- Prevents double-counting when cats are reported multiple times

**What it tells us**: The alteration rate is *at least* this high. We never over-claim.

### Tier 3: Mark-Resight Estimate (Ecology Grade) - Statistical Inference

**Source**: Ear-tip observation data from surveys

**Calculation** (Chapman estimator):
```
M = known ear-tipped cats at place (from clinic = A_known)
C = total cats observed during survey
R = ear-tipped cats observed during survey

N_hat = ((M+1)(C+1)/(R+1)) - 1
p_hat = M / N_hat
```

**What it tells us**: A statistically-validated estimate of true colony size, based on the same mark-recapture theory used in wildlife management.

---

## Data Sources and Confidence Weights

| Source | Base Confidence | Description |
|--------|-----------------|-------------|
| `verified_cats` | 100% | Cats in database with clinic procedures |
| `post_clinic_survey` | 85% | P75 surveys from clinic clients |
| `trapper_site_visit` | 80% | Assessment by trained trapper |
| `manual_observation` | 75% | Staff/admin manual entry |
| `trapping_request` | 60% | Requester estimate when calling |
| `intake_form` | 55% | Web intake form submission |
| `appointment_request` | 50% | Appointment booking estimate |

### Confidence Adjustments

- **Recency Factor**: Estimates decay over time (100% if <30 days, down to 25% if >1 year)
- **Firsthand Boost**: +5% if reporter saw cats themselves
- **Clinic Boost**: +10% if clinic procedure within 4 weeks of observation
- **Multi-Source Confirmation**: +15% if 2+ sources agree within 20%

---

## Key Database Objects

### Table: `place_colony_estimates`

Stores individual observations from all sources:

```sql
-- Core counts
total_cats INTEGER
adult_count INTEGER
kitten_count INTEGER
altered_count INTEGER
unaltered_count INTEGER

-- Ecology fields (for mark-resight)
peak_count INTEGER               -- Highest seen at once (last 7 days)
eartip_count_observed INTEGER    -- Ear-tipped cats seen
total_cats_observed INTEGER      -- Total cats in observation session

-- Context
observation_time_of_day TEXT     -- dawn, midday, dusk, evening, night
is_at_feeding_station BOOLEAN
reporter_confidence TEXT         -- high, medium, low

-- Tracking
source_type TEXT                 -- post_clinic_survey, intake_form, etc.
observation_date DATE
reported_by_person_id UUID
```

### View: `v_place_ecology_stats`

Computes ecology-based metrics per place:

```sql
-- Ground truth
a_known                 -- Verified altered cats
last_altered_at         -- Last clinic procedure date

-- Survey aggregates
n_recent_max           -- Max reported total (180 days)
report_count           -- Number of observations

-- Alteration rates
p_lower                -- Lower bound rate (0-1)
p_lower_pct            -- Lower bound percentage

-- Mark-resight (when data available)
has_eartip_data        -- Boolean
n_hat_chapman          -- Chapman population estimate
p_hat_chapman_pct      -- Mark-resight alteration rate

-- Best estimate
estimation_method      -- 'mark_resight', 'max_recent', 'verified_only'
best_colony_estimate   -- Single best estimate
estimated_work_remaining
```

### View: `v_place_colony_status`

Weighted average approach (legacy, still available):

- Uses confidence-weighted mean of all estimates
- Applies recency decay
- Includes clinic boost

---

## Data Collection for Better Estimates

### Essential Questions (Always Ask)

1. **How many cats?** - Total count estimate
2. **Are any ear-tipped?** - Categorical (none/some/most/all)

### High-Value Questions (Enable Mark-Resight)

3. **Peak count (last 7 days)** - "What's the highest number you've seen at once?"
4. **Ear-tip count** - "About how many have ear tips?"
5. **Total observed** - Same observation session as ear-tip count

### Helpful Context

6. **Observation time** - When cats are typically seen
7. **Feeding station** - If observed at regular feeding
8. **Confidence** - How sure reporter is of count

---

## Estimation Method Selection

The system automatically selects the best method based on available data:

```
IF ear-tip observations exist AND A_known > 0:
   Use mark_resight (Chapman estimator)
   Display: "~XX cats (ecology estimate)"
   Badge: "Ecology Grade"

ELSE IF survey reports exist (N_recent_max > 0):
   Use max_recent (lower bound)
   Display: "≥XX% alteration rate"
   Badge: "Lower Bound"

ELSE IF clinic data exists (A_known > 0):
   Use verified_only
   Display: "X verified altered"
   No rate shown (denominator unknown)

ELSE:
   No estimate possible
```

---

## API Endpoints

### GET /api/places/{id}/colony-estimates

Returns:
```typescript
{
  place_id: string;
  estimates: ColonyEstimate[];  // Individual observations
  status: ColonyStatus;         // Weighted average stats
  ecology: EcologyStats;        // Ecology-based metrics
  has_data: boolean;
}
```

### Key ecology fields:
```typescript
ecology: {
  a_known: number;              // Verified altered cats
  n_recent_max: number;         // Max reported (180 days)
  p_lower: number | null;       // Lower bound rate (0-1)
  p_lower_pct: number | null;   // Lower bound percentage
  estimation_method: string;    // 'mark_resight' | 'max_recent' | 'verified_only'
  has_eartip_data: boolean;
  n_hat_chapman: number | null; // Mark-resight estimate
  p_hat_chapman_pct: number | null;
  best_colony_estimate: number | null;
  estimated_work_remaining: number | null;
}
```

---

## Upgrade Path

As data collection improves, places automatically graduate to better estimation methods:

1. **Initial**: Just clinic data (verified_only)
2. **With surveys**: Can compute lower-bound rate (max_recent)
3. **With ear-tip counts**: Full mark-resight estimation (ecology grade)

### Collecting Ear-Tip Data

Add these questions to P75 surveys and intake forms:

```
"In the last 7 days, what's the highest number of cats you've seen at one time?"
[numeric input]

"Of those cats, about how many had an ear tip?"
[numeric input]
```

With just these two questions, places can graduate to mark-resight estimation.

---

## Target Alteration Rates

Research on TNR effectiveness suggests:

| Rate | Expected Outcome |
|------|------------------|
| <50% | Population likely growing |
| 50-70% | Population may stabilize |
| 70-80% | Population likely stable/declining |
| >80% | High confidence in population control |

**Important caveats**:
- Immigration/emigration affects outcomes
- Contiguous coverage matters
- Local context varies

---

## References

- Chapman, D.G. (1951). "Some properties of the hypergeometric distribution with applications to zoological sample censuses"
- Best Friends Animal Society. "Community Cat Programs Handbook"
- Levy, J.K. & Crawford, P.C. (2004). "Humane strategies for controlling feral cat populations"
