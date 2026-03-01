/**
 * Atlas Modal Components
 *
 * Barrel export for all modal components.
 * Import from '@/components/modals' for cleaner imports.
 *
 * @example
 * import { CompleteRequestModal, SendEmailModal } from '@/components/modals';
 */

// Request workflow modals
export { default as CompleteRequestModal } from './CompleteRequestModal';
export { default as HoldRequestModal } from './HoldRequestModal';
export { RedirectRequestModal } from './RedirectRequestModal';
export { HandoffRequestModal } from './HandoffRequestModal';
export { default as ArchiveRequestModal } from './ArchiveRequestModal';

// Communication modals
export { SendEmailModal } from './SendEmailModal';
export { TippyFeedbackModal } from './TippyFeedbackModal';

// Data entry modals
export { default as ClinicHQUploadModal } from './ClinicHQUploadModal';
export { default as CreateColonyModal } from './CreateColonyModal';
export { default as LogSiteVisitModal } from './LogSiteVisitModal';
export { default as LogObservationModal } from './LogObservationModal';
export { TripReportModal } from './TripReportModal';
export { default as RecordBirthModal } from './RecordBirthModal';
export { default as ReportDeceasedModal } from './ReportDeceasedModal';

// Detail view modals
export { default as AppointmentDetailModal } from './AppointmentDetailModal';
export { LookupViewerModal } from './LookupViewerModal';
export { default as DeclineIntakeModal } from './DeclineIntakeModal';
