/**
 * Atlas Map Module
 *
 * Organized exports for the Atlas Map feature.
 * This module contains hooks, components, and types for the main map interface.
 *
 * Usage:
 *   import { useMapSearch, MapControls, MapLegend } from '@/components/map';
 *   import type { AtlasPin, Place } from '@/components/map';
 */

// Hooks
export { useMapSearch } from "./hooks/useMapSearch";
export { useStreetView } from "./hooks/useStreetView";
export {
  useMapClustering,
  isCluster,
  getClusterColor,
  getClusterSizeClass,
} from "./hooks/useMapClustering";

// Components
export { MapControls } from "./components/MapControls";
export { MapLegend } from "./components/MapLegend";
export { DateRangeFilter } from "./components/DateRangeFilter";
export { useClusterMarker, renderClusterMarkers } from "./components/MapClusterMarker";
export { LocationComparisonPanel } from "./components/LocationComparisonPanel";

// Types
export type {
  Place,
  GooglePin,
  TnrPriorityPlace,
  Zone,
  Volunteer,
  ClinicClient,
  HistoricalSource,
  DataCoverageZone,
  AtlasPin,
  MapSummary,
  PlacePrediction,
  AtlasSearchResult,
  NavigatedLocation,
  Annotation,
  LayerConfig,
  RiskFilter,
  DataFilter,
  StreetViewState,
  SearchState,
} from "./types";

// Constants
export {
  PRIMARY_LAYER_CONFIGS,
  LEGACY_LAYER_CONFIGS,
  LAYER_CONFIGS,
  SERVICE_ZONES,
} from "./types";

// Main map components
export { default as AtlasMap } from "./AtlasMap";
export { default as BeaconMap } from "./BeaconMap";

// Re-export existing map components (already in this directory)
export { PlaceDetailDrawer } from "./PlaceDetailDrawer";
export { PersonDetailDrawer } from "./PersonDetailDrawer";
export { CatDetailDrawer } from "./CatDetailDrawer";
export { AnnotationDetailDrawer } from "./AnnotationDetailDrawer";
export { PlacementPanel } from "./PlacementPanel";
export {
  buildPlacePopup,
  buildGooglePinPopup,
  buildTNRPriorityPopup,
  buildVolunteerPopup,
  buildClinicClientPopup,
  buildZonePopup,
  escapeHtml,
} from "./MapPopup";
