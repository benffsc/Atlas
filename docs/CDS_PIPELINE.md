# Cat Determining System (CDS) — Pipeline Reference

The CDS is Atlas's multi-phase engine for matching master list entries (the handwritten surgery log from each clinic day) to ClinicHQ appointment records. It answers: **which line on the paper log corresponds to which digital booking?**

This is critical because FFSC's paper master list and ClinicHQ are maintained independently — the paper log tracks surgery order, while ClinicHQ tracks bookings and microchips. CDS bridges the two.

---

## Architecture: Validate-Before-Commit (FFS-1321)

CDNs (Clinic Day Numbers = master list line numbers) follow a **candidate → validate → commit** flow. Nothing is written until verified against the master list.

```
Waivers (chip-matched) ──┐
                         ├─→ CDN Candidates ──→ ML Validation ──→ Commit (set_clinic_day_number)
Waivers (weight bridge) ─┘                         │
                                                    └─→ Rejected (logged, not written)
```

### Why validate-before-commit?

Waiver OCR misreads ~5% of clinic numbers. Before FFS-1321, misread CDNs were committed directly and cascaded errors into downstream matching phases. Now every CDN proposal is checked against the master list before being written.

**Defense-in-depth:** Even after TS validation, `ops.set_clinic_day_number()` (MIG_3103) runs collision checks and ML cross-validation at the SQL layer. Two independent validation passes must agree.

---

## Pipeline Phases (12 total)

Each phase runs sequentially. Earlier phases narrow the problem for later ones. Manual matches (`match_confidence = 'manual'`) are sacred — never cleared or overwritten.

### Phase 0: Data Assembly
Loads all data sources for the clinic date:
- Master list entries (`ops.clinic_day_entries`)
- ClinicHQ appointments (`ops.appointments`)
- Waiver scans (`ops.waiver_scans`)

### Phase 0.5: Appointment Dedup
Merges duplicate appointments (same microchip, same date) caused by ClinicHQ cancel/rebook flows. Winner selection: prefer has `appointment_number` → has `client_name` → most recent. Transfers `clinic_day_number` and `manually_overridden_fields` from losers to winner.

### Phase 1: CDN Candidate System
The core innovation of FFS-1321. Three sub-steps:

| Step | Function | What it does |
|------|----------|-------------|
| 1a | `buildCDNCandidates()` | Collects CDN proposals from chip-matched waivers (confidence 0.95) and weight bridge dry-run (confidence varies) |
| 1b | `validateCDNCandidates()` | Checks each candidate: ML owner match? Foster exception? Bidirectional conflict? CDN in range? |
| 1c | `commitVerifiedCDNs()` | Writes verified CDNs via `set_clinic_day_number()`. Handles swap detection (two appointments exchanging CDNs). |

**Candidate sources:**

| Source | Confidence | How it works |
|--------|-----------|--------------|
| `waiver_chip` | 0.95 | Waiver matched to appointment via microchip last-4. OCR clinic_number from waiver = proposed CDN. |
| `waiver_weight` | 0.50-0.80 | `ops.bridge_waivers_by_weight_candidates()` scores unmatched waivers against appointments by weight (0.40), sex (0.20), color (0.20), owner name (0.20). |

**Validation rules:**
- ML owner must fuzzy-match appointment client (similarity >= 0.3)
- Foster exception: when either side is foster, check cat name instead of owner
- First-name fallback: handles "Name - call phone" formatting
- Bidirectional: if two candidates claim same CDN, highest confidence wins
- Range: CDN must correspond to an actual ML entry line

### Phase 2: Cancelled Entry Detection
Calls `ops.detect_cancelled_entries()` BEFORE matching so cancelled entries don't consume appointment slots. Detects via notes patterns, header rows, and recheck indicators.

### Phase 3: CDN-First Matching
Calls `ops.match_master_list_by_clinic_day_number()`. Deterministic: if appointment has `clinic_day_number = N` and ML entry has `line_number = N`, they match. Only fires on CDNs validated by Phase 1 (or manually set).

### Phase 4: SQL Deterministic
Calls `ops.apply_smart_master_list_matches()` which runs 4 passes:
1. **Owner name** — fuzzy match ML owner to appointment client
2. **Cat name** — match parsed cat name
3. **Sex** — match sex indicators (F/M marks)
4. **Cardinality** — single-entry owner with single-appointment client = auto-match

