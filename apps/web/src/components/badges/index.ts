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
export { TrapperBadge, TrapperTypePill } from './TrapperBadge';

// Volunteer badges
export { VolunteerBadge } from './VolunteerBadge';

// Cat ID badges
export { AtlasCatIdBadge, AtlasCatIdCompact, AtlasCatIdSuffix, NoAtlasCatId } from './AtlasCatIdBadge';

// Microchip status badges
export { MicrochipStatusBadge, UnknownChipBadge } from './MicrochipStatusBadge';

// Verification badges
export { VerificationBadge, VerificationDot, LastVerified } from './VerificationBadge';

// Data quality badges
export { DataQualityBadge, AIParsedBadge, BeaconBadge, SourceBadge } from './DataQualityBadge';

// Property and place type badges
export { PropertyTypeBadge, getPropertyTypeLabel } from './PropertyTypeBadge';
export type { PropertyType } from './PropertyTypeBadge';
export { PlaceKindBadge, getPlaceKindLabel } from './PlaceKindBadge';
export type { PlaceKind } from './PlaceKindBadge';
