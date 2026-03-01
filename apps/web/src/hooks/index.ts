/**
 * Custom React Hooks
 *
 * Centralized exports for reusable hooks.
 */

// Keyboard shortcuts
export {
  useKeyboardShortcuts,
  useGlobalShortcuts,
  formatShortcut,
  COMMON_SHORTCUTS,
} from "./useKeyboardShortcuts";

// Authentication
export { useCurrentUser, clearUserCache } from "./useCurrentUser";

// Responsive design
export { useIsMobile } from "./useIsMobile";

// Map data
export {
  useMapData,
  invalidateMapData,
  type MapDataBounds,
  type UseMapDataOptions,
  type AtlasPin,
  type MapDataResponse,
} from "./useMapData";

// Place resolution
export {
  usePlaceResolver,
  type AtlasPlace,
  type GooglePrediction,
  type ResolvedPlace,
  type DuplicateCheckResult,
  type UsePlaceResolverOptions,
} from "./usePlaceResolver";

// URL state management
export { useUrlFilters } from "./useUrlFilters";
