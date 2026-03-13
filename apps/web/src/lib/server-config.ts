/**
 * Server-side config helper for ops.app_config.
 *
 * Use in API routes and server components to read runtime config
 * without hardcoding constants. Falls back to provided default on
 * any error (missing row, DB down, etc.).
 *
 * No caching — API routes are short-lived, one query per call is fine.
 */

import { queryOne } from "@/lib/db";

export async function getServerConfig<T>(
  key: string,
  defaultValue: T
): Promise<T> {
  try {
    const row = await queryOne<{ value: unknown }>(
      "SELECT value FROM ops.app_config WHERE key = $1",
      [key]
    );
    return row ? (row.value as T) : defaultValue;
  } catch {
    return defaultValue;
  }
}
