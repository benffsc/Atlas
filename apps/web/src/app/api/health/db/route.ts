import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Database Health Check Endpoint
 *
 * Returns the status of all critical database objects needed for:
 * - Beacon Analytics (colony status, TNR metrics)
 * - Tippy Data Quality (deduplication, lineage, quality checks)
 *
 * Used by:
 * - Playwright tests (to diagnose failures)
 * - Monitoring systems
 * - Deployment verification
 */

interface DbCheck {
  name: string;
  type: "view" | "materialized_view" | "function" | "table";
  exists: boolean;
  error?: string;
}

async function checkView(viewName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_views
        WHERE schemaname = 'trapper' AND viewname = $1
      ) as exists
    `, [viewName]);
    return { name: viewName, type: "view", exists: result?.exists ?? false };
  } catch (error) {
    return { name: viewName, type: "view", exists: false, error: String(error) };
  }
}

async function checkMaterializedView(viewName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_matviews
        WHERE schemaname = 'trapper' AND matviewname = $1
      ) as exists
    `, [viewName]);
    return { name: viewName, type: "materialized_view", exists: result?.exists ?? false };
  } catch (error) {
    return { name: viewName, type: "materialized_view", exists: false, error: String(error) };
  }
}

async function checkFunction(funcName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'trapper' AND p.proname = $1
      ) as exists
    `, [funcName]);
    return { name: funcName, type: "function", exists: result?.exists ?? false };
  } catch (error) {
    return { name: funcName, type: "function", exists: false, error: String(error) };
  }
}

async function checkTable(tableName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'trapper' AND tablename = $1
      ) as exists
    `, [tableName]);
    return { name: tableName, type: "table", exists: result?.exists ?? false };
  } catch (error) {
    return { name: tableName, type: "table", exists: false, error: String(error) };
  }
}

export async function GET() {
  try {
    const checks = await Promise.all([
      // Beacon views
      checkView("v_beacon_summary"),
      checkView("v_beacon_place_metrics"),
      checkView("v_beacon_cluster_summary"),
      checkMaterializedView("mv_beacon_clusters"),

      // Beacon functions
      checkFunction("beacon_cluster_colonies"),
      checkFunction("get_seasonal_alerts"),

      // Seasonal views
      checkView("v_seasonal_dashboard"),
      checkView("v_yoy_activity_comparison"),
      checkView("v_kitten_surge_prediction"),

      // Data quality functions (MIG_487)
      checkFunction("check_entity_quality"),
      checkFunction("find_potential_duplicates"),
      checkFunction("query_merge_history"),
      checkFunction("query_data_lineage"),
      checkFunction("query_volunteerhub_data"),

      // Supporting tables
      checkTable("source_identity_confidence"),
      checkTable("place_colony_estimates"),
      checkTable("schema_migrations"),
    ]);

    const failed = checks.filter((c) => !c.exists);
    const healthy = failed.length === 0;

    // Get migration status if tracking table exists
    let migrations: Array<{ migration_number: number; migration_name: string; status: string }> = [];
    try {
      migrations = await queryRows(`
        SELECT migration_number, migration_name, status
        FROM ops.schema_migrations
        ORDER BY migration_number DESC
        LIMIT 10
      `, []);
    } catch {
      // Table doesn't exist yet
    }

    return NextResponse.json({
      healthy,
      summary: {
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
      },
      checks,
      failed,
      migrations,
      hints: failed.length > 0 ? [
        "Run: ./scripts/deploy-critical-migrations.sh",
        "See: docs/DEPLOYMENT.md#beacon-migrations",
      ] : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      healthy: false,
      error: "Database connection failed",
      details: String(error),
      hints: [
        "Check DATABASE_URL environment variable",
        "Verify database is running",
      ],
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
