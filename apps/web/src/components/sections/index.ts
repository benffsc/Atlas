/**
 * Atlas Section Components
 *
 * Barrel export for section components that display entity relationships.
 * Import from '@/components/sections' for cleaner imports.
 */

export { CaseSection } from './CaseSection';
export { CatMovementSection } from './CatMovementSection';
export { default as ClinicHistorySection } from './ClinicHistorySection';
export { default as ClinicNotesSection } from './ClinicNotesSection';
export { default as DiseaseStatusSection } from './DiseaseStatusSection';
export { default as JournalSection } from './JournalSection';
export type { JournalEntry } from './JournalSection';
export { LinkedCatsSection } from './LinkedCatsSection';
export { LinkedPeopleSection } from './LinkedPeopleSection';
export { LinkedPlacesSection } from './LinkedPlacesSection';
export { default as ObservationsSection } from './ObservationsSection';
export { PlaceLinksSection } from './PlaceLinksSection';
export { TrapperAssignments } from './TrapperAssignments';

// Trapper detail sections (Phase 3 extraction)
export { AssignmentHistorySection } from './AssignmentHistorySection';
export { ChangeHistorySection } from './ChangeHistorySection';
export { ContractHistorySection } from './ContractHistorySection';
export { ContractProfileSection } from './ContractProfileSection';
export { ManualCatchesSection } from './ManualCatchesSection';
export { PerformanceBannerSection } from './PerformanceBannerSection';
export { ServiceAreasSection } from './ServiceAreasSection';
