"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchApi } from "@/lib/api-client";
import type { FormSectionComponent } from "@/lib/form-field-types";

interface SectionDef {
  component: string;
  label?: string;
  props?: Record<string, unknown>;
}

interface FormConfigItem {
  config_id: string;
  key: string;
  label: string;
  sections: SectionDef[];
  updated_at: string;
}

// Module-level cache so multiple hook instances don't double-fetch
let _cache: FormConfigItem[] | null = null;
let _fetchPromise: Promise<FormConfigItem[]> | null = null;

async function loadConfigs(): Promise<FormConfigItem[]> {
  if (_cache) return _cache;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetchApi<{ configs: FormConfigItem[] }>("/api/admin/forms/configs")
    .then((data) => {
      _cache = data.configs;
      return _cache;
    })
    .catch(() => {
      // Graceful degradation: return empty on failure
      return [] as FormConfigItem[];
    })
    .finally(() => {
      _fetchPromise = null;
    });

  return _fetchPromise;
}

/**
 * useSectionConfig — reads form_config.{configKey} from the DB
 * and gates section visibility for both request forms.
 *
 * Falls back to all-enabled if fetch fails or config not found.
 *
 * @param configKey - The form config key suffix (e.g., "ffr_new", "dynamic_intake")
 */
export function useSectionConfig(configKey: string) {
  const [configs, setConfigs] = useState<FormConfigItem[]>(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) {
      setConfigs(_cache);
      setLoading(false);
      return;
    }
    let mounted = true;
    loadConfigs().then((c) => {
      if (mounted) {
        setConfigs(c);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const config = useMemo(
    () => configs.find((c) => c.key === `form_config.${configKey}`),
    [configs, configKey]
  );

  const isEnabled = useCallback(
    (component: FormSectionComponent): boolean => {
      // If no config found or still loading, default to enabled (graceful degradation)
      if (!config) return true;
      return config.sections.some((s) => s.component === component);
    },
    [config]
  );

  const getProps = useCallback(
    (component: FormSectionComponent): Record<string, unknown> => {
      if (!config) return {};
      const section = config.sections.find((s) => s.component === component);
      return section?.props || {};
    },
    [config]
  );

  return { isEnabled, getProps, loading };
}
