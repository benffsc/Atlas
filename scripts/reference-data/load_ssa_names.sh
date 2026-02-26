#!/bin/bash
# =============================================================================
# load_ssa_names.sh — Load SSA Baby Names into ref.first_names
# =============================================================================
#
# Source: https://www.ssa.gov/oact/babynames/names.zip
# Data location: /Users/benmisdiaz/Downloads/names/
# Format: name,sex,count per year (yobYYYY.txt files)
#
# Usage:
#   ./scripts/reference-data/load_ssa_names.sh
#
# Prerequisites:
#   1. Download names.zip from SSA and extract to /Users/benmisdiaz/Downloads/names/
#   2. MIG_2371__ssa_first_names_table.sql applied (creates ref.first_names)
#
# =============================================================================

set -e

DATA_DIR="/Users/benmisdiaz/Downloads/names"
DB_URL="${DATABASE_URL:-postgres://localhost:5432/atlas}"

# Check if data exists
if [ ! -d "$DATA_DIR" ]; then
    echo "ERROR: SSA names directory not found at $DATA_DIR"
    echo "Download from: https://www.ssa.gov/oact/babynames/names.zip"
    exit 1
fi

# Count year files
YEAR_FILES=$(ls "$DATA_DIR"/yob*.txt 2>/dev/null | wc -l)
if [ "$YEAR_FILES" -eq 0 ]; then
    echo "ERROR: No yobYYYY.txt files found in $DATA_DIR"
    exit 1
fi

echo "=== Loading SSA Baby Names ==="
echo "Found $YEAR_FILES year files"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Step 1: Combine all year files into single CSV with year column
echo "Step 1: Combining all year files..."
for f in "$DATA_DIR"/yob*.txt; do
    year=$(basename "$f" | sed 's/yob\([0-9]*\).txt/\1/')
    awk -v year="$year" -F, '{print $1","$2","year","$3}' "$f"
done > "$TEMP_DIR/all_names.csv"

TOTAL_ROWS=$(wc -l < "$TEMP_DIR/all_names.csv")
echo "  Combined $TOTAL_ROWS name-year combinations"

# Step 2: Load using psql with COPY
echo ""
echo "Step 2: Loading into database..."

psql "$DB_URL" << EOSQL
-- Ensure ref schema exists
CREATE SCHEMA IF NOT EXISTS ref;

-- Clear existing data for fresh load
TRUNCATE ref.ssa_names_by_year;

-- Create temp table for COPY
CREATE TEMP TABLE ssa_load (
    name TEXT,
    sex CHAR(1),
    year INT,
    count INT
);

\copy ssa_load FROM '$TEMP_DIR/all_names.csv' CSV

-- Load into permanent table
INSERT INTO ref.ssa_names_by_year (name, sex, year, count)
SELECT name, sex, year, count FROM ssa_load
ON CONFLICT (name, sex, year) DO UPDATE SET count = EXCLUDED.count;

DROP TABLE ssa_load;

-- Aggregate into ref.first_names
TRUNCATE ref.first_names;

INSERT INTO ref.first_names (
    name,
    total_count,
    peak_year,
    peak_count,
    first_year,
    last_year,
    male_count,
    female_count,
    is_primarily_male,
    is_primarily_female,
    is_unisex
)
SELECT
    name,
    SUM(count) as total_count,
    (SELECT year FROM ref.ssa_names_by_year y2
     WHERE y2.name = y.name
     ORDER BY count DESC LIMIT 1) as peak_year,
    MAX(count) as peak_count,
    MIN(year) as first_year,
    MAX(year) as last_year,
    SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END) as male_count,
    SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END) as female_count,
    SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::float /
        NULLIF(SUM(count), 0) > 0.7 as is_primarily_male,
    SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END)::float /
        NULLIF(SUM(count), 0) > 0.7 as is_primarily_female,
    ABS(SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::float /
        NULLIF(SUM(count), 0) - 0.5) < 0.2 as is_unisex
FROM ref.ssa_names_by_year y
GROUP BY name;

-- Verify
SELECT
    'ref.first_names' as table_name,
    COUNT(*) as total_names,
    COUNT(*) FILTER (WHERE total_count >= 1000) as common_names_1k_plus,
    COUNT(*) FILTER (WHERE total_count >= 10000) as very_common_10k_plus
FROM ref.first_names;
EOSQL

echo ""
echo "=== SSA Names Load Complete ==="
