/**
 * Atlas Component Library
 *
 * Central barrel export for all organized components.
 * Import components from their respective subdirectories for best tree-shaking,
 * or import from here for convenience.
 *
 * @example
 * // Best practice - import from subdirectory:
 * import { StatusBadge, PriorityBadge } from '@/components/badges';
 * import { CatCard, SiteStatsCard } from '@/components/cards';
 *
 * // Or import from root barrel:
 * import { StatusBadge, CatCard } from '@/components';
 */

// Admin components (data quality, data engine, geocoding)
export * from './admin';

// Badge components (status, priority, verification, etc.)
export * from './badges';

// Card components (entity cards, stats cards, context cards)
export * from './cards';

// Chart/visualization components (colony estimates, population trends)
export * from './charts';

// Common utility components (back button, edit history, entity link, etc.)
export * from './common';

// Data quality components
export * from './data-quality';

// Feedback components
export * from './feedback';

// Form components (address autocomplete, place resolver, wizards)
export * from './forms';

// Layout components (two-column, sections, sidebars)
// Note: StatItem is also exported from reviews, use explicit import if needed
export {
  TwoColumnLayout,
  Section,
  StatsSidebar,
  StatRow,
  type StatItem as LayoutStatItem
} from './layouts';

// Map components (atlas map, drawers, controls)
export * from './map';

// Media components (gallery, uploader, lightbox)
export * from './media';

// Modal components (request workflows, data entry, detail views)
export * from './modals';

// Request entry components
export * from './request-entry';

// Review components
export * from './reviews';

// Search components (global search, entity preview)
export * from './search';

// Section components (journal, linked entities, clinic history)
export * from './sections';

// Timeline components
export * from './timeline';

// Verification components
export * from './verification';

// App-level components (kept at root)
export { AppShell } from './AppShell';
export { default as PasswordGate } from './PasswordGate';
export { ProfileLayout } from './ProfileLayout';
export { SidebarLayout, mainSidebarSections, AdminSidebar, MainSidebar, RequestsSidebar, CatsSidebar, PeopleSidebar, PlacesSidebar, IntakeSidebar, TrappersSidebar, type NavSection } from './SidebarLayout';
export { TippyChat } from './TippyChat';
