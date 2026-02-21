/**
 * Atlas API Types
 *
 * TypeScript interfaces for API requests and responses.
 */

// =============================================================================
// COMMON RESPONSE TYPES
// =============================================================================

/**
 * Standard API error response.
 */
export interface ApiError {
  error: string;
  details?: string;
  code?: string;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Success response with optional message.
 */
export interface SuccessResponse {
  success: true;
  message?: string;
}

/**
 * Mutation response with affected entity.
 */
export interface MutationResponse<T> {
  success: true;
  data: T;
  message?: string;
}

// =============================================================================
// ROUTE PARAMS
// =============================================================================

/**
 * Standard single-ID route params.
 */
export interface EntityRouteParams {
  params: {
    id: string;
  };
}

/**
 * Search params for list endpoints.
 */
export interface SearchParams {
  searchParams: {
    q?: string;
    page?: string;
    limit?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    [key: string]: string | undefined;
  };
}

// =============================================================================
// SEARCH TYPES
// =============================================================================

export interface SearchResult {
  id: string;
  type: 'person' | 'place' | 'cat' | 'request';
  title: string;
  subtitle?: string;
  metadata?: SearchResultMetadata;
}

export interface SearchResultMetadata {
  lat?: number;
  lng?: number;
  microchip?: string;
  email?: string;
  phone?: string;
  cat_count?: number;
  status?: string;
}

export interface SearchSuggestion {
  value: string;
  type: 'person' | 'place' | 'cat' | 'request' | 'address';
  metadata?: SearchResultMetadata;
}

// =============================================================================
// INGEST TYPES
// =============================================================================

export interface IngestJobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  source_system: string;
  records_processed: number;
  records_total: number;
  errors: IngestError[];
  started_at: string | null;
  completed_at: string | null;
}

export interface IngestError {
  record_id: string;
  error: string;
  details?: unknown;
}

export interface IngestResult {
  success: boolean;
  job_id: string;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  errors: IngestError[];
}

// =============================================================================
// MERGE TYPES
// =============================================================================

export interface MergePreview {
  winner: {
    id: string;
    display_name: string;
    identifiers_count: number;
    relationships_count: number;
  };
  loser: {
    id: string;
    display_name: string;
    identifiers_count: number;
    relationships_count: number;
  };
  after_merge: {
    identifiers_count: number;
    relationships_count: number;
    conflicts: MergeConflict[];
  };
}

export interface MergeConflict {
  field: string;
  winner_value: string | null;
  loser_value: string | null;
  resolution: 'keep_winner' | 'keep_loser' | 'manual';
}

export interface MergeRequest {
  winner_id: string;
  loser_id: string;
  reason: string;
  conflict_resolutions?: Record<string, 'keep_winner' | 'keep_loser'>;
}

export interface MergeResult {
  success: true;
  merged_id: string;
  identifiers_moved: number;
  relationships_moved: number;
}

// =============================================================================
// GEOCODING TYPES
// =============================================================================

export interface GeocodeRequest {
  address: string;
  components?: {
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface GeocodeResult {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string;
  confidence: number;
  components: {
    house_number?: string;
    street_name?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

// =============================================================================
// DATA QUALITY TYPES
// =============================================================================

export interface DataQualityIssue {
  issue_id: string;
  entity_type: 'person' | 'place' | 'cat';
  entity_id: string;
  issue_type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggested_action: string;
  created_at: string;
  resolved_at: string | null;
}

export interface DataQualitySummary {
  people: {
    total: number;
    good: number;
    needs_review: number;
    garbage: number;
    duplicates_pending: number;
  };
  places: {
    total: number;
    geocoded: number;
    not_geocoded: number;
    duplicates_pending: number;
  };
  cats: {
    total: number;
    with_microchip: number;
    without_microchip: number;
    duplicates_pending: number;
  };
}

// =============================================================================
// HEALTH CHECK TYPES
// =============================================================================

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: ComponentHealth;
    geocoding: ComponentHealth;
    ingest: ComponentHealth;
    data_quality: ComponentHealth;
  };
  timestamp: string;
}

export interface ComponentHealth {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  latency_ms?: number;
}
