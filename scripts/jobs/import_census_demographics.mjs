#!/usr/bin/env node
/**
 * import_census_demographics.mjs
 *
 * Imports US Census ACS 5-year estimates for Sonoma County.
 * Updates ref_sonoma_geography with income, poverty, housing data.
 *
 * Data source: Census Bureau API (free, no key required for basic queries)
 * https://api.census.gov/data.html
 *
 * Usage:
 *   node scripts/jobs/import_census_demographics.mjs --dry-run
 *   node scripts/jobs/import_census_demographics.mjs
 *
 * Run annually after ACS data release (typically December)
 */

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sonoma County FIPS code
const SONOMA_COUNTY_FIPS = "097";
const CALIFORNIA_FIPS = "06";

// Census ACS 5-year variables we want
// See: https://api.census.gov/data/2022/acs/acs5/variables.html
const CENSUS_VARIABLES = {
  // Population
  B01001_001E: "total_population",
  // Households
  B11001_001E: "total_households",
  // Income
  B19013_001E: "median_household_income",
  // Poverty
  B17001_002E: "population_below_poverty",
  // Housing tenure
  B25003_001E: "total_occupied_housing",
  B25003_002E: "owner_occupied",
  B25003_003E: "renter_occupied",
  // Housing type
  B25024_001E: "total_housing_units",
  B25024_002E: "single_family_detached",
  B25024_003E: "single_family_attached",
  B25024_010E: "mobile_homes",
  // Home value
  B25077_001E: "median_home_value",
};

// Known Sonoma County zip codes
const SONOMA_ZIP_CODES = [
  "94922", "94923", "94926", "94927", "94928", "94929", "94931",
  "94951", "94952", "94953", "94954", "94955", "94972", "94975", "94999",
  "95401", "95402", "95403", "95404", "95405", "95406", "95407", "95409",
  "95412", "95416", "95419", "95421", "95425", "95430", "95431", "95433",
  "95436", "95439", "95441", "95442", "95444", "95446", "95448", "95450",
  "95452", "95462", "95465", "95471", "95472", "95473", "95476", "95486", "95492"
];

