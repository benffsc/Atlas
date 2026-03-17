/**
 * Atlas Search Components
 *
 * Barrel export for search-related components.
 * Import from '@/components/search' for cleaner imports.
 */

export { default as EntityPreview } from './EntityPreview';
export { EntityPreviewContent } from './EntityPreviewContent';
export { EntityPreviewModal } from './EntityPreviewModal';

// Re-export types and hook from canonical location (hooks/useEntityDetail)
export { useEntityDetail } from '@/hooks/useEntityDetail';
export type { EntityType, EntityDetail, CatDetail, PersonDetail, PlaceDetail, RequestDetail } from '@/hooks/useEntityDetail';

export { default as GlobalSearch } from './GlobalSearch';
export { GroupedSearchResult } from './GroupedSearchResult';
export { SavedFilters, type RequestFilters } from './SavedFilters';
export { CommandPaletteProvider, useCommandPalette } from './CommandPalette';
