# AI Extraction System Guide

## Overview

Atlas uses Claude AI to extract structured attributes from unstructured text (medical notes, request descriptions, intake situations). This document explains how the system works and why some records may not be extracted.

## Cost Reality Check

**Actual measured costs (Jan 2026):**
- Haiku 4.5: ~$0.0006/record (without priority filter)
- With Sonnet escalation (8%): ~$0.0008/record
- With priority-only filter (47% Sonnet): ~$0.002/record

**Previous estimates were wrong:**
- Scripts estimated $0.0005/record
- Actual dashboard showed ~$0.004/record average
- Difference: Output tokens cost 5x more than input, and prompts include full attribute definitions

## Why Records Might Not Be Extracted

### 1. Already Processed
The scripts check `entity_attributes` table to skip already-processed records:
```sql
AND NOT EXISTS (
  SELECT 1 FROM trapper.entity_attributes ea
  WHERE ea.source_system = 'clinichq'
    AND ea.source_record_id = appointment_id::TEXT
)
```

### 2. No Notes Content
Records with empty or very short notes are skipped:
```javascript
if (!combinedNotes || combinedNotes.length < 20) continue;
```

### 3. Priority Filtering (when --priority-only flag used)
Only records matching these keywords are processed:
- `recapture`, `recheck`, `return`, `eartip`, `already tipped`
- `pregnant`, `lactating`, `litter`, `kitten`
- `unfixed`, `intact`, `trap shy`

### 4. Batch Limits
Scripts have batch limits (default 100) to control costs. Run multiple times to process all records.

### 5. API Errors
If Claude API returns an error, the record is skipped and logged but processing continues.

## Extraction Scripts

| Script | Source Table | Entity Types | Notes |
|--------|--------------|--------------|-------|
| `extract_clinic_attributes.mjs` | sot_appointments | cat, place | Medical notes from clinic |
| `extract_request_attributes.mjs` | sot_requests | request, place, person | Internal/public notes |
| `extract_intake_attributes.mjs` | web_intake_submissions | place, request, person | Situation descriptions |
| `extract_observation_attributes.mjs` | site_observations | place | Field observations |

## Running Extractions

### One-time batch
```bash
# Process 100 clinic appointments
node scripts/jobs/extract_clinic_attributes.mjs --limit 100

# Process only priority records (recapture, eartip, etc.)
node scripts/jobs/extract_clinic_attributes.mjs --limit 500 --priority-only

# Dry run (no API calls)
node scripts/jobs/extract_clinic_attributes.mjs --limit 100 --dry-run
```

### Overnight batch (all records)
```bash
./scripts/run_overnight_extraction.sh > /tmp/overnight.log 2>&1 &
tail -f /tmp/overnight.log  # Monitor progress
```

### Cron (incremental)
The `/api/cron/ai-extract` endpoint processes 50 records daily at 4 AM PT from the extraction queue.

## Tracking Extraction Status

### Check what's been processed
```sql
-- By source system
SELECT source_system, COUNT(*)
FROM trapper.entity_attributes
WHERE superseded_at IS NULL
GROUP BY source_system;

-- Unprocessed clinic appointments
SELECT COUNT(*) FROM trapper.sot_appointments a
WHERE a.medical_notes IS NOT NULL AND a.medical_notes != ''
  AND NOT EXISTS (
    SELECT 1 FROM trapper.entity_attributes ea
    WHERE ea.source_system = 'clinichq'
      AND ea.source_record_id = a.appointment_id::TEXT
  );
```

### Check extraction jobs
```sql
SELECT * FROM trapper.attribute_extraction_jobs
ORDER BY started_at DESC LIMIT 10;
```

### Check extraction queue (for cron)
```sql
SELECT source_table, COUNT(*)
FROM trapper.extraction_queue
WHERE completed_at IS NULL
GROUP BY source_table;
```

## Troubleshooting

### "No records to process" but I expect more
1. Check if already processed: Records in `entity_attributes` are skipped
2. Check notes length: Records with <20 char notes are skipped
3. Check priority filter: `--priority-only` only processes keyword matches

### Extractions not appearing in views
1. Check `superseded_at` - old extractions may have been replaced
2. Check `confidence` - views may filter by confidence >= 0.6
3. Check JSONB casting - the view uses `attribute_value #>> '{}'` not direct cast

### Costs higher than expected
1. Sonnet escalation: Complex patterns trigger more expensive model
2. Output tokens: 5x more expensive than input
3. Prompt size: Each record includes all attribute definitions (~2k tokens)

## Current State (Jan 2026)

| Source | Total Records | Extracted | Unprocessed |
|--------|---------------|-----------|-------------|
| Clinic appointments | 10,869 | 6,036 | 4,833 |
| Requests | ~2,500 | ~2,200 | ~300 |
| Web intakes | ~440 | ~438 | ~2 |
| Google Maps | 5,624 | 5,624 | 0 |

**Total entity_attributes:** 17,279 active (11,332 from clinichq, 3,023 from requests, 1,522 from intakes, 1,402 from Google Maps)
