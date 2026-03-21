/**
 * Server-side soft blacklist loader with caching.
 *
 * Reads from sot.soft_blacklist (seeded in MIG_2009) with a 5-minute TTL cache.
 * Falls back to hardcoded constants if the DB query fails.
 *
 * @see FFS-686
 */

import { queryRows } from "@/lib/db";
import { SOFT_BLACKLIST_EMAILS, SOFT_BLACKLIST_PHONES } from "./constants";

export interface SoftBlacklist {
  emails: string[];
  phones: string[];
}

let cache: { data: SoftBlacklist; expiresAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load soft blacklist from database with caching.
 * Falls back to hardcoded constants on failure.
 */
export async function loadSoftBlacklist(): Promise<SoftBlacklist> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  try {
    const rows = await queryRows<{ identifier_type: string; identifier_norm: string }>(
      `SELECT identifier_type, identifier_norm
       FROM sot.soft_blacklist
       WHERE require_name_similarity >= 0.9`
    );

    const emails = rows
      .filter((r) => r.identifier_type === "email")
      .map((r) => r.identifier_norm);
    const phones = rows
      .filter((r) => r.identifier_type === "phone")
      .map((r) => r.identifier_norm);

    const data: SoftBlacklist = { emails, phones };
    cache = { data, expiresAt: Date.now() + CACHE_TTL };
    return data;
  } catch (err) {
    console.error("Failed to load soft blacklist from DB, falling back to constants:", err);
    return { emails: SOFT_BLACKLIST_EMAILS, phones: SOFT_BLACKLIST_PHONES };
  }
}

/** Clear the cache (for testing or after admin updates). */
export function clearSoftBlacklistCache(): void {
  cache = null;
}
