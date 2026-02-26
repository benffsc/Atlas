# Trapper Meeting #3 Statistics Report

**Generated:** 2026-02-19 18:15 PST
**Database:** Atlas V2 (Production)
**Report ID:** MEET_2026_02_20_STATS

---

## Schema Map (Data Sources Used)

| Table | Purpose |
|-------|---------|
| `ops.appointments` | Clinic appointments with spay/neuter flags |
| `ops.requests` | Trapping requests with resolution tracking |
| `ops.request_trapper_assignments` | Trapper-to-request attribution |
| `sot.cats` | Cat records |
| `sot.places` | Location/site records |
| `sot.people` | Person records (trappers) |

---

## A) Scoreboard Numbers

### Since Last Meeting (2025-11-21 → 2026-02-19)

| Metric | Count |
|--------|-------|
| **Spays** | 517 |
| **Neuters** | 545 |
| **Total Cats Fixed** | 1,057 |
| **Wellness Only** | 122 |
| **Total Appointments** | 1,179 |

### Year-to-Date (2026-01-01 → 2026-02-19)

| Metric | Count |
|--------|-------|
| **Spays** | 318 |
| **Neuters** | 355 |
| **Total Cats Fixed** | 672 |
| **Wellness Only** | 85 |
| **Total Appointments** | 757 |

### Sites Moved Forward

| Metric | Count |
|--------|-------|
| **Requests Resolved (Since Last Meeting)** | 209 |
| **Requests Resolved (YTD)** | 209 |

**Definition:** Requests with `resolved_at` timestamp in the date range.

---

## B) Mass Trapping Recap (2026-01-29)

### Summary

| Metric | Count |
|--------|-------|
| **Total Cats** | 39 |
| **Females (Spays)** | 20 |
| **Males (Neuters)** | 18 |
| **Wellness Only** | 1 |

**Note:** Slight variance from email stats (19F/18M/2W). Atlas shows 20F/18M/1W. Total matches at 39.

### Sites Involved

| Site | Address | Cats |
|------|---------|------|
| 15760 Pozzan Rd | Healdsburg, CA 95448 | 24 |
| 3820 Selvage Road | Santa Rosa, CA 95401 | 8 |
| 125 Queens Lane | Petaluma, CA 94952 | 5 |
| 836 Daniel Dr | Petaluma, CA 94954 | 1 |
| 36 Rancho Verde Cir | Rohnert Park, CA 94928 | 1 |

**Primary Site:** 15760 Pozzan Rd, Healdsburg (61.5% of cats)

---

## C) Trapper Activity

### Top Trappers (Since Last Meeting)

| Trapper | Cats | Active Weeks | First | Last |
|---------|------|--------------|-------|------|
| Crystal Furtado | 72 | 11 | 2025-11-24 | 2026-02-09 |
| Ben Mis | 44 | 9 | 2025-11-24 | 2026-02-02 |
| Rebecca Basque | 30 | 2 | 2025-12-10 | 2026-01-29 |
| Ellen Johnson | 30 | 2 | 2025-12-10 | 2026-01-29 |
| Linda Bodwin | 27 | 6 | 2025-12-08 | 2026-02-18 |
| Moria Zimbicki | 16 | 7 | 2025-11-24 | 2026-01-28 |
| Susan Simons | 6 | 2 | 2026-02-11 | 2026-02-18 |
| Lynn Richardson | 2 | 1 | 2026-02-09 | 2026-02-09 |
| Stefanie Freele | 2 | 1 | 2025-12-01 | 2025-12-01 |
| Sandra Percell | 1 | 1 | 2025-12-08 | 2025-12-08 |
| Susan Elwood | 1 | 1 | 2026-01-12 | 2026-01-12 |

**Total attributed cats:** 231 (via request-trapper assignments)

**Coverage note:** Trapper attribution covers ~22% of total appointments. The remaining 78% are from appointments without explicit trapper assignments in the system.

---

## D) Foster & Partner Lane

**Status:** Not in Atlas SOT yet.

**Recommendation:** Foster and partner transfer tracking should be added to the SOT layer. Suggested tables:
- `sot.cat_foster_placements` - Foster start/end dates, foster person
- `sot.cat_partner_transfers` - Transfers to partner orgs (Sonoma County Humane, Rohnert Park Animal Services)

Currently, foster data exists in ShelterLuv but hasn't been fully processed into SOT relationships.

---

## One-Liner Insights

- **We averaged 88 cats/week since Nov 21** (1,057 cats ÷ 12 weeks)
- **Top 2 trappers (Crystal + Ben) accounted for 50% of attributed intakes** (116 of 231)
- **Mass trapping at Pozzan Rd was our biggest single-day event** (24 cats in one day)
- **We're seeing momentum in Feb** — 6 new trappers active since January

---

## Metric Definitions

| Metric | Definition |
|--------|------------|
| **Cats Fixed** | Distinct appointments where `is_spay = true` OR `is_neuter = true` |
| **Spays** | Appointments with `is_spay = true` |
| **Neuters** | Appointments with `is_neuter = true` |
| **Wellness Only** | Appointments where `is_spay = false` AND `is_neuter = false` |
| **Trapper Attribution** | Via `request_trapper_assignments` → `requests` → `places` → `appointments` (place match) |
| **Requests Resolved** | Requests with `resolved_at` in date range |

---

## CSV Files Generated

| File | Description |
|------|-------------|
| `scoreboard_since_last_meeting.csv` | Period totals since 2025-11-21 |
| `scoreboard_ytd.csv` | YTD totals since 2026-01-01 |
| `mass_trapping_cohort.csv` | 39 cats from 2026-01-29 with site attribution |
| `trapper_activity_weekly.csv` | Weekly time series for stacked bar chart |
| `trapper_activity_summary.csv` | Top trappers with totals |

**Location:** `artifacts/meeting_2026_02_20/`

---

## SQL Queries Used

See: `sql/analysis/meeting_2026_02_20/`
