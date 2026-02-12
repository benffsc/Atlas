# V2 Migration Cleanup Checklist

**Purpose:** Track all cleanup tasks to keep the repo at optimal size during and after V2 migration.

---

## Pre-Migration Cleanup (Do Before Phase 1)

### Immediate Actions (< 1 hour)

- [ ] **Delete build artifacts** (~920 MB)
  ```bash
  rm -rf apps/web/.next
  ```

- [ ] **Delete node_modules** (~407 MB) - will regenerate
  ```bash
  rm -rf node_modules apps/web/node_modules
  npm install
  ```

- [ ] **Update .gitignore** - add these if missing:
  ```
  .env
  .env.local
  .DS_Store
  .vercel/
  ```

- [ ] **Delete .DS_Store files**
  ```bash
  find . -name ".DS_Store" -delete
  ```

- [ ] **Verify .env.example is complete** (no real secrets)

---

## Archive Structure

Create this structure for historical files:

```
/archive/
├── docs/                    # Historical documentation
├── scripts/
│   ├── acceptance_tests/   # Old test scripts
│   ├── ingest_legacy/      # One-off ingest scripts
│   └── jobs_experimental/  # One-off job scripts
├── examples/               # Old code examples
└── README.md               # Archive index
```

---

## Files to Archive (Not Delete)

### Documentation → `/archive/docs/`

| File | Size | Reason |
|------|------|--------|
| `TASK_LEDGER.md` | 272 KB | Old task tracking, superseded |
| `TODO.md` | 88 KB | Legacy TODO list |
| `ATLAS_REPO_MAP.md` | - | Outdated table list |
| `DECISIONS.md` | 4 KB | Early decisions |
| `TECHNICAL_METHODOLOGY.md` | - | Old methodology |
| `TECHNICAL_DEDUPLICATION.md` | - | Old methodology |
| `TECHNICAL_NEARBY_COMPUTATION.md` | - | Old methodology |
| `ARCHITECTURE_DIAGRAMS.md` | 67 KB | Pre-V2 architecture |
| `INTEGRATION_PLAN.md` | 16 KB | Pre-V2 planning |
| `DATA_ENGINE_AUDIT_REPORT.md` | 8 KB | Dated audit |
| `DATA_QUALITY_ANALYSIS.md` | 7 KB | Dated analysis |
| `COMPREHENSIVE_DATA_AUDIT_2026_01_17.md` | 12 KB | Dated audit |
| `data-flow-rules.md` | - | Superseded by DATA_FLOW_ARCHITECTURE.md |

### Scripts → `/archive/scripts/acceptance_tests/`

```
scripts/acceptance_test_atlas_005.sh
scripts/acceptance_test_atlas_007.sh
scripts/acceptance_test_atlas_008.sh
scripts/acceptance_test_atlas_009.sh
scripts/acceptance_test_atlas_010.sh
scripts/acceptance_test_atlas_011.sh
scripts/acceptance_test_atlas_012.sh
scripts/acceptance_test_atlas_013.sh
scripts/acceptance_test_atlas_014.sh
scripts/acceptance_test_atlas_015.sh
scripts/acceptance_test_atlas_016.sh
scripts/acceptance_test_atlas_017.sh
scripts/acceptance_test_atlas_018.sh
scripts/acceptance_test_atlas_019.sh
scripts/acceptance_test_atlas_020.sh
scripts/acceptance_test_atlas_021.sh
```

### Scripts → `/archive/scripts/ingest_legacy/`

```
scripts/ingest/legacy_intake_submissions.mjs
scripts/ingest/mymaps_kml_import.mjs
scripts/ingest/master_list_import.mjs
scripts/ingest/explore_airtable_clients.mjs
scripts/ingest/analyze_airtable_places.mjs
```

### Scripts → `/archive/scripts/jobs_experimental/`

