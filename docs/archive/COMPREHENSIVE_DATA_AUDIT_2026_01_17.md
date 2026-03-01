# Comprehensive Data Audit Report

**Date**: 2026-01-17
**Triggered By**: Jean Worthey's place showing 97 cats caught but only 6 altered
**Scope**: Full codebase audit - ingestion pipelines, database schema, APIs, UI

---

## Executive Summary

A comprehensive audit revealed **multiple interconnected issues** causing data integrity problems:

| Issue | Severity | Affected Records | Root Cause |
|-------|----------|------------------|------------|
| Appointments missing owner_email | CRITICAL | 15,921 (33.6%) | CLI pipeline stages owner_info but never links |
| Cats without place links | CRITICAL | 101 | No person_id → no place link via person_place_relationships |
| UI pipeline missing cat-place links | HIGH | Unknown | Cat-place linking removed from ingest, requires cron job |
| merge_people() function missing | CRITICAL | N/A | Referenced but not implemented |
| SQL injection in cat update | CRITICAL | N/A | Template literals instead of parameterized queries |

---

## 1. ClinicHQ Pipeline Issues (CLI)

### The Bug in `clinic_full_pipeline.mjs`

The CLI pipeline has a critical gap:

```
1. ✅ Ingests cat_info.xlsx → creates cats
2. ✅ Ingests owner_info.xlsx → STAGES ONLY (never processes)
3. ✅ Ingests appointment_info.xlsx → creates appointments
4. ❌ NEVER joins owner_info to appointments
```

**Result**: `sot_appointments.owner_email`, `owner_phone`, and `person_id` are NULL

### Data Impact

| Metric | Count | % |
|--------|-------|---|
| Total appointments | 47,332 | 100% |
| Missing owner_email | **15,921** | **33.6%** |
| Missing person_id | 1,959 | 4.1% |
| Fixable from staged_records | **18,294** | 100%+ |

### Why Place Linking Fails

The place linking query relies on:
```sql
FROM trapper.sot_appointments a
JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
```

But `a.person_id` is NULL because owner info was never linked!

### January 2026 - Worst Affected Month

| Month | Total Appts | Missing Email | % Missing |
|-------|-------------|---------------|-----------|
| Jan 2026 | 277 | 173 | **62.5%** |
| Dec 2025 | 453 | 89 | 19.6% |
| Nov 2025 | 491 | 79 | 16.1% |

---

## 2. UI Ingestion Pipeline Issues

### Pipeline Architecture

**Upload**: `/api/ingest/upload/route.ts`
- Stores file in `file_uploads` table with content
- No processing happens here

**Processing**: `/api/ingest/process/[id]/route.ts`
- For `cat_info`: Creates cats, links appointments to cats, extracts weight
- For `owner_info`: Creates people, places, links person_id to appointments ✓
- For `appointment_info`: Creates appointments, procedures, vitals

### Critical Gap Discovered

**Cat-place linking was REMOVED from the ingest process** (MIG_305 fix):

```javascript
// NOTE: Cat-place auto-linking removed from ingest process (MIG_305 fix).
// The previous queries linked ALL cats to ALL of a person's places, which
// caused data corruption when a person had multiple place relationships.
//
// Use the cron endpoint /api/cron/entity-linking instead
```

### Impact on January 2026 Data

Even if you uploaded and processed all 3 files via the UI:
1. ✅ Cats were created
2. ✅ Appointments were created
3. ✅ People were linked to appointments (person_id populated)
4. ❌ **Cat-place relationships NOT created** (requires cron job)
5. ❌ **Request-cat links can't be created** (depends on cat-place links)

### The Missing Step

Cat-place linking requires running `/api/cron/entity-linking` which calls:
```sql
SELECT * FROM trapper.run_all_entity_linking()
```

If this cron hasn't run, cats won't be linked to places!

---

## 3. Database Schema Issues

### Missing/Inconsistent Functions

