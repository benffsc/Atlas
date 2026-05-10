/**
 * Data Masking Library
 *
 * Provides functions to mask personally identifiable information (PII)
 * for volunteer users who shouldn't see full contact details.
 */

/**
 * Mask an email address
 * "john.smith@example.com" -> "j***@example.com"
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;

  const parts = email.split("@");
  if (parts.length !== 2) return "***@***.***";

  const [local, domain] = parts;
  const maskedLocal =
    local.length > 1
      ? local[0] + "***"
      : "***";

  return `${maskedLocal}@${domain}`;
}

/**
 * Mask a phone number
 * "707-555-1234" -> "707-***-**34"
 * Preserves area code and last 2 digits for some context
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove all non-digits
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 7) return "***-****";

  // US phone: show area code and last 2 digits
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-***-**${digits.slice(-2)}`;
  }

  if (digits.length === 11 && digits[0] === "1") {
    return `${digits.slice(1, 4)}-***-**${digits.slice(-2)}`;
  }

  // Other formats: just show last 2 digits
  return `***-***-**${digits.slice(-2)}`;
}

/**
 * Mask a street address
 * "123 Main St, Santa Rosa, CA 95401" -> "*** Main St, Santa Rosa, CA 95401"
 * Preserves street name and city for context, masks house number
 */
export function maskAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  // Replace leading numbers (house/building number) with ***
  return address.replace(/^\d+(-\d+)?(\s|$)/, "*** ");
}

/**
 * Mask a full name
 * "John Smith" -> "J. S."
 */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;

  const parts = name.trim().split(/\s+/);
  return parts.map((part) => part[0]?.toUpperCase() + ".").join(" ");
}

/**
 * Mask an address to neighborhood level (for showcase/presentation mode).
 * "123 Main St, Santa Rosa, CA 95401" -> "Main St area, Santa Rosa"
 * "5403 San Antonio Road" -> "San Antonio Road area"
 * Shows the street name and city but hides the house number and zip.
 */
export function maskAddressToNeighborhood(
  address: string | null | undefined
): string | null {
  if (!address) return null;

  // Split into parts by comma
  const parts = address.split(",").map((p) => p.trim());

  // Extract street part (first segment) — remove leading numbers
  let street = parts[0].replace(/^\d+(-\d+)?\s*/, "").trim();

  // If the street is empty after removing numbers, use original
  if (!street) street = parts[0];

  // Extract city (second segment, if it doesn't look like state/zip)
  let city = "";
  if (parts.length >= 2) {
    const candidate = parts[1];
    if (candidate && !candidate.match(/^(CA|California)\s*\d/i) && !candidate.match(/^\d/)) {
      city = candidate;
    }
  }

  if (city) {
    return `${street} area, ${city}`;
  }
  return `${street} area`;
}

/**
 * Entity types that can be masked
 */
export type MaskableEntityType =
  | "person"
  | "request"
  | "submission"
  | "appointment";

/**
 * Mask PII fields in an entity based on type
 * Returns a new object with masked fields
 */
export function maskEntityForVolunteer<T extends Record<string, unknown>>(
  data: T,
  entityType: MaskableEntityType
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masked: any = { ...data };

  switch (entityType) {
    case "person":
      // Mask person contact info
      if ("primary_email" in masked) {
        masked.primary_email = maskEmail(masked.primary_email);
      }
      if ("email" in masked) {
        masked.email = maskEmail(masked.email);
      }
      if ("primary_phone" in masked) {
        masked.primary_phone = maskPhone(masked.primary_phone);
      }
      if ("phone" in masked) {
        masked.phone = maskPhone(masked.phone);
      }
      if ("address" in masked) {
        masked.address = maskAddress(masked.address);
      }
      if ("secondary_email" in masked) {
        masked.secondary_email = maskEmail(masked.secondary_email);
      }
      if ("secondary_phone" in masked) {
        masked.secondary_phone = maskPhone(masked.secondary_phone);
      }
      break;

    case "request":
      // Mask requester info in request
      if ("requester_email" in masked) {
        masked.requester_email = maskEmail(masked.requester_email);
      }
      if ("requester_phone" in masked) {
        masked.requester_phone = maskPhone(masked.requester_phone);
      }
      if ("contact_email" in masked) {
        masked.contact_email = maskEmail(masked.contact_email);
      }
      if ("contact_phone" in masked) {
        masked.contact_phone = maskPhone(masked.contact_phone);
      }
      break;

    case "submission":
      // Mask intake submission info
      if ("email" in masked) {
        masked.email = maskEmail(masked.email);
      }
      if ("phone" in masked) {
        masked.phone = maskPhone(masked.phone);
      }
      if ("submitter_name" in masked) {
        masked.submitter_name = maskName(masked.submitter_name);
      }
      if ("cats_address" in masked) {
        masked.cats_address = maskAddress(masked.cats_address);
      }
      break;

    case "appointment":
      // Mask appointment owner info
      if ("owner_email" in masked) {
        masked.owner_email = maskEmail(masked.owner_email);
      }
      if ("owner_phone" in masked) {
        masked.owner_phone = maskPhone(masked.owner_phone);
      }
      break;
  }

  return masked as T;
}

/**
 * Mask an array of entities
 */
export function maskEntitiesForVolunteer<T extends Record<string, unknown>>(
  data: T[],
  entityType: MaskableEntityType
): T[] {
  return data.map((item) => maskEntityForVolunteer(item, entityType));
}

/**
 * Helper to determine if masking is needed based on auth role
 */
export function shouldMaskForRole(
  authRole: "admin" | "staff" | "volunteer" | undefined
): boolean {
  return authRole === "volunteer";
}
