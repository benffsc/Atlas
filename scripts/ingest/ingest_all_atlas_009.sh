#!/usr/bin/env bash
# ingest_all_atlas_009.sh
#
# Batch ingest script for ATLAS_009: runs all ingest scripts, then
# processes observations, identity resolution, and geocoding.
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/ingest/ingest_all_atlas_009.sh
#   ./scripts/ingest/ingest_all_atlas_009.sh --date 2026-01-09 --limit 100
#
# Options:
#   --date <date>     Date folder for files (default: 2026-01-09)
#   --limit <n>       Limit geocoding batch size (default: 100)
#   --skip-geocode    Skip geocoding step
#   --dry-run         Run ingests in dry-run mode

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Defaults
RUN_DATE="2026-01-09"
GEOCODE_LIMIT=100
SKIP_GEOCODE=false
DRY_RUN=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --date) RUN_DATE="$2"; shift 2 ;;
    --limit) GEOCODE_LIMIT="$2"; shift 2 ;;
    --skip-geocode) SKIP_GEOCODE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

DRY_RUN_FLAG=""
if $DRY_RUN; then
  DRY_RUN_FLAG="--dry-run"
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_009 Batch Ingest${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo ""
echo -e "${CYAN}Date:${RESET} $RUN_DATE"
echo -e "${CYAN}Geocode Limit:${RESET} $GEOCODE_LIMIT"
echo -e "${CYAN}Dry Run:${RESET} $DRY_RUN"
echo ""

# Check DATABASE_URL
if [[ -z "$DATABASE_URL" ]]; then
  echo -e "${RED}ERROR:${RESET} DATABASE_URL not set"
  echo "Run: set -a && source .env && set +a"
  exit 1
fi

WARNINGS=()
SUCCESSES=()

run_ingest() {
  local name="$1"
  local script="$2"
  echo -e "${CYAN}[$name]${RESET} Running..."
  if node "$script" --date "$RUN_DATE" $DRY_RUN_FLAG 2>&1; then
    SUCCESSES+=("$name")
  else
    local exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
      SUCCESSES+=("$name (skipped)")
    else
      WARNINGS+=("$name: exit code $exit_code")
    fi
  fi
}

# ============================================
# PHASE 1: Run All Ingest Scripts
# ============================================
echo -e "${BOLD}Phase 1: Running Ingest Scripts${RESET}"
echo "─────────────────────────────────────────────"

# Airtable
run_ingest "airtable/trapping_requests" "scripts/ingest/airtable_trapping_requests_csv.mjs"
run_ingest "airtable/appointment_requests" "scripts/ingest/airtable_appointment_requests_csv.mjs"
run_ingest "airtable/project75_survey" "scripts/ingest/airtable_project75_survey_csv.mjs"
run_ingest "airtable/trappers" "scripts/ingest/airtable_trappers_csv.mjs"

# ClinicHQ (note: these can be large - appointment_info uses batched ingest)
run_ingest "clinichq/cat_info" "scripts/ingest/clinichq_cat_info_xlsx.mjs"
run_ingest "clinichq/owner_info" "scripts/ingest/clinichq_owner_info_xlsx.mjs"
run_ingest "clinichq/appointment_info" "scripts/ingest/clinichq_appointment_info_xlsx.mjs"

# VolunteerHub
run_ingest "volunteerhub/users" "scripts/ingest/volunteerhub_users_xlsx.mjs"

# Shelterluv
run_ingest "shelterluv/animals" "scripts/ingest/shelterluv_animals_xlsx.mjs"
run_ingest "shelterluv/people" "scripts/ingest/shelterluv_people_xlsx.mjs"
run_ingest "shelterluv/outcomes" "scripts/ingest/shelterluv_outcomes_xlsx.mjs"

# PetLink
run_ingest "petlink/pets" "scripts/ingest/petlink_pets_xls.mjs"
run_ingest "petlink/owners" "scripts/ingest/petlink_owners_xls.mjs"

# E-Tapestry
run_ingest "etapestry/mailchimp" "scripts/ingest/etapestry_mailchimp_export_csv.mjs"

echo ""

# ============================================
# PHASE 2: Observations + Identity
# ============================================
if ! $DRY_RUN; then
  echo -e "${BOLD}Phase 2: Observations + Identity Resolution${RESET}"
  echo "─────────────────────────────────────────────"

  # Get list of source_tables with staged records
  TABLES=$(psql "$DATABASE_URL" -t -c "
    SELECT DISTINCT source_table
    FROM trapper.staged_records
    WHERE source_system IN ('airtable', 'airtable_project75', 'clinichq', 'volunteerhub', 'shelterluv', 'petlink', 'etapestry')
  " | tr -d '[:space:]' | tr '\n' ' ')

  for table in $TABLES; do
    if [[ -n "$table" ]]; then
      echo -e "${CYAN}Processing:${RESET} $table"

      # Populate observations
      psql "$DATABASE_URL" -q -c "SELECT trapper.populate_observations_for_latest_run('$table');" 2>/dev/null || true

      # Upsert people
      psql "$DATABASE_URL" -q -c "SELECT * FROM trapper.upsert_people_from_observations('$table');" 2>/dev/null || true

      # Populate aliases
      psql "$DATABASE_URL" -q -c "SELECT trapper.populate_aliases_from_name_signals('$table');" 2>/dev/null || true
    fi
  done

  # Update display names
  echo -e "${CYAN}Updating display names...${RESET}"
  psql "$DATABASE_URL" -q -c "SELECT trapper.update_all_person_display_names();" 2>/dev/null || true

  # Generate fuzzy candidates
  echo -e "${CYAN}Generating fuzzy candidates...${RESET}"
  psql "$DATABASE_URL" -q -c "SELECT trapper.generate_person_match_candidates(NULL, 500);" 2>/dev/null || true

  # Apply auto-merge
  echo -e "${CYAN}Applying very-confident auto-merges...${RESET}"
  psql "$DATABASE_URL" -c "SELECT * FROM trapper.apply_automerge_very_confident(100);" 2>/dev/null || true

  # Derive relationships
  echo -e "${CYAN}Deriving person-place relationships...${RESET}"
  for table in $TABLES; do
    if [[ -n "$table" ]]; then
      psql "$DATABASE_URL" -q -c "SELECT trapper.derive_person_place_relationships('$table');" 2>/dev/null || true
    fi
  done

  echo ""
fi

# ============================================
# PHASE 3: Geocoding (if not skipped)
# ============================================
if ! $DRY_RUN && ! $SKIP_GEOCODE; then
  echo -e "${BOLD}Phase 3: Address Pipeline + Geocoding${RESET}"
  echo "─────────────────────────────────────────────"

  # Show candidates
  echo -e "${CYAN}Address candidates:${RESET}"
  psql "$DATABASE_URL" -c "SELECT source_system, source_table, COUNT(*) FROM trapper.v_candidate_addresses_all_sources GROUP BY 1, 2 ORDER BY 3 DESC;"

  # Run geocoding (bounded)
  if [[ -n "$GOOGLE_PLACES_API_KEY" ]]; then
    echo -e "${CYAN}Running geocode batch (limit: $GEOCODE_LIMIT)...${RESET}"
    node scripts/normalize/geocode_candidates.mjs --limit "$GEOCODE_LIMIT" 2>&1 || true

    # Seed places
    echo -e "${CYAN}Seeding places from addresses...${RESET}"
    psql "$DATABASE_URL" -c "SELECT trapper.seed_places_from_addresses();" 2>/dev/null || true
  else
    echo -e "${YELLOW}WARN:${RESET} GOOGLE_PLACES_API_KEY not set, skipping geocoding"
    WARNINGS+=("Geocoding skipped: no API key")
  fi

  echo ""
fi

# ============================================
# SUMMARY
# ============================================
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Summary${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo ""

if ! $DRY_RUN; then
  echo -e "${CYAN}Staged records by source:${RESET}"
  psql "$DATABASE_URL" -c "
    SELECT source_system, source_table, COUNT(*) AS records
    FROM trapper.staged_records
    GROUP BY 1, 2
    ORDER BY 1, 2;
  "

  echo -e "${CYAN}People stats:${RESET}"
  psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_people_stats;"

  echo -e "${CYAN}Match candidates by status:${RESET}"
  psql "$DATABASE_URL" -c "SELECT status, COUNT(*) FROM trapper.person_match_candidates GROUP BY 1 ORDER BY 1;"

  echo -e "${CYAN}Places count:${RESET}"
  psql "$DATABASE_URL" -t -c "SELECT COUNT(*) AS places FROM trapper.places;"
fi

echo ""
echo -e "${GREEN}Successes:${RESET} ${#SUCCESSES[@]}"
for s in "${SUCCESSES[@]}"; do
  echo "  - $s"
done

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}Warnings:${RESET} ${#WARNINGS[@]}"
  for w in "${WARNINGS[@]}"; do
    echo "  - $w"
  done
fi

echo ""
echo -e "${BOLD}Batch ingest complete.${RESET}"
