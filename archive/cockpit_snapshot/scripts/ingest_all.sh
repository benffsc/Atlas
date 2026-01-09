#!/usr/bin/env bash
set -euo pipefail

# ingest_all.sh
# Runs all data ingestion scripts for files in data/incoming/
# Usage: bash scripts/ingest_all.sh [--dry-run] [--verbose]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse arguments
DRY_RUN=""
VERBOSE=""
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN="--dry-run"
            ;;
        --verbose)
            VERBOSE="--verbose"
            ;;
    esac
done

# Load .env
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
else
    echo "ERROR: .env file not found at $REPO_ROOT/.env"
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL not set in .env"
    exit 1
fi

# Find Python: prefer .venv/bin/python, then python3, then python
PYTHON=""
if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    PYTHON="$REPO_ROOT/.venv/bin/python"
elif command -v python3 &> /dev/null; then
    PYTHON="python3"
elif command -v python &> /dev/null; then
    PYTHON="python"
else
    echo "ERROR: No python found. Install python3 or create .venv."
    exit 1
fi

# Counters
TOTAL_FILES=0
TOTAL_SUCCESS=0
TOTAL_FAILED=0

echo "========================================"
echo "  FFSCTrapperApp Data Ingestion Runner"
echo "========================================"
if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN MODE - no database writes]"
fi
echo ""

# --- Airtable Appointment Requests (CSV) ---
APPT_REQ_DIR="$REPO_ROOT/data/incoming/airtable/appointment_requests"
echo "=== Airtable Appointment Requests ==="
echo "Directory: $APPT_REQ_DIR"

