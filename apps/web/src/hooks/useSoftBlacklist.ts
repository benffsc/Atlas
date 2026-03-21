"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import { SOFT_BLACKLIST_EMAILS, SOFT_BLACKLIST_PHONES } from "@/lib/constants";
import type { SoftBlacklist } from "@/lib/soft-blacklist";

/**
 * Client-side hook to load the soft blacklist from the database.
 * Falls back to hardcoded constants immediately, then updates from API.
 *
 * Pass the result to shouldBePerson() as the 5th argument.
 *
 * @see FFS-686
 */
export function useSoftBlacklist(): SoftBlacklist {
  const [blacklist, setBlacklist] = useState<SoftBlacklist>({
    emails: SOFT_BLACKLIST_EMAILS,
    phones: SOFT_BLACKLIST_PHONES,
  });

  useEffect(() => {
    fetchApi<SoftBlacklist>("/api/config/soft-blacklist")
      .then(setBlacklist)
      .catch(() => {
        // Fallback already set — no action needed
      });
  }, []);

  return blacklist;
}