| Function | Status | Issue |
|----------|--------|-------|
| `canonical_person_id()` | MISSING | Referenced in MIG_251 but doesn't exist |
| `get_canonical_person_id()` | EXISTS | Name doesn't match references |
| `merge_people()` | INCOMPLETE | Referenced but implementation unclear |
| `link_cat_to_request()` | MISSING | Documented in CLAUDE.md but doesn't exist |

### Missing Foreign Key Cascades

- `person_place_relationships` - No ON DELETE CASCADE
- `cat_place_relationships` - No ON DELETE CASCADE
- Person identifiers can point to merged people

### Missing Indexes

- `person_identifiers(id_value_norm, id_type)` for email/phone matching
- `sot_requests(place_id, status, source_system)` for filtering

---

## 4. API Issues

### CRITICAL: SQL Injection Vulnerability

**File**: `/api/cats/[id]/route.ts` (lines 353-390)

The PATCH endpoint builds audit SQL with template literals:
```typescript
// VULNERABLE - builds SQL string with interpolation
auditInserts.push(`
  INSERT INTO trapper.cat_changes (...) VALUES ('${id}', ...)'
`);
await query(auditSql, []); // No parameters!
```

**Fix**: Use parameterized queries like the places endpoint.

### Missing Entity Function Usage

**File**: `/api/intake/public/route.ts`
- Writes directly to `intake_submissions` table
- Does NOT use `find_or_create_person()` or `find_or_create_place_deduped()`

---

## 5. Ingest Scripts Issues

### Scripts That Only Stage (Don't Process)

All 41 ingest scripts in `/scripts/ingest/` share these issues:

| Issue | Count |
|-------|-------|
| Scripts that create `request_cat_links` | **0** |
| Scripts that create `cat_vitals` | **0** |
| Scripts that call post-processing | **0** |

### Order-Dependent ClinicHQ Processing

Scripts must run in specific order:
1. `appointment_info.xlsx` → creates appointments
2. `owner_info.xlsx` → creates people, links to appointments
3. `cat_info.xlsx` → creates cats, links orphaned appointments

No enforcement or documentation of this requirement.

---

## 6. Data Recovery Plan

### Step 1: Backfill Owner Info (18,294 appointments)

```sql
UPDATE trapper.sot_appointments a
SET
  owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
  owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND a.owner_email IS NULL
  AND sr.payload->>'Owner Email' IS NOT NULL;
```

### Step 2: Create/Link Persons

```sql
UPDATE trapper.sot_appointments a
SET person_id = trapper.find_or_create_person(
  a.owner_email,
  a.owner_phone,
  sr.payload->>'Owner First Name',
  sr.payload->>'Owner Last Name',
  sr.payload->>'Owner Address',
  'clinichq'
)
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND a.person_id IS NULL
  AND a.owner_email IS NOT NULL;
```

### Step 3: Run Entity Linking Cron

```bash
# Call the entity linking endpoint to create cat-place relationships
curl -X POST http://localhost:3000/api/cron/entity-linking \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or trigger via Vercel dashboard if cron is configured.

### Step 4: Verify Jean Worthey's Cats

```sql
SELECT
  p.display_name,
  COUNT(DISTINCT cpr.cat_id) as linked_cats
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.place_id = '044df095-61cd-48e3-8a9f-d9718d00531e'
GROUP BY p.display_name;
-- Should show 105+ cats after fix
```

---

## 7. Prevention Plan

### Fix CLI Pipeline

Add to `clinic_full_pipeline.mjs` after owner_info ingest:

```sql
-- Link owner info to appointments
UPDATE trapper.sot_appointments a
SET
  owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
  owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')),
  person_id = trapper.find_or_create_person(...)
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number;
```

### Enable Entity Linking Cron

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/entity-linking",
    "schedule": "*/15 * * * *"
  }]
}
```

### Add Automated Checks

Create a health check endpoint that alerts when:
- Appointments missing owner_email > threshold
- Cats with procedures but no place link > 0
- Intake submissions not synced > threshold

---

## 8. Summary of Fixes Needed

### CRITICAL (Do Now)