if [[ -d "$APPT_REQ_DIR" ]]; then
    shopt -s nullglob
    csv_files=("$APPT_REQ_DIR"/*.csv)
    shopt -u nullglob

    if [[ ${#csv_files[@]} -eq 0 ]]; then
        echo "  No CSV files found"
    else
        for csv_file in "${csv_files[@]}"; do
            TOTAL_FILES=$((TOTAL_FILES + 1))
            echo ""
            echo "  Processing: $(basename "$csv_file")"
            if "$PYTHON" "$REPO_ROOT/ingest_airtable_appointment_requests.py" \
                --file "$csv_file" \
                --schema trapper \
                $DRY_RUN $VERBOSE; then
                TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
            else
                echo "  ERROR: Failed to ingest $csv_file"
                TOTAL_FAILED=$((TOTAL_FAILED + 1))
            fi
        done
    fi
else
    echo "  Directory not found"
fi

echo ""

# --- Airtable Trapping Requests (CSV) - existing importer ---
TRAP_REQ_DIR="$REPO_ROOT/data/incoming/airtable/trapping_requests"
echo "=== Airtable Trapping Requests ==="
echo "Directory: $TRAP_REQ_DIR"

if [[ -d "$TRAP_REQ_DIR" ]]; then
    shopt -s nullglob
    csv_files=("$TRAP_REQ_DIR"/*.csv)
    shopt -u nullglob

    if [[ ${#csv_files[@]} -eq 0 ]]; then
        echo "  No CSV files found"
    else
        for csv_file in "${csv_files[@]}"; do
            TOTAL_FILES=$((TOTAL_FILES + 1))
            echo ""
            echo "  Processing: $(basename "$csv_file")"
            # Note: existing importer doesn't have --dry-run, so skip in dry-run mode
            if [[ -n "$DRY_RUN" ]]; then
                echo "  [DRY RUN] Would run: $PYTHON ingest_airtable_trapping_requests.py --csv $csv_file"
                TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
            else
                if "$PYTHON" "$REPO_ROOT/ingest_airtable_trapping_requests.py" \
                    --csv "$csv_file" \
                    --schema trapper; then
                    TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
                else
                    echo "  ERROR: Failed to ingest $csv_file"
                    TOTAL_FAILED=$((TOTAL_FAILED + 1))
                fi
            fi
        done
    fi
else
    echo "  Directory not found"
fi

echo ""

# --- ClinicHQ Upcoming Appointments (XLSX) ---
CLINICHQ_DIR="$REPO_ROOT/data/incoming/clinichq/upcoming"
echo "=== ClinicHQ Upcoming Appointments ==="
echo "Directory: $CLINICHQ_DIR"

if [[ -d "$CLINICHQ_DIR" ]]; then
    shopt -s nullglob
    xlsx_files=("$CLINICHQ_DIR"/*.xlsx)
    shopt -u nullglob

    if [[ ${#xlsx_files[@]} -eq 0 ]]; then
        echo "  No XLSX files found"
    else
        for xlsx_file in "${xlsx_files[@]}"; do
            TOTAL_FILES=$((TOTAL_FILES + 1))
            echo ""
            echo "  Processing: $(basename "$xlsx_file")"
            if "$PYTHON" "$REPO_ROOT/ingest_clinichq_upcoming_appointments.py" \
                --file "$xlsx_file" \
                --schema trapper \
                $DRY_RUN $VERBOSE; then
                TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
            else
                echo "  ERROR: Failed to ingest $xlsx_file"
                TOTAL_FAILED=$((TOTAL_FAILED + 1))
            fi
        done
    fi
else
    echo "  Directory not found"
fi

echo ""

# --- ClinicHQ Historical (XLSX, optional) ---
# Primary location: data/clinichq/historical/
# Alt location: data/raw/clinichq/appointments/legacy_reports/8af_82e_b38/
HIST_DIR1="$REPO_ROOT/data/clinichq/historical"
HIST_DIR2="$REPO_ROOT/data/raw/clinichq/appointments/legacy_reports/8af_82e_b38"
echo "=== ClinicHQ Historical (Optional) ==="
echo "Checking: $HIST_DIR1"
echo "      or: $HIST_DIR2"

HIST_FILE_FOUND=false
# Check for at least one historical file in either location
for hist_dir in "$HIST_DIR1" "$HIST_DIR2"; do
    if [[ -f "$hist_dir/report_8af__appts.xlsx" ]] || \
       [[ -f "$hist_dir/report_82e__cats.xlsx" ]] || \
       [[ -f "$hist_dir/report_b38__owners.xlsx" ]]; then
        HIST_FILE_FOUND=true
        break
    fi
done

if [[ "$HIST_FILE_FOUND" = true ]]; then
    TOTAL_FILES=$((TOTAL_FILES + 1))
    echo ""
    echo "  Historical files found, running ingest..."
    if [[ -n "$DRY_RUN" ]]; then
        if "$PYTHON" "$REPO_ROOT/ingest_clinichq_historical.py" --all --dry-run $VERBOSE; then
            TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
        else
            echo "  WARNING: Historical ingest dry-run had issues"
            TOTAL_FAILED=$((TOTAL_FAILED + 1))
        fi
    else
        if "$PYTHON" "$REPO_ROOT/ingest_clinichq_historical.py" --all $VERBOSE; then
            TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
        else
            echo "  WARNING: Historical ingest had issues (may be missing files)"
            TOTAL_FAILED=$((TOTAL_FAILED + 1))
        fi
    fi
else
    echo "  No historical files found (skipping)"
    echo "  To enable: place XLSX files in data/clinichq/historical/"
fi

echo ""

# --- Run SQL Checks ---
echo "=== Running SQL Checks ==="
if [[ -n "$DRY_RUN" ]]; then
    echo "[DRY RUN] Skipping SQL checks"
else
    bash "$REPO_ROOT/scripts/run_checks.sh" || true
fi

echo ""
echo "========================================"
echo "  Ingestion Summary"
echo "========================================"
echo "  Total files:     $TOTAL_FILES"
echo "  Successful:      $TOTAL_SUCCESS"
echo "  Failed:          $TOTAL_FAILED"
if [[ -n "$DRY_RUN" ]]; then
    echo "  [DRY RUN - no changes made]"
fi
echo "========================================"
