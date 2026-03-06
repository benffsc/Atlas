/**
 * Atlas Search Components
 *
 * Barrel export for search-related components.
 * Import from '@/components/search' for cleaner imports.
 */

export { default as EntityPreview } from './EntityPreview';
export { EntityPreviewContent, useEntityDetail } from './EntityPreviewContent';
export type { EntityType, EntityDetail, CatDetail, PersonDetail, PlaceDetail, RequestDetail } from './EntityPreviewContent';
export { EntityPreviewModal } from './EntityPreviewModal';
export { default as GlobalSearch } from './GlobalSearch';
export { GroupedSearchResult } from './GroupedSearchResult';
export { SavedFilters, type RequestFilters } from './SavedFilters';
