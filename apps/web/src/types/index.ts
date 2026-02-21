/**
 * Atlas Type Exports
 *
 * Barrel export for all type definitions.
 *
 * Usage:
 *   import type { Person, Place, Cat, Request } from '@/types';
 *   import type { MapPin, MapState } from '@/types';
 *   import type { ApiError, PaginatedResponse } from '@/types';
 */

// Entity types
export type {
  // Base types
  BaseEntity,
  MergeableEntity,
  SourcedEntity,

  // Person
  Person,
  PersonIdentifier,
  PersonRole,
  PersonPlaceSummary,
  PersonCatSummary,
  PersonSummary,

  // Place
  Place,
  PlaceSummary,
  PlaceCatSummary,
  PlaceDiseaseStatus,

  // Cat
  Cat,
  CatIdentifier,
  CatFieldSource,
  CatPlaceSummary,
  CatProcedure,
  CatLifecycleEvent,

  // Request
  Request,
  TrapperAssignment,
  RequestTimelineEntry,
  RequestCatSummary,

  // Appointment
  Appointment,

  // Volunteer
  Volunteer,
  VolunteerRoleRecord,

  // Colony
  ColonyEstimate,

  // Intake
  IntakeSubmission,
} from './entities';

// API types
export type {
  // Common responses
  ApiError,
  PaginatedResponse,
  SuccessResponse,
  MutationResponse,

  // Route params
  EntityRouteParams,
  SearchParams,

  // Search
  SearchResult,
  SearchResultMetadata,
  SearchSuggestion,

  // Ingest
  IngestJobStatus,
  IngestError,
  IngestResult,

  // Merge
  MergePreview,
  MergeConflict,
  MergeRequest,
  MergeResult,

  // Geocoding
  GeocodeRequest,
  GeocodeResult,

  // Data quality
  DataQualityIssue,
  DataQualitySummary,

  // Health
  HealthCheckResult,
  ComponentHealth,
} from './api';

// Map types
export type {
  // State
  MapState,
  LatLng,
  MapBounds,

  // Pins
  MapPin,
  MapPinType,
  MapPinIcon,
  MapPinColor,
  MapPinData,

  // Layers
  MapLayerId,
  MapLayer,
  MapLayerFilter,

  // Detail panel
  MapDetailPanelData,

  // Events
  MapClickEvent,
  MapMoveEvent,
  MapClusterClickEvent,

  // Config
  MapConfig,
} from './map';

// Map constants and utilities
export {
  DEFAULT_LAYERS,
  DEFAULT_MAP_CONFIG,
  COORDINATE_TOLERANCE,
  coordinatesMatch,
  calculateDistance,
} from './map';
