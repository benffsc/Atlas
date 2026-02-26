#!/bin/bash
# =============================================================================
# load_census_surnames.sh
# =============================================================================
# Downloads and loads US Census Bureau 2010 surnames into PostgreSQL
#
# Source: https://www2.census.gov/topics/genealogy/2010surnames/names.zip
# Records: 162,253 surnames
# License: CC0 (Public Domain)
#
# Prerequisites:
#   - MIG_2370 applied (creates ref.census_surnames table)
#   - DATABASE_URL environment variable set
#
# Usage:
#   ./scripts/reference-data/load_census_surnames.sh
# =============================================================================

set -e

# Configuration
DATA_DIR="${DATA_DIR:-data/reference}"
CENSUS_URL="https://www2.census.gov/topics/genealogy/2010surnames/names.zip"

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    # Try to load from .env file
    if [ -f ".env" ]; then
        export $(grep -E "^DATABASE_URL=" .env | xargs)
    fi
    if [ -z "$DATABASE_URL" ]; then
        echo "ERROR: DATABASE_URL not set. Set it or add to .env file."
        exit 1
    fi
fi

echo "=== Loading US Census 2010 Surnames ==="
echo "Data directory: $DATA_DIR"

# Create data directory
mkdir -p "$DATA_DIR"

# Download if not already present
if [ ! -f "$DATA_DIR/Names_2010Census.csv" ]; then
    echo "Downloading Census surnames from $CENSUS_URL..."
    curl -L -o "$DATA_DIR/names.zip" "$CENSUS_URL"

    echo "Extracting..."
    unzip -o "$DATA_DIR/names.zip" -d "$DATA_DIR"

    # The ZIP contains Names_2010Census.csv
    if [ ! -f "$DATA_DIR/Names_2010Census.csv" ]; then
        # Try alternate filename
        if [ -f "$DATA_DIR/app_c.csv" ]; then
            mv "$DATA_DIR/app_c.csv" "$DATA_DIR/Names_2010Census.csv"
        else
            echo "ERROR: Could not find Census surnames CSV file"
            ls -la "$DATA_DIR"
            exit 1
        fi
    fi

    rm -f "$DATA_DIR/names.zip"
else
    echo "Census data already downloaded."
fi

# Count lines
TOTAL_LINES=$(wc -l < "$DATA_DIR/Names_2010Census.csv" | tr -d ' ')
echo "CSV has $TOTAL_LINES lines (including header)"

# Load into database
echo "Loading into ref.census_surnames..."
psql "$DATABASE_URL" << 'EOF'
-- Create temp table for loading
CREATE TEMP TABLE tmp_census_load (
    name TEXT,
    rank TEXT,
    count TEXT,
    prop100k TEXT,
    cum_prop100k TEXT,
    pctwhite TEXT,
    pctblack TEXT,
    pctapi TEXT,
    pctaian TEXT,
    pct2prace TEXT,
    pcthispanic TEXT
);

-- Use relative path from where psql is run
\copy tmp_census_load FROM 'data/reference/Names_2010Census.csv' WITH (FORMAT csv, HEADER true);

-- Insert into target table with type conversion
-- Handle "(S)" suppressed values by converting to NULL
INSERT INTO ref.census_surnames (
    name, rank, count, prop100k, cum_prop100k,
    pct_white, pct_black, pct_api, pct_aian, pct_2prace, pct_hispanic
)
SELECT
    UPPER(TRIM(name)),
    NULLIF(TRIM(rank), '(S)')::INT,
    NULLIF(TRIM(count), '(S)')::INT,
    NULLIF(TRIM(prop100k), '(S)')::NUMERIC,
    NULLIF(TRIM(cum_prop100k), '(S)')::NUMERIC,
    NULLIF(TRIM(pctwhite), '(S)')::NUMERIC,
    NULLIF(TRIM(pctblack), '(S)')::NUMERIC,
    NULLIF(TRIM(pctapi), '(S)')::NUMERIC,
    NULLIF(TRIM(pctaian), '(S)')::NUMERIC,
    NULLIF(TRIM(pct2prace), '(S)')::NUMERIC,
    NULLIF(TRIM(pcthispanic), '(S)')::NUMERIC
FROM tmp_census_load
WHERE name IS NOT NULL AND TRIM(name) != ''
ON CONFLICT (name) DO UPDATE SET
    rank = EXCLUDED.rank,
    count = EXCLUDED.count,
    prop100k = EXCLUDED.prop100k,
    cum_prop100k = EXCLUDED.cum_prop100k,
    pct_white = EXCLUDED.pct_white,
    pct_black = EXCLUDED.pct_black,
    pct_api = EXCLUDED.pct_api,
    pct_aian = EXCLUDED.pct_aian,
    pct_2prace = EXCLUDED.pct_2prace,
    pct_hispanic = EXCLUDED.pct_hispanic;

-- Report results
\echo ''
\echo '=== Census Surnames Load Complete ==='
SELECT
    'Total surnames loaded' as metric,
    COUNT(*)::TEXT as value
FROM ref.census_surnames
UNION ALL
SELECT
    'Top 10 most common',
    STRING_AGG(name, ', ' ORDER BY rank)
FROM (SELECT name, rank FROM ref.census_surnames ORDER BY rank LIMIT 10) t
UNION ALL
SELECT
    'Occupation surnames',
    COUNT(*)::TEXT
FROM ref.occupation_surnames;
EOF

echo ""
echo "=== Done! ==="
echo "Run verification:"
echo "  SELECT COUNT(*) FROM ref.census_surnames;"
echo "  SELECT * FROM ref.census_surnames ORDER BY rank LIMIT 10;"