### Phase 5: Shelter ID Bridge
Extracts previous shelter IDs from raw ML names (e.g., "SCAS A439019 (updates)") and matches via `sot.cat_identifiers` where `id_type = 'previous_shelter_id'`.

### Phase 6: Waiver Bridge
Three-source triangulation: entry owner ↔ waiver last name ↔ appointment microchip. Uses `parsed_last4_chip` from waiver filenames to bridge entries to appointments.

### Phase 7: Composite Scoring
Multi-signal scoring engine (`clinic-day-matching.ts`) with 8 signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| `client_name` | 0.30 | Owner name fuzzy match (0 for fosters) |
| `cat_name` | 0.20 (0.40 for fosters) | Cat name similarity + ShelterLuv aliases |
| `sex` | 0.10 | F/M agreement (-1 for mismatch) |
| `weight` | 0.10 | Abs weight difference thresholds |
| `chip4` | 0.10 | Waiver chip4 matches appointment microchip |
| `chip_direct` | 0.15 | Owner→waiver→chip→appointment bridge |
| `appt_number` | 0.10 | ClinicHQ Number cross-reference |
| `time_order` | 0.05 | Surgery time rank correlation |

**Foster-aware scoring:** When `entry.is_foster = true`, `client_name` is zeroed (ML says "Foster", CHQ says "Forgotten Felines Fosters" — meaningless) and `cat_name` weight doubles to 0.40. Cat identity is the only reliable signal for fosters.

Minimum thresholds: 0.30 within-group, 0.35 cross-client.

### Phase 8: Weight Disambiguation
Resolves multi-cat owners where name matching can't distinguish (e.g., Mary Stout with 13 cats). Runs AFTER composite scoring so it only handles what names couldn't resolve.

**Key features:**
- Waiver OCR weight preferred over `cat_vitals` (day-of-surgery vs possibly stale)
- Sex partitioning: 2F + 1M → solve female group independently from male group
- Gap-to-next-best threshold: only assigns if the best match is sufficiently better than the runner-up

### Phase 9: Constraint Propagation
Pure logic — no scoring. If N-1 of N entries in an owner group are matched, the Nth must match the remaining appointment. Also applies sex-based constraints (sole female entry + sole female appointment).

### Phase 10: LLM Tiebreaker
Gated behind `cds.llm.enabled` config + `ANTHROPIC_API_KEY`. Sends remaining ambiguous groups to Claude Haiku for suggestions. Results are stored as `match_confidence = 'low'` with `cds_method = 'cds_suggestion'` — never auto-accepted. Staff reviews in the UI.

### Phase 11: Propagate Matches
Calls `ops.propagate_master_list_matches()` to write `cat_id` and `appointment_id` on matched entries. Also links cancelled entries to their cats via `ops.link_cancelled_entries_to_cats()`.

### Phase 12: Classify Unmatched
Deterministic rules + LLM interpret entry notes to classify WHY entries are unmatched: `surgery_cancelled`, `no_show`, `redirected`, `recheck_no_booking`, `no_chq_booking`, etc. Sets `cancellation_reason` on classified entries.

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/cds.ts` | Main pipeline: `runCDS()`, all phases, CDN candidate system |
| `apps/web/src/lib/clinic-day-matching.ts` | Phase 7 composite scorer: signal weights, foster-aware scoring |
| `apps/web/src/lib/cds-metrics.ts` | Benchmarking: ground truth comparison, per-date agreement metrics |
| `scripts/cds-candidate-diff.ts` | Read-only diff tool: compare candidate system output vs current state |

### SQL Functions

| Function | Migration | Purpose |
|----------|-----------|---------|
| `ops.set_clinic_day_number()` | MIG_3103 | Writes CDN with collision + ML validation guards |
| `ops.bridge_waivers_by_weight_candidates()` | MIG_3105 | Dry-run weight bridge returning candidate rows |
| `ops.match_master_list_by_clinic_day_number()` | MIG_3097/3100 | CDN-first deterministic matching |
| `ops.apply_smart_master_list_matches()` | MIG_2330+ | 4-pass SQL matching (owner, cat, sex, cardinality) |
| `ops.detect_cancelled_entries()` | MIG_3101 | Notes/header/recheck cancellation detection |
| `ops.propagate_master_list_matches()` | MIG_3100 | Write cat_id + appointment_id to matched entries |
| `ops.link_cancelled_entries_to_cats()` | MIG_3101 | Resolve cats for cancelled entries |

### Config Keys (`ops.app_config`)

| Key | Default | Purpose |
|-----|---------|---------|
| `cds.thresholds.weight_gap_min` | 1.0 | Minimum gap-to-next-best for weight disambiguation |
| `cds.thresholds.waiver_bridge` | 0.90 | Waiver bridge confidence threshold |
| `cds.llm.enabled` | false | Enable LLM tiebreaker phase |
| `cds.llm.max_calls_per_day` | 5 | LLM call budget per CDS run |
| `cds.llm.min_confidence` | 0.70 | Minimum LLM confidence to save a suggestion |

---

## Running CDS

### Via Admin UI
Navigate to `/admin/clinic-days/[date]` → click "Run CDS" (rematch mode).

### Via API
```
POST /api/admin/clinic-days/[date]/entries
{ "action": "run_cds", "mode": "rematch" }
```

Modes:
- `import` — Only re-score entries affected by data changes since last run
- `rematch` — Clear all non-manual matches and re-run from scratch
- `manual` — Score unmatched entries only, don't clear anything

### Via Script (comparison only, no writes)
```bash
npx tsx scripts/cds-candidate-diff.ts 2026-04-06     # Single date (verbose)
npx tsx scripts/cds-candidate-diff.ts --canary        # 4 canary dates
npx tsx scripts/cds-candidate-diff.ts --all           # All ground truth dates
```

---

## Testing & Verification

### Ground Truth
508 manual CDN assignments across 24 clinic dates (Ben's verified matches). Stored as appointments where `manually_overridden_fields @> ARRAY['clinic_day_number']`.

### Benchmarking
```bash
# Read-only comparison: proposed vs current vs ground truth
npx tsx scripts/cds-candidate-diff.ts --all

