/**
 * Atlas Card Components
 *
 * Barrel export for all card components.
 * Import from '@/components/cards' for cleaner imports.
 *
 * @example
 * import { CatCard, SiteStatsCard } from '@/components/cards';
 */

// Entity cards
export { default as CatCard, CatCard as CatCardComponent } from './CatCard';
export type { CatCardData, CatDisease } from './CatCard';

// Stats cards
export { default as SiteStatsCard } from './SiteStatsCard';
export { AlterationStatsCard } from './AlterationStatsCard';
export { TrapperStatsCard } from './TrapperStatsCard';

// Context cards
export { SeasonalAlertsCard } from './SeasonalAlertsCard';
export { default as HistoricalContextCard } from './HistoricalContextCard';
export { GoogleMapContextCard, PersonPlaceGoogleContext } from './GoogleMapContextCard';

// Workflow cards
export { ReminderCard } from './ReminderCard';
