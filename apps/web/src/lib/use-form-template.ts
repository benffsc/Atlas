"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import type { ResolvedTemplate, TemplateKey } from "@/lib/form-field-types";

/**
 * Fetches a resolved form template from the API.
 * Returns { template, loading, error }.
 */
export function useFormTemplate(key: TemplateKey) {
  const [template, setTemplate] = useState<ResolvedTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchApi<ResolvedTemplate>(
          `/api/forms/templates/${key}`
        );
        if (!cancelled) {
          setTemplate(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load template"
          );
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { template, loading, error };
}
