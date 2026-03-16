/**
 * Atlas Badge Components
 * Barrel export for all badge components.
 *
 * Usage:
 *   import { StatusBadge, PriorityBadge, TrapperBadge } from '@/components/badges';
 */

// Status and priority badges
export { StatusBadge, PriorityBadge, PriorityDot } from './StatusBadge';

// Trapper badges
export { TrapperBadge, TrapperTierBadge, TrapperTypePill } from './TrapperBadge';

// Volunteer badges
export { VolunteerBadge } from './VolunteerBadge';

// Cat ID badges
export { AtlasCatIdBadge, AtlasCatIdCompact, AtlasCatIdSuffix, NoAtlasCatId } from './AtlasCatIdBadge';

// Microchip status badges
export { MicrochipStatusBadge, UnknownChipBadge } from './MicrochipStatusBadge';

// Verification badges
export { VerificationBadge, VerificationDot, LastVerified } from './VerificationBadge';

// General-purpose badge
export { Badge } from './Badge';

// Data quality badges
export { DataQualityBadge, AIParsedBadge, BeaconBadge, SourceBadge } from './DataQualityBadge';

// Cat health badges
export { CatHealthBadges, buildHealthFlags } from './CatHealthBadges';
export type { HealthFlag, CatHealthBadgesProps, CatHealthData } from './CatHealthBadges';

// Place risk badges
export { PlaceRiskBadges } from './PlaceRiskBadges';
export type { DiseaseFlag, PlaceRiskBadgesProps } from './PlaceRiskBadges';

// Person status badges
export { PersonStatusBadges } from './PersonStatusBadges';
export type { PersonStatusBadgesProps } from './PersonStatusBadges';

// Property and place type badges
export { PropertyTypeBadge, getPropertyTypeLabel } from './PropertyTypeBadge';
export type { PropertyType } from './PropertyTypeBadge';
export { PlaceKindBadge, getPlaceKindLabel } from './PlaceKindBadge';
export type { PlaceKind } from './PlaceKindBadge';
