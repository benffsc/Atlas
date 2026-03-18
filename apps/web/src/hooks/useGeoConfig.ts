/**
 * useGeoConfig — convenience wrapper over useAppConfig for geographic defaults.
 *
 * Returns map center/zoom, default county, service area name, and county list.
 * Uses SWR deduplication so multiple calls share a single fetch.
 *
 * FFS-685: White-label map & geographic defaults.
 */

import { useAppConfig } from "@/hooks/useAppConfig";
import type { MapBounds } from "@/lib/geo-config";

export function useGeoConfig() {
  const { value: mapCenter } = useAppConfig<[number, number]>("map.default_center");
  const { value: mapZoom } = useAppConfig<number>("map.default_zoom");
  const { value: mapBounds } = useAppConfig<MapBounds>("map.default_bounds");
  const { value: defaultCounty } = useAppConfig<string>("geo.default_county");
  const { value: serviceAreaName } = useAppConfig<string>("geo.service_area_name");
  const { value: serviceCounties } = useAppConfig<string[]>("geo.service_counties");

  return { mapCenter, mapZoom, mapBounds, defaultCounty, serviceAreaName, serviceCounties };
}
