#!/bin/bash
# Overnight Extraction Runner
# Run this to complete all pending extractions
# Estimated: ~$3 total, ~4.5 hours to complete
#
# Usage: ./scripts/run_overnight_extraction.sh > /tmp/overnight_extraction.log 2>&1 &

cd "$(dirname "$0")/.."

echo "============================================================"
echo "OVERNIGHT EXTRACTION - Started $(date)"
echo "============================================================"
echo ""

# Source environment - handle .env parsing errors gracefully
export $(grep -E '^[A-Z_]+=' .env 2>/dev/null | xargs) 2>/dev/null || true

echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo 'yes' || echo 'no')"
echo "ANTHROPIC_API_KEY set: $([ -n "$ANTHROPIC_API_KEY" ] && echo 'yes' || echo 'no')"
echo ""

TOTAL_COST=0
TOTAL_RECORDS=0
BATCH_NUM=0

# Run clinic extractions until done (max 50 batches)
echo "=== CLINIC APPOINTMENT EXTRACTION ==="
while [ $BATCH_NUM -lt 50 ]; do
    BATCH_NUM=$((BATCH_NUM + 1))
    echo ""
    echo "--- Clinic Batch $BATCH_NUM at $(date) ---"

    # Smart mode: Haiku 3 for routine, auto-escalate to Sonnet for critical patterns
    OUTPUT=$(node scripts/jobs/extract_clinic_attributes.mjs --limit 100 --budget 2>&1)

    # Extract metrics from output
    RECORDS=$(echo "$OUTPUT" | grep "Records Processed:" | grep -oE '[0-9]+' | head -1 || echo "0")
    COST=$(echo "$OUTPUT" | grep "Estimated Cost:" | grep -oE '[0-9]+\.[0-9]+' || echo "0")

    echo "Processed: $RECORDS | Cost: \$$COST"

    # If no records processed, we're done
    if [ "$RECORDS" = "0" ] || [ -z "$RECORDS" ]; then
        echo "No more clinic records to process!"
        break
    fi

    TOTAL_RECORDS=$((TOTAL_RECORDS + RECORDS))
    TOTAL_COST=$(echo "$TOTAL_COST + $COST" | bc)

    # Safety: stop if cost exceeds $5
    if (( $(echo "$TOTAL_COST > 5" | bc -l) )); then
        echo "WARNING: Cost limit reached (\$$TOTAL_COST). Stopping for safety."
        break
    fi

    sleep 2
done

echo ""
echo "=== REQUEST EXTRACTION ==="
BATCH_NUM=0
while [ $BATCH_NUM -lt 10 ]; do
    BATCH_NUM=$((BATCH_NUM + 1))
    echo ""
    echo "--- Request Batch $BATCH_NUM at $(date) ---"

    OUTPUT=$(node scripts/jobs/extract_request_attributes.mjs --limit 50 2>&1)

    RECORDS=$(echo "$OUTPUT" | grep "Records processed:" | grep -oE '[0-9]+' | head -1 || echo "0")
    COST=$(echo "$OUTPUT" | grep "Estimated cost:" | grep -oE '[0-9]+\.[0-9]+' || echo "0")

    echo "Processed: $RECORDS | Cost: \$$COST"

    if [ "$RECORDS" = "0" ] || [ -z "$RECORDS" ]; then
        echo "No more request records to process!"
        break
    fi

    TOTAL_RECORDS=$((TOTAL_RECORDS + RECORDS))
    TOTAL_COST=$(echo "$TOTAL_COST + $COST" | bc)

    sleep 2
done

echo ""
echo "============================================================"
echo "OVERNIGHT EXTRACTION - Completed $(date)"
echo "============================================================"
echo "Total Records Processed: $TOTAL_RECORDS"
echo "Total Estimated Cost: \$$TOTAL_COST"
echo ""

# Log final state to database
psql "$DATABASE_URL" -c "
INSERT INTO trapper.attribute_extraction_jobs (
    source_system, entity_type, records_processed,
    attributes_extracted, cost_estimate_usd, model_used, notes
) VALUES (
    'overnight_batch', 'mixed', $TOTAL_RECORDS, 0, $TOTAL_COST,
    'claude-haiku-4-5-20251001', 'Overnight extraction run completed'
);
" 2>/dev/null || true

echo "Done!"
