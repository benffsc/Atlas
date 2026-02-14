/**
 * Atlas Version Toggle System
 *
 * Controls which schema version is used across the application.
 * This enables gradual migration from V1 (trapper.*) to V2 (sot.*, ops.*, source.*).
 *
 * Usage:
 *   import { isV2, getTable } from "@/config/atlas-version";
 *
 *   // Check version
 *   if (isV2()) {
 *     // V2 behavior
 *   }
 *
 *   // Get table name for version
 *   const sql = `SELECT * FROM ${getTable('cats')} WHERE ...`;
 *
 * Configuration:
 *   Set ATLAS_VERSION environment variable to 'v1' or 'v2' (default: 'v1')
 */

export type AtlasVersion = "v1" | "v2";

/**
 * Get the current Atlas version from environment
 * As of 2026-02-14: V2 is now the default. V1 (trapper.*) is deprecated.
 */
export function getAtlasVersion(): AtlasVersion {
  const version = process.env.ATLAS_VERSION as AtlasVersion;
  return version === "v1" ? "v1" : "v2"; // Default to v2 (V1 deprecated)
}

/**
 * Check if V2 is active
 */
export function isV2(): boolean {
  return getAtlasVersion() === "v2";
}

/**
 * Check if V1 is active
 */
export function isV1(): boolean {
  return getAtlasVersion() === "v1";
}

// ============================================================================
// Table Name Mapping
// ============================================================================

/**
 * V1 table names (deprecated - now points to V2 tables since trapper schema is dropped)
 */
const V1_TABLES = {
  // SOT entities
  cats: "sot.cats",
  people: "sot.people",
  places: "sot.places",
  addresses: "sot.addresses",

  // Operations
  appointments: "ops.appointments",
  requests: "ops.requests",
  intake_submissions: "ops.intake_submissions",

  // Identifiers
  person_identifiers: "sot.person_identifiers",
  cat_identifiers: "sot.cat_identifiers",

  // Relationships
  person_cat: "sot.person_cat",
  person_place: "sot.person_place",
  cat_place: "sot.cat_place",

  // Support
  clinic_accounts: "ops.clinic_accounts",
  soft_blacklist: "sot.soft_blacklist",
  colony_estimates: "sot.place_colony_estimates",
} as const;

/**
 * V2 table names (sot/ops/source schemas)
 */
const V2_TABLES = {
  // SOT entities
  cats: "sot.cats",
  people: "sot.people",
  places: "sot.places",
  addresses: "sot.addresses",

  // Operations
  appointments: "ops.appointments",
  requests: "ops.requests",
  intake_submissions: "ops.intake_submissions",

  // Identifiers
  person_identifiers: "sot.person_identifiers",
  cat_identifiers: "sot.cat_identifiers",

  // Relationships
  person_cat: "sot.person_cat",
  person_place: "sot.person_place",
  cat_place: "sot.cat_place",

  // Support
  clinic_accounts: "ops.clinic_accounts",
  soft_blacklist: "sot.soft_blacklist",
  colony_estimates: "beacon.colony_estimates",
} as const;

export type TableName = keyof typeof V1_TABLES;

/**
 * Get the appropriate table name for the current version
 */
export function getTable(name: TableName): string {
  return isV2() ? V2_TABLES[name] : V1_TABLES[name];
}

/**
 * Get table name with explicit version override
 */
export function getTableForVersion(name: TableName, version: AtlasVersion): string {
  return version === "v2" ? V2_TABLES[name] : V1_TABLES[name];
}

// ============================================================================
// Column Name Mapping (for columns that differ between versions)
// ============================================================================

/**
 * V1 column names that differ from V2
 */
const V1_COLUMNS = {
  // Person merge tracking
  merged_into: "merged_into_person_id",
  // Cat merge tracking
  cat_merged_into: "merged_into_cat_id",
  // Place merge tracking
  place_merged_into: "merged_into_place_id",
  // Entity source tracking
  source_system: "source_system",
  source_record_id: "source_record_id",
} as const;

/**
 * V2 column names (same for now, but provides extensibility)
 */
const V2_COLUMNS = {
  merged_into: "merged_into_person_id",
  cat_merged_into: "merged_into_cat_id",
  place_merged_into: "merged_into_place_id",
  source_system: "source_system",
  source_record_id: "source_record_id",
} as const;

export type ColumnName = keyof typeof V1_COLUMNS;

/**
 * Get the appropriate column name for the current version
 */
export function getColumn(name: ColumnName): string {
  return isV2() ? V2_COLUMNS[name] : V1_COLUMNS[name];
}

// ============================================================================
// Schema Prefix Helper
// ============================================================================

/**
 * Get the primary schema prefix for the current version
 * Note: trapper schema is dropped, always returns sot
 */
export function getSchemaPrefix(): string {
  return "sot.";
}

/**
 * Get the ops schema prefix for the current version
 * Note: trapper schema is dropped, always returns ops
 */
export function getOpsSchemaPrefix(): string {
  return "ops.";
}

// ============================================================================
// Merge Filter Helper
// ============================================================================

/**
 * Generate the standard merge filter clause
 * All queries on entity tables should include this filter
 */
export function getMergeFilter(tableAlias: string, entityType: "person" | "cat" | "place"): string {
  const column = {
    person: "merged_into_person_id",
    cat: "merged_into_cat_id",
    place: "merged_into_place_id",
  }[entityType];

  return `${tableAlias}.${column} IS NULL`;
}

// ============================================================================
// Version Info for API Responses
// ============================================================================

/**
 * Get version info object for including in API responses
 */
export function getVersionInfo(): { version: AtlasVersion; schemas: string[] } {
  return {
    version: getAtlasVersion(),
    schemas: isV2()
      ? ["source", "ops", "sot", "beacon", "atlas", "quarantine"]
      : ["trapper"],
  };
}

// ============================================================================
// Type Guards for Runtime Checks
// ============================================================================

/**
 * Assert that we're running V2 (throws if not)
 * Use sparingly - prefer graceful version checking
 */
export function assertV2(context: string): void {
  if (!isV2()) {
    throw new Error(`${context} requires ATLAS_VERSION=v2. Current version: v1`);
  }
}

/**
 * Assert that we're running V1 (throws if not)
 * Use sparingly - prefer graceful version checking
 */
export function assertV1(context: string): void {
  if (!isV1()) {
    throw new Error(`${context} requires ATLAS_VERSION=v1. Current version: v2`);
  }
}