```
scripts/jobs/classify_google_map_entries.mjs
scripts/jobs/paraphrase_google_map_entries.mjs
scripts/jobs/detect_classification_clusters.mjs
scripts/jobs/seed_attributes_from_google_maps.mjs
scripts/jobs/seed_historical_conditions.mjs
scripts/jobs/research_clinic_accounts.mjs
```

---

## Documentation to UPDATE (Not Archive)

These must be updated to reflect V2 schemas during migration:

| File | Updates Needed |
|------|----------------|
| `CLAUDE.md` | Schema references (`trapper.*` → `atlas.*`, `ops.*`, `sot.*`) |
| `CENTRALIZED_FUNCTIONS.md` | Function locations to new schemas |
| `INGEST_GUIDELINES.md` | Source system table locations |
| `CLAUDE_REFERENCE.md` | Multi-source data transparency |
| `ATLAS_ENGINEERING_GUIDE.md` | Technical patterns |
| `ATLAS_OPERATOR_GUIDE.md` | Operational patterns |

---

## Code Patterns to Refactor (Not Delete)

### Schema References (2,300+ occurrences)

| Pattern | Count | New Pattern |
|---------|-------|-------------|
| `trapper.sot_people` | 100+ | `sot.people` |
| `trapper.sot_cats` | 100+ | `sot.cats` |
| `trapper.places` | 100+ | `sot.places` |
| `trapper.sot_requests` | 50+ | `ops.requests` |
| `trapper.find_or_create_*` | 100+ | `atlas.find_or_create_*` |
| `trapper.link_*` | 50+ | `atlas.link_*` |
| `trapper.data_engine_*` | 50+ | `atlas.data_engine_*` |

### Hard-coded Paths to Fix

```javascript
// OLD
/Users/benmisdiaz/Desktop/AI_Ingest
/Users/benmisdiaz/Projects/Atlas

// NEW
process.env.INGEST_PATH
process.env.PROJECT_ROOT
```

---

## Post-Migration Cleanup (After Week 10)

### After V2 Stable

- [ ] Hardcode `SCHEMA_VERSION=v2` (remove feature flag)
- [ ] Remove dual-write triggers
- [ ] Archive `trapper.*` tables → `archive.*` schema
- [ ] Backup `archive.*` schema externally
- [ ] DROP `archive.*` schema from database
- [ ] Remove V1 code paths (dead code elimination)
- [ ] Simplify `schemas.ts` to only have V2

### Database Cleanup

```sql
-- After V2 is stable and backed up
DROP SCHEMA IF EXISTS trapper CASCADE;  -- Only after external backup!
DROP SCHEMA IF EXISTS archive CASCADE;  -- Only after external backup!
```

---

## Size Tracking

| Stage | Estimated Size | Notes |
|-------|---------------|-------|
| Current | ~1.3 GB | Includes build artifacts |
| After Pre-Migration | ~50 MB | Source code only |
| After V2 + Cleanup | ~40 MB | Optimized |

---

## Verification Commands

```bash
# Check repo size
du -sh .

# Check for .DS_Store files
find . -name ".DS_Store"

# Check for secrets in tracked files
git ls-files | xargs grep -l "DATABASE_URL\|SUPABASE_KEY" 2>/dev/null

# List largest files
find . -type f -exec du -h {} + | sort -rh | head -20

# Verify .gitignore working
git status --ignored
```

---

## Archive Index Template

Create `/archive/README.md`:

```markdown
# Archive Index

Files moved here during V2 migration (2026-02-11).

## Why Archived?
These files are historical and no longer actively used. They're preserved
for reference but shouldn't be modified.

## Contents
- `docs/` - Historical documentation superseded by V2 docs
- `scripts/acceptance_tests/` - One-off validation scripts
- `scripts/ingest_legacy/` - One-off ingest scripts
- `scripts/jobs_experimental/` - Experimental job scripts
- `examples/` - Old code examples

## To Restore
If you need to restore any file:
```bash
git mv archive/path/to/file original/path/to/file
```

## V2 Migration Date
2026-02-11
```
