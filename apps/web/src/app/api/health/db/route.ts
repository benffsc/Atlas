import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Database Health Check Endpoint
 *
 * V2 Schema Architecture:
 * - source.* — Raw data from external systems
 * - ops.* — Operational data (views, appointments, staff)
 * - sot.* — Source of Truth entities (cats, people, places)
 *
 * Used by:
 * - Playwright tests (to diagnose failures)
 * - Monitoring systems
 * - Deployment verification
 */

interface DbCheck {
  name: string;
  schema: string;
  type: "view" | "materialized_view" | "function" | "table";
  exists: boolean;
  error?: string;
}

async function checkView(schema: string, viewName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_views
        WHERE schemaname = $1 AND viewname = $2
      ) as exists
    `, [schema, viewName]);
    return { name: viewName, schema, type: "view", exists: result?.exists ?? false };
  } catch (error) {
    return { name: viewName, schema, type: "view", exists: false, error: String(error) };
  }
}

async function checkMaterializedView(schema: string, viewName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_matviews
        WHERE schemaname = $1 AND matviewname = $2
      ) as exists
    `, [schema, viewName]);
    return { name: viewName, schema, type: "materialized_view", exists: result?.exists ?? false };
  } catch (error) {
    return { name: viewName, schema, type: "materialized_view", exists: false, error: String(error) };
  }
}

async function checkFunction(schema: string, funcName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1 AND p.proname = $2
      ) as exists
    `, [schema, funcName]);
    return { name: funcName, schema, type: "function", exists: result?.exists ?? false };
  } catch (error) {
    return { name: funcName, schema, type: "function", exists: false, error: String(error) };
  }
}

async function checkTable(schema: string, tableName: string): Promise<DbCheck> {
  try {
    const result = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_tables
        WHERE schemaname = $1 AND tablename = $2
      ) as exists
    `, [schema, tableName]);
    return { name: tableName, schema, type: "table", exists: result?.exists ?? false };
  } catch (error) {
    return { name: tableName, schema, type: "table", exists: false, error: String(error) };
  }
}

export async function GET() {
  try {
    const checks = await Promise.all([
      // V2 Core entity views (ops schema)
      checkView("ops", "v_cat_list"),
      checkView("ops", "v_person_list"),
      checkView("ops", "v_place_list"),
      checkView("ops", "v_request_list"),

      // V2 Detail views (sot schema)
      checkView("sot", "v_cat_detail"),
      checkView("sot", "v_person_detail"),
      checkView("sot", "v_place_detail"),

      // V2 Core tables (sot schema)
      checkTable("sot", "cats"),
      checkTable("sot", "people"),
      checkTable("sot", "places"),
      checkTable("sot", "addresses"),

      // V2 Operational tables (ops schema)
      checkTable("ops", "requests"),
      checkTable("ops", "appointments"),
      checkTable("ops", "staff"),

      // V2 Source tables (source schema)
      checkTable("source", "clinichq_raw"),
      checkTable("source", "shelterluv_raw"),

      // Linear integration (ops schema)
      checkTable("ops", "linear_issues"),
      checkTable("ops", "linear_projects"),

      // V2 Core functions (sot schema)
      checkFunction("sot", "find_or_create_person"),
      checkFunction("sot", "find_or_create_place"),
      checkFunction("sot", "find_or_create_cat"),
      checkFunction("sot", "classify_owner_name"),
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

    return apiSuccess({
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
        "Apply V2 migrations from sql/schema/v2/",
        "See: docs/DEVELOPER_QUICK_START.md",
      ] : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiServerError(
      `Database connection failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
