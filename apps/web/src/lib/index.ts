/**
 * Lib Barrel Export
 *
 * Centralized exports for commonly used utilities.
 * Import as: import { formatPhone, COLORS, isValidUUID } from '@/lib';
 */

// Formatters
export {
  formatDateLocal,
  formatDateTime,
  formatRelativeDate,
  isValidPhone,
  extractPhone,
  extractPhones,
  formatPhoneAsYouType,
  formatPhone,
  truncate,
  formatCurrency,
  formatNumber,
  formatAddress,
} from "./formatters";

// Constants
export {
  DATA_QUALITY_LABELS,
  SOURCE_SYSTEM_LABELS,
  SOURCE_SYSTEM_COLORS,
  SOFT_BLACKLIST_EMAILS,
  SOFT_BLACKLIST_PHONES,
  FAKE_EMAIL_DOMAINS,
  TRAPPER_TYPE_LABELS,
  isFFSCTrapper,
  VOLUNTEER_ROLE_LABELS,
  ALTERED_STATUS_LABELS,
  type DataQuality,
  type SourceSystem,
  type TrapperType,
  type VolunteerRole,
  type AlteredStatus,
} from "./constants";

// Enums
export {
  REQUEST_STATUS,
  REQUEST_PRIORITY,
  HOLD_REASON,
  NO_TRAPPER_REASON,
  PERMISSION_STATUS,
  COLONY_DURATION,
  COUNT_CONFIDENCE,
  EARTIP_ESTIMATE,
  PROPERTY_TYPE,
  PERSON_ENTITY_TYPE,
  TRAPPING_SKILL,
  TRAPPER_TYPE,
  PERSON_PLACE_ROLE,
  PLACE_KIND,
  DEATH_CAUSE,
} from "./enums";

// Guards & Validation
export {
  shouldBePerson,
  classifyOwnerName,
  isValidMicrochip,
  isPositiveValue,
  isValidUUID,
  isFabricatedEmail,
  meetsConfidenceThreshold,
  type NameClassification,
  type PersonValidationResult,
  type PersonRejectionResult,
  type ShouldBePersonResult,
} from "./guards";

// API Response Helpers
export {
  apiSuccess,
  apiError,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
  apiConflict,
  apiUnprocessable,
  type PaginationMeta,
  type ApiSuccessResponse,
  type ApiErrorResponse,
} from "./api-response";

// API Validation
export {
  requireValidUUID,
  parsePagination,
  requireValidEnum,
  validateEnumIfProvided,
  withErrorHandling,
  requireField,
  requireNonEmptyString,
} from "./api-validation";

// Design Tokens
export {
  COLORS,
  getStatusColor,
  SPACING,
  TYPOGRAPHY,
  BORDERS,
  SHADOWS,
  Z_INDEX,
  TRANSITIONS,
  REQUEST_STATUS_COLORS,
  getRequestStatusColor,
  ENTITY_COLORS,
  getEntityColor,
  type StatusColorSet,
} from "./design-tokens";

// UUID utilities
export { generateUUID } from "./uuid";