async function fetchCensusData(geography, year = 2022) {
  const variables = Object.keys(CENSUS_VARIABLES).join(",");
  const baseUrl = `https://api.census.gov/data/${year}/acs/acs5`;

  if (geography === "zip") {
    // Fetch specific Sonoma County zip codes
    console.log(`Fetching ${SONOMA_ZIP_CODES.length} zip codes from Census API...`);

    // Census API allows querying multiple zips at once
    const zipList = SONOMA_ZIP_CODES.join(",");
    const url = `${baseUrl}?get=NAME,${variables}&for=zip%20code%20tabulation%20area:${zipList}`;

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Census API error: ${response.status} - ${text}`);
    }

    return await response.json();
  } else if (geography === "tract") {
    // Fetch census tracts in Sonoma County
    const url = `${baseUrl}?get=NAME,${variables}&for=tract:*&in=state:${CALIFORNIA_FIPS}&in=county:${SONOMA_COUNTY_FIPS}`;
    console.log(`Fetching tract data from Census API...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Census API error: ${response.status}`);
    }

    return await response.json();
  }

  throw new Error(`Unknown geography: ${geography}`);
}

function parseValue(val) {
  if (val === null || val === undefined || val === "-" || val === "N") {
    return null;
  }
  const num = parseInt(val, 10);
  // Census uses -666666666 for "not available"
  if (isNaN(num) || num === -666666666) {
    return null;
  }
  return num;
}

function computePetOwnershipIndex(row) {
  // Higher index = more likely to have unaltered pets
  let score = 50;

  // Income factor (lower income = higher score)
  const income = row.median_household_income;
  if (income && income < 40000) score += 25;
  else if (income && income < 60000) score += 15;
  else if (income && income > 100000) score -= 15;

  // Renter factor (higher renter = higher score)
  const renterPct = row.pct_renter_occupied;
  if (renterPct) score += renterPct * 0.3;

  // Mobile home factor (strong indicator)
  const mobilePct = row.pct_mobile_homes;
  if (mobilePct) score += mobilePct * 1.5;

  // Poverty factor
  const povertyPct = row.pct_below_poverty;
  if (povertyPct) score += povertyPct * 0.5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

async function importCensusData(options = {}) {
  const { dryRun = false, year = 2022 } = options;

  console.log("=== Importing Census Demographics ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Data year: ${year} ACS 5-year estimates`);
  console.log("");

  const client = await pool.connect();

  try {
    // Fetch zip code data
    const zipData = await fetchCensusData("zip", year);
    const headers = zipData[0];
    const rows = zipData.slice(1);

    // Filter to Sonoma County zips (already filtered by our specific list)
    const zipIndex = headers.indexOf("zip code tabulation area");
    const sonomaRows = rows.filter((row) => {
      const zip = row[zipIndex];
      return SONOMA_ZIP_CODES.includes(zip);
    });

    console.log(`Found ${sonomaRows.length} Sonoma County zip codes`);

    let updated = 0;
    let inserted = 0;

    for (const row of sonomaRows) {
      const zip = row[zipIndex];
      const name = row[headers.indexOf("NAME")];

      // Parse all variables
      const values = {};
      for (const [censusVar, localName] of Object.entries(CENSUS_VARIABLES)) {
        const idx = headers.indexOf(censusVar);
        values[localName] = idx >= 0 ? parseValue(row[idx]) : null;
      }

      // Compute derived percentages
      const totalPop = values.total_population || 1;
      const totalHousing = values.total_housing_units || 1;
      const totalOccupied = values.total_occupied_housing || 1;

      const record = {
        area_type: "zip",
        area_name: name.replace(" ZCTA5", "").replace(/, California$/, ""),
        area_code: zip,
        population: values.total_population,
        households: values.total_households,
        median_household_income: values.median_household_income,
        pct_below_poverty:
          values.population_below_poverty && totalPop
            ? Math.round((100 * values.population_below_poverty) / totalPop * 10) / 10
            : null,
        pct_renter_occupied:
          values.renter_occupied && totalOccupied
            ? Math.round((100 * values.renter_occupied) / totalOccupied * 10) / 10
            : null,
        pct_owner_occupied:
          values.owner_occupied && totalOccupied
            ? Math.round((100 * values.owner_occupied) / totalOccupied * 10) / 10
            : null,
        pct_mobile_homes:
          values.mobile_homes && totalHousing
            ? Math.round((100 * values.mobile_homes) / totalHousing * 10) / 10
            : null,
        pct_single_family:
          (values.single_family_detached || 0) + (values.single_family_attached || 0) && totalHousing
            ? Math.round(
                (100 * ((values.single_family_detached || 0) + (values.single_family_attached || 0))) /
                  totalHousing * 10
              ) / 10
            : null,
        median_home_value: values.median_home_value,
        data_source: `Census ACS 5-year ${year}`,
        data_year: year,
      };

      // Compute pet ownership index
      record.pet_ownership_index = computePetOwnershipIndex(record);
      record.tnr_priority_score = record.pet_ownership_index; // Same for now

      if (dryRun) {
        console.log(`Would upsert: ${record.area_name} (${zip})`);
        console.log(`  Income: $${record.median_household_income}, Poverty: ${record.pct_below_poverty}%`);
        console.log(`  Renter: ${record.pct_renter_occupied}%, Mobile: ${record.pct_mobile_homes}%`);
        console.log(`  Pet Index: ${record.pet_ownership_index}`);
      } else {
        const result = await client.query(
          `
          INSERT INTO trapper.ref_sonoma_geography (
            area_type, area_name, area_code, population, households,
            median_household_income, pct_below_poverty, pct_renter_occupied,
            pct_owner_occupied, pct_mobile_homes, pct_single_family,
            median_home_value, pet_ownership_index, tnr_priority_score,
            data_source, data_year, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (area_id) DO UPDATE SET
            population = EXCLUDED.population,
            households = EXCLUDED.households,
            median_household_income = EXCLUDED.median_household_income,
            pct_below_poverty = EXCLUDED.pct_below_poverty,
            pct_renter_occupied = EXCLUDED.pct_renter_occupied,
            pct_owner_occupied = EXCLUDED.pct_owner_occupied,
            pct_mobile_homes = EXCLUDED.pct_mobile_homes,
            pct_single_family = EXCLUDED.pct_single_family,
            median_home_value = EXCLUDED.median_home_value,
            pet_ownership_index = EXCLUDED.pet_ownership_index,
            tnr_priority_score = EXCLUDED.tnr_priority_score,
            data_source = EXCLUDED.data_source,
            data_year = EXCLUDED.data_year,
            updated_at = NOW()
          RETURNING (xmax = 0) as inserted
        `,
          [
            record.area_type,
            record.area_name,
            record.area_code,
            record.population,
            record.households,
            record.median_household_income,
            record.pct_below_poverty,
            record.pct_renter_occupied,
            record.pct_owner_occupied,
            record.pct_mobile_homes,
            record.pct_single_family,
            record.median_home_value,
            record.pet_ownership_index,
            record.tnr_priority_score,
            record.data_source,
            record.data_year,
          ]
        );

        if (result.rows[0]?.inserted) {
          inserted++;
        } else {
          updated++;
        }
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Total: ${sonomaRows.length}`);

    // Update freshness tracking
    if (!dryRun) {
      await client.query(
        `
        UPDATE trapper.data_freshness_tracking
        SET last_full_refresh = NOW(),
            records_count = $1,
            updated_at = NOW()
        WHERE data_category = 'census_demographics'
      `,
        [sonomaRows.length]
      );
      console.log("\nUpdated data freshness tracking.");
    }
  } finally {
    client.release();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  year: 2022, // Latest available ACS 5-year
};

const yearIndex = args.indexOf("--year");
if (yearIndex !== -1 && args[yearIndex + 1]) {
  options.year = parseInt(args[yearIndex + 1]);
}

importCensusData(options)
  .then(() => {
    console.log("\n=== Complete ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