# API: single-date metrics
GET /api/admin/cds/benchmark?date=2026-04-06

# API: aggregate across all ground truth dates
GET /api/admin/cds/benchmark
```

### Canary Dates
These dates exercise known edge cases:

| Date | Edge Cases |
|------|-----------|
| `2026-04-06` | Jadis cancelled, Diesel OCR misread, Mary Stout 13 cats |
| `2026-04-08` | Stornetta 5 cats, Mama Peaches foster, Cunda Bhikkhu |
| `2026-04-16` | Twenty Tails Rescue 4 cats (was swapped, now fixed) |
| `2025-12-10` | Many waivers (tests weight bridge candidates) |

### What to watch for
- `no_chq_booking` and `recheck_no_booking` counts should be stable across runs
- Ground truth accuracy should stay >= 95%
- CDN candidate rejections should be cross-owner mismatches, not valid matches blocked

---

## Safety Guarantees

1. **Manual matches are sacred** — `match_confidence = 'manual'` entries are never cleared by rematch
2. **Verified entries survive** — `verified_at IS NOT NULL` entries are never cleared
3. **Manual CDN overrides survive** — `manually_overridden_fields @> ARRAY['clinic_day_number']` prevents automated CDN writes
4. **Two-layer CDN validation** — TS `validateCDNCandidates()` + SQL `set_clinic_day_number()` both must pass
5. **Collision protection** — `set_clinic_day_number()` refuses if CDN already claimed on same date
6. **Idempotent** — Running CDS twice produces the same result

---

## Common Patterns

### Multi-cat owners
One owner brings 5 cats → 5 ML entries, 5 appointments, same owner name. CDS resolves via:
1. CDN from waiver (each cat has its own waiver with OCR clinic number)
2. Cat name matching (composite Phase 7)
3. Weight disambiguation (Phase 8, with sex partitioning)
4. Constraint propagation (Phase 9, N-1 matched → assign Nth)

### Foster cats
ML says "Foster - Mama Peaches", CHQ says "Forgotten Felines Fosters". Owner names don't match. CDS handles via:
- Foster-aware scoring: zero `client_name`, double `cat_name` weight
- MIG_3103 foster exception: SQL guard checks cat name instead of owner
- CDN candidate validation: foster detection allows through when cat names match

### Cancelled surgeries
Cat was on the ML but surgery was cancelled (medical hold, no-show, owner withdrew). CDS:
1. Phase 2 detects cancellation via notes/headers
2. Sets `cancellation_reason` (excluded from unmatched count)
3. Phase 11 still links cancelled entries to their cats for data cohesion

### Different booker
ML says "Donal Machine" but CHQ says "Paul Emis" (different family member booked). CDS bridges via:
- Waiver chip → microchip → appointment (bypasses name entirely)
- `chip_direct` signal in composite scoring
- Cross-client scoring with higher threshold (0.35)
