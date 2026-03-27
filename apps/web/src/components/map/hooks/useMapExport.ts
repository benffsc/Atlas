import { useCallback, useMemo } from "react";
import { exportPinsToCsv, exportPinsToGeoJson } from "@/lib/map-export";
import type { AtlasPin, RiskFilter } from "@/components/map/types";

interface UseMapExportOptions {
  atlasPins: AtlasPin[];
  riskFilter: RiskFilter;
  diseaseFilter: string[];
}

export function useMapExport({ atlasPins, riskFilter, diseaseFilter }: UseMapExportOptions) {
  const activeFilterName = useMemo(() => {
    if (riskFilter !== "all") return riskFilter;
    if (diseaseFilter.length > 0) return diseaseFilter.join("_");
    return undefined;
  }, [riskFilter, diseaseFilter]);

  const handleExportCsv = useCallback(() => {
    exportPinsToCsv(atlasPins, activeFilterName);
  }, [atlasPins, activeFilterName]);

  const handleExportGeoJson = useCallback(() => {
    exportPinsToGeoJson(atlasPins, activeFilterName);
  }, [atlasPins, activeFilterName]);

  return { handleExportCsv, handleExportGeoJson };
}
