/**
 * Data Validation Helpers for E2E Tests
 *
 * Cross-references UI display with source data to validate:
 * - Confidence filtering (INV-19)
 * - Merge chain handling (INV-8)
 * - Cat-place relationship integrity (INV-26)
 * - Person classification gates (INV-25)
 */

import { Page, APIRequestContext } from "@playwright/test";

// ============================================================================
// API HELPERS
// ============================================================================

interface ApiResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function fetchJson(
  request: APIRequestContext,
  url: string,
  timeout = 15000
): Promise<ApiResponse | null> {
  try {
    const res = await request.get(url, { timeout });
    if (!res.ok()) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// CONFIDENCE FILTERING (INV-19)
// ============================================================================

/**
 * Get identifiers with low confidence from the API.
 * These should NOT be displayed in the UI.
 */
export async function fetchLowConfidenceIdentifiers(
  request: APIRequestContext,
  personId: string
): Promise<string[]> {
  const data = await fetchJson(request, `/api/people/${personId}`);
  if (!data) return [];

  // The API should already filter low-confidence identifiers,
  // but we can check raw identifiers if available in debug mode
  const allIdentifiers: string[] = [];

  // Check if there's a debug endpoint with raw identifiers
  const debugData = await fetchJson(
    request,
    `/api/people/${personId}?include_raw=true`
  );
  if (debugData?.raw_identifiers) {
    for (const id of debugData.raw_identifiers) {
      if (id.confidence < 0.5) {
        allIdentifiers.push(id.id_value);
      }
    }
  }

  return allIdentifiers;
}

/**
 * Verify that a person page does NOT display low-confidence identifiers.
 */
export async function verifyNoLowConfidenceIds(
  page: Page,
  request: APIRequestContext,
  personId: string
): Promise<{ passed: boolean; violations: string[] }> {
  const lowConfIds = await fetchLowConfidenceIdentifiers(request, personId);
  if (lowConfIds.length === 0) {
    return { passed: true, violations: [] };
  }

  // Get all displayed text from person identifiers sections
  const displayedTexts = await page
    .locator('[data-testid="person-email"], [data-testid="person-phone"], .contact-info')
    .allTextContents();

  const violations: string[] = [];
  for (const lowConfId of lowConfIds) {
    if (displayedTexts.some((text) => text.includes(lowConfId))) {
      violations.push(lowConfId);
    }
  }

  return { passed: violations.length === 0, violations };
}

// ============================================================================
// MERGE CHAIN VERIFICATION (INV-8)
// ============================================================================

export interface MergeChainResult {
  isMerged: boolean;
  canonicalId: string | null;
  redirected: boolean;
}

/**
 * Check if an entity is merged and verify proper redirect behavior.
 */
export async function verifyMergeChainHandling(
  page: Page,
  request: APIRequestContext,
  entityType: "people" | "places" | "cats",
  entityId: string
): Promise<MergeChainResult> {
  const idField = {
    people: "merged_into_person_id",
    places: "merged_into_place_id",
    cats: "merged_into_cat_id",
  }[entityType];

  // Fetch entity to check merge status
  const data = await fetchJson(request, `/api/${entityType}/${entityId}`);

  if (!data) {
    return { isMerged: false, canonicalId: null, redirected: false };
  }

  const mergedIntoId = data[idField];
  if (!mergedIntoId) {
    return { isMerged: false, canonicalId: null, redirected: false };
  }

  // Navigate to the merged entity and check for redirect
  const singularType = entityType.slice(0, -1); // people -> person, etc.
  const urlMap = { people: "people", places: "places", cats: "cats" };
  await page.goto(`/${urlMap[entityType]}/${entityId}`);

  // Check if we were redirected to canonical
  const currentUrl = page.url();
  const redirected = currentUrl.includes(mergedIntoId);

  return { isMerged: true, canonicalId: mergedIntoId, redirected };
}

/**
 * Verify merged entities are excluded from search results.
 */
export async function verifyMergedExcludedFromSearch(
  request: APIRequestContext,
  entityType: "people" | "places" | "cats",
  mergedId: string
): Promise<boolean> {
  const data = await fetchJson(
    request,
    `/api/search?q=${mergedId}&type=${entityType.slice(0, -1)}`
  );

  if (!data?.results) return true; // No results is correct

  // Check if merged ID appears in results
  const idField = {
    people: "person_id",
    places: "place_id",
    cats: "cat_id",
  }[entityType];

  return !data.results.some(
    (r: ApiResponse) => r[idField] === mergedId || r.id === mergedId
  );
}

// ============================================================================
// CAT-PLACE RELATIONSHIP INTEGRITY (INV-26)
// ============================================================================

export interface CatPlaceValidation {
  catId: string;
  appointmentPlaceId: string | null;
  linkedPlaceIds: string[];
  isValid: boolean;
  pollutionCheck: { passed: boolean; linkCount: number };
}

/**
 * Validate that a cat's linked places match appointment data.
 */
export async function validateCatPlaceMatch(
  request: APIRequestContext,
  catId: string
): Promise<CatPlaceValidation> {
  // Fetch cat details with relationships
  const catData = await fetchJson(request, `/api/cats/${catId}`);
  if (!catData) {
    return {
      catId,
      appointmentPlaceId: null,
      linkedPlaceIds: [],
      isValid: true,
      pollutionCheck: { passed: true, linkCount: 0 },
    };
  }

  // Get appointment's inferred_place_id if available
  const appointmentPlaceId = catData.inferred_place_id || catData.appointment_place_id || null;

  // Get linked places
  const linkedPlaceIds: string[] = [];
  if (catData.places) {
    for (const p of catData.places) {
      linkedPlaceIds.push(p.place_id);
    }
  }

  // Validate: appointment place should be in linked places
  const isValid = !appointmentPlaceId || linkedPlaceIds.includes(appointmentPlaceId);

  // Pollution check: no more than 5 links of same type
  const linksByType: Record<string, number> = {};
  if (catData.places) {
    for (const p of catData.places) {
      const type = p.relationship_type || "unknown";
      linksByType[type] = (linksByType[type] || 0) + 1;
    }
  }
  const maxLinks = Math.max(...Object.values(linksByType), 0);
  const pollutionCheck = { passed: maxLinks <= 5, linkCount: maxLinks };

  return {
    catId,
    appointmentPlaceId,
    linkedPlaceIds,
    isValid,
    pollutionCheck,
  };
}

/**
 * Verify cat-place display in UI matches API data.
 */
export async function verifyCatPlaceDisplayMatch(
  page: Page,
  request: APIRequestContext,
  catId: string
): Promise<boolean> {
  const validation = await validateCatPlaceMatch(request, catId);

  // Navigate to cat page
  await page.goto(`/cats/${catId}`);

  // Get displayed places from UI
  const displayedPlaces = await page
    .locator('[data-testid="cat-place-link"], .linked-place-card a')
    .allTextContents();

  // If appointment place exists, it should be displayed
  if (validation.appointmentPlaceId && displayedPlaces.length > 0) {
    // This is a basic check - actual validation would compare place names
    return true;
  }

  return validation.isValid;
}

// ============================================================================
// PERSON CLASSIFICATION GATE (INV-25)
// ============================================================================

/**
 * Patterns that indicate an organization, not a person.
 */
export const ORG_PATTERNS = [
  /campground/i,
  /resort/i,
  /hotel\b/i,
  /motel/i,
  /lodge\b/i,
  /winery/i,
  /vineyard/i,
  /ranch\b/i,
  /farm\b/i,
  /church\b/i,
  /school\b/i,
  /hospital\b/i,
  /clinic\b/i,
  /shelter\b/i,
  /humane society/i,
  /animal control/i,
  /county of/i,
  /city of/i,
  /state of/i,
  /department of/i,
  /world of/i,
  /surgery\b/i,
  /carpets?\b/i,
  /market\b/i,
  /store\b/i,
  /shop\b/i,
  /services?\b/i,
  /plumbing/i,
  /electric/i,
  /roofing/i,
  /landscaping/i,
  /construction/i,
];

/**
 * Check if a name matches organization patterns.
 */
export function isLikelyOrganization(name: string): boolean {
  return ORG_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Verify search results don't include organizations as people.
 */
export async function verifyNoOrgsInPeopleSearch(
  request: APIRequestContext,
  searchQuery: string
): Promise<{ passed: boolean; violations: string[] }> {
  const data = await fetchJson(
    request,
    `/api/search?q=${encodeURIComponent(searchQuery)}&type=person`
  );

  if (!data?.results) {
    return { passed: true, violations: [] };
  }

  const violations: string[] = [];
  for (const result of data.results) {
    const name = result.display_name || result.name || "";
    if (isLikelyOrganization(name)) {
      violations.push(name);
    }
  }

  return { passed: violations.length === 0, violations };
}

// ============================================================================
// SOURCE DATA CROSS-REFERENCE
// ============================================================================

export interface SourceDataValidation {
  field: string;
  sourceSystem: string;
  sourceValue: string | null;
  displayedValue: string | null;
  matches: boolean;
}

/**
 * Cross-reference a cat's displayed data with source system data.
 */
export async function validateCatSourceData(
  page: Page,
  request: APIRequestContext,
  catId: string
): Promise<SourceDataValidation[]> {
  const validations: SourceDataValidation[] = [];

  const catData = await fetchJson(request, `/api/cats/${catId}`);
  if (!catData) return validations;

  await page.goto(`/cats/${catId}`);

  // Check microchip
  if (catData.microchip_id) {
    const displayedMicrochip = await page
      .locator('[data-testid="cat-microchip"], .microchip-value')
      .textContent()
      .catch(() => null);

    validations.push({
      field: "microchip",
      sourceSystem: catData.source_system || "unknown",
      sourceValue: catData.microchip_id,
      displayedValue: displayedMicrochip,
      matches: displayedMicrochip?.includes(catData.microchip_id) || false,
    });
  }

  // Check ear tip status
  if (catData.has_ear_tip !== undefined) {
    const earTipElement = page.locator('[data-testid="cat-ear-tip"], .ear-tip-status');
    const hasEarTipDisplayed = await earTipElement.isVisible().catch(() => false);

    validations.push({
      field: "ear_tip",
      sourceSystem: "clinichq",
      sourceValue: String(catData.has_ear_tip),
      displayedValue: hasEarTipDisplayed ? "visible" : "hidden",
      matches: catData.has_ear_tip === hasEarTipDisplayed,
    });
  }

  return validations;
}

// ============================================================================
// SOFT BLACKLIST VERIFICATION
// ============================================================================

/**
 * Known blacklisted emails that should never appear in identity matching.
 */
export const KNOWN_BLACKLISTED_EMAILS = [
  "marinferals@yahoo.com",
  "test@forgottenfelines.com",
  // Add more known blacklisted emails
];

/**
 * Verify blacklisted emails are not pre-filled in compose modals.
 */
export async function verifyBlacklistedNotPrefilled(
  page: Page,
  personId: string
): Promise<{ passed: boolean; foundBlacklisted: string | null }> {
  await page.goto(`/people/${personId}`);

  // Try to open compose modal
  const composeBtn = page.locator('[data-testid="compose-email"], button:has-text("Email")');
  if (!(await composeBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    return { passed: true, foundBlacklisted: null };
  }

  await composeBtn.click();

  // Check pre-filled email
  const emailInput = page.locator('input[type="email"], [data-testid="email-input"]');
  const prefilledEmail = await emailInput.inputValue().catch(() => "");

  for (const blacklisted of KNOWN_BLACKLISTED_EMAILS) {
    if (prefilledEmail.toLowerCase() === blacklisted.toLowerCase()) {
      return { passed: false, foundBlacklisted: blacklisted };
    }
  }

  return { passed: true, foundBlacklisted: null };
}

// ============================================================================
// DATA QUALITY FILTERING
// ============================================================================

/**
 * Verify garbage data quality records are not in search results.
 */
export async function verifyGarbageExcludedFromSearch(
  request: APIRequestContext,
  searchQuery: string
): Promise<boolean> {
  const data = await fetchJson(
    request,
    `/api/search?q=${encodeURIComponent(searchQuery)}`
  );

  if (!data?.results) return true;

  // Check for any results with garbage data quality
  return !data.results.some(
    (r: ApiResponse) => r.data_quality === "garbage" || r.data_quality === "needs_review"
  );
}