| Fix | File | Impact |
|-----|------|--------|
| Backfill owner_email from staged_records | SQL migration | 15,921 appointments |
| Create/link persons for appointments | SQL migration | 1,959 appointments |
| Run entity-linking cron | Manual/Vercel | Unknown cat-place links |
| Fix SQL injection in cat update | `/api/cats/[id]/route.ts` | Security |

### HIGH (This Week)

| Fix | File | Impact |
|-----|------|--------|
| Add owner_info linking to CLI pipeline | `clinic_full_pipeline.mjs` | Future ingests |
| Create canonical_person_id alias | SQL migration | Function calls |
| Enable entity-linking cron on Vercel | `vercel.json` | Automated linking |

### MEDIUM (Soon)

| Fix | File | Impact |
|-----|------|--------|
| Document processing order for ClinicHQ | `scripts/ingest/` | Developer clarity |
| Add missing FK cascades | SQL migration | Data integrity |
| Implement merge_people() | SQL migration | Duplicate resolution |

---

## 9. Files Referenced

**Documentation**:
- `/docs/AUDIT_DATA_INTEGRITY_REPORT.md` - Detailed data audit
- `/docs/AUDIT_DATA_ATTRIBUTION_ISSUES.md` - Attribution system analysis
- `/docs/AUDIT_PLACE_CONSOLIDATION_ISSUE.md` - Place merge issues

**Pipelines**:
- `/scripts/ingest/clinic_full_pipeline.mjs` - CLI pipeline (has bug)
- `/apps/web/src/app/api/ingest/upload/route.ts` - UI upload
- `/apps/web/src/app/api/ingest/process/[id]/route.ts` - UI processing
- `/apps/web/src/app/api/cron/entity-linking/route.ts` - Cat-place linking

**Migrations Applied**:
- `MIG_311__fix_place_alteration_history.sql` - Fixed yearly breakdown

**Good News**: 100% of affected data is recoverable from `staged_records`.

---

## 10. Unified Processing Pipeline (Implemented)

A centralized processing architecture was implemented to prevent these issues from recurring:

### New Migrations

- `MIG_312__unified_processing_pipeline.sql` - Job queue and orchestrator
- `MIG_313__clinichq_sql_processors.sql` - SQL-based processors

### Key Components

1. **`processing_jobs` table** - Centralized job queue
2. **`enqueue_processing()`** - Queue jobs for processing
3. **`process_next_job()`** - Main orchestrator (called by cron)
4. **`process_clinichq_owner_info()`** - CRITICAL: Backfills owner_email and links person_id
5. **`run_all_entity_linking()`** - Enhanced to run after every batch

### New Endpoints

- `POST /api/ingest/process` - Unified processor (cron every 10 min)
- `GET /api/health/processing` - Monitoring dashboard

### How to Run the Backfill

After applying MIG_312 and MIG_313:

```sql
-- Queue backfill jobs (high priority 10)
SELECT trapper.enqueue_processing('clinichq', 'owner_info', 'backfill', NULL, 10);
SELECT trapper.enqueue_processing('clinichq', 'cat_info', 'backfill', NULL, 10);
SELECT trapper.enqueue_processing('clinichq', 'appointment_info', 'backfill', NULL, 10);

-- Process jobs (run repeatedly until no_jobs)
SELECT * FROM trapper.process_next_job();

-- Or trigger via cron endpoint
curl -X POST https://your-app.vercel.app/api/ingest/process \
  -H "Authorization: Bearer $CRON_SECRET"

-- Check status
SELECT * FROM trapper.v_processing_dashboard;
```

### Verification

```sql
-- Check Jean Worthey's cats are now linked
SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE p.place_id = '044df095-61cd-48e3-8a9f-d9718d00531e';
-- Should be 105+ after backfill

-- Check appointment owner_email is populated
SELECT COUNT(*) FROM trapper.sot_appointments WHERE owner_email IS NULL;
-- Should be < 1000 after backfill

-- Check cats are linked to places
SELECT COUNT(DISTINCT cp.cat_id)
FROM trapper.cat_procedures cp
WHERE (cp.is_spay OR cp.is_neuter)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = cp.cat_id);
-- Should be 0 after backfill
```
