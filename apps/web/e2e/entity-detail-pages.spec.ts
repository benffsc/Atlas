/**
 * Entity Detail Pages — Smoke & API Contract Tests
 *
 * Verifies that cat, person, and place detail pages:
 * 1. Load without errors
 * 2. Display expected header content
 * 3. Render TabBar with correct tabs
 * 4. Show relevant sections and data
 * 5. API endpoints return valid structures
 *
 * All tests are READ-ONLY (no mutations). Uses findRealEntity to get
 * real entity IDs from the database — no hardcoded UUIDs.
 *
 * Run: npm run test:e2e -- e2e/entity-detail-pages.spec.ts
 */

import { test, expect } from "@playwright/test";
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForLoaded,
  switchToTabBarTab,
  expectTabBarVisible,
} from "./ui-test-helpers";

// ============================================================================
// CAT DETAIL PAGE
// ============================================================================

test.describe("Cat Detail Page @smoke", () => {
  test.setTimeout(60000);

  let catId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await mockAllWrites(page);
    catId = await findRealEntity(request, "cats");
  });

  test("page loads without error", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Should not show error states
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("Cat not found");
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("Failed to fetch");
  });

  test("header shows cat name or display_name", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    const nameText = await h1.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  test("TabBar tabs are present (Overview, Medical, Connections)", async ({
    page,
  }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Cat detail uses tabs: Overview, Medical, Connections
    const expectedTabs = ["Overview", "Medical", "Connections"];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabButton = page
        .locator(`[role="tab"]:has-text("${tab}")`)
        .first();
      if (
        await tabButton
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        foundTabs++;
      }
    }
    // Should find at least 2 of the 3 tabs
    expect(foundTabs).toBeGreaterThanOrEqual(2);
  });

  test("clicking each tab shows content", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Switch to Medical tab
    const medicalTab = page
      .locator('[role="tab"]:has-text("Medical")')
      .first();
    if (await medicalTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchToTabBarTab(page, "Medical");
      // Medical tab should show appointment or test result content
      const mainContent = await page.locator("main").last().textContent();
      const hasMedicalContent =
        mainContent?.includes("Appointment") ||
        mainContent?.includes("Test") ||
        mainContent?.includes("FeLV") ||
        mainContent?.includes("FIV") ||
        mainContent?.includes("No appointments") ||
        mainContent?.includes("No medical") ||
        mainContent?.includes("Weight") ||
        mainContent?.includes("Procedure");
      expect(hasMedicalContent).toBeTruthy();
    }

    // Switch to Connections tab
    const connectionsTab = page
      .locator('[role="tab"]:has-text("Connections")')
      .first();
    if (
      await connectionsTab.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await switchToTabBarTab(page, "Connections");
      const mainContent = await page.locator("main").last().textContent();
      const hasConnectionsContent =
        mainContent?.includes("People") ||
        mainContent?.includes("Places") ||
        mainContent?.includes("Owner") ||
        mainContent?.includes("person") ||
        mainContent?.includes("place") ||
        mainContent?.includes("No linked") ||
        mainContent?.includes("Transfer");
      expect(hasConnectionsContent).toBeTruthy();
    }
  });

  test("microchip displays if present", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const bodyText = await page.locator("body").textContent();
    // Should show either a microchip number or an em-dash (meaning no chip)
    // or the "No Microchip" alert
    const hasMicrochipSection =
      bodyText?.includes("Microchip") || bodyText?.includes("No Microchip");
    expect(hasMicrochipSection).toBeTruthy();
  });

  test("altered status badge visible", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const bodyText = await page.locator("body").textContent();
    const alteredKeywords = [
      "Altered",
      "Spayed",
      "Neutered",
      "Intact",
      "Unknown",
      "Yes",
      "No",
      "Ear-tipped",
    ];
    const hasAlteredInfo = alteredKeywords.some((k) =>
      bodyText?.includes(k)
    );
    expect(hasAlteredInfo).toBeTruthy();
  });

  test("linked places section renders", async ({ page }) => {
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Sidebar shows Places stat
    const bodyText = await page.locator("body").textContent();
    const hasPlacesReference =
      bodyText?.includes("Places") || bodyText?.includes("place");
    expect(hasPlacesReference).toBeTruthy();
  });
});

// ============================================================================
// PERSON DETAIL PAGE
// ============================================================================

test.describe("Person Detail Page @smoke", () => {
  test.setTimeout(60000);

  let personId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await mockAllWrites(page);
    personId = await findRealEntity(request, "people");
  });

  test("page loads without error", async ({ page }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("Person not found");
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("Failed to fetch");
  });

  test("header shows person name", async ({ page }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // PersonDetailShell renders display_name via EntityHeader
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    const nameText = await h1.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  test("TabBar tabs are present (Overview, Details, History, Admin)", async ({
    page,
  }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Person base tabs: Overview, Details, History, Admin
    const expectedTabs = ["Overview", "Details", "History", "Admin"];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabButton = page
        .locator(`[role="tab"]:has-text("${tab}")`)
        .first();
      if (
        await tabButton
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        foundTabs++;
      }
    }
    // Should find at least 3 of the 4 base tabs
    expect(foundTabs).toBeGreaterThanOrEqual(3);
  });

  test("contact info section displays (phone or email)", async ({ page }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const bodyText = await page.locator("body").textContent();

    // Sidebar Contact section shows phone, email, or "Not available"
    const hasEmail = bodyText?.includes("@");
    const hasPhone = /\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/.test(bodyText || "");
    const hasNoContact = /not available/i.test(bodyText || "");
    const hasContactSection =
      bodyText?.includes("Phone") ||
      bodyText?.includes("Email") ||
      bodyText?.includes("Contact");

    expect(
      hasEmail || hasPhone || hasNoContact || hasContactSection
    ).toBeTruthy();
  });

  test("linked entities section renders (cats or places)", async ({
    page,
  }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Sidebar stats show Cats and Places counts
    const bodyText = await page.locator("body").textContent();
    const hasLinkedEntities =
      bodyText?.includes("Cats") || bodyText?.includes("Places");
    expect(hasLinkedEntities).toBeTruthy();
  });

  test("role badges display if person has roles", async ({ page }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Role badges (TrapperBadge, VolunteerBadge) or general person info
    // should be visible. Even without roles, the page should render.
    const bodyText = await page.locator("body").textContent();
    const hasRoleOrInfo =
      bodyText?.includes("Trapper") ||
      bodyText?.includes("Volunteer") ||
      bodyText?.includes("Foster") ||
      bodyText?.includes("Staff") ||
      bodyText?.includes("Record Info") ||
      bodyText?.includes("Source");
    expect(hasRoleOrInfo).toBeTruthy();
  });

  test("switching to Details tab shows clinic history or location context", async ({
    page,
  }) => {
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const detailsTab = page
      .locator('[role="tab"]:has-text("Details")')
      .first();
    if (
      await detailsTab.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await switchToTabBarTab(page, "Details");
      const mainContent = await page.locator("main").last().textContent();
      const hasDetailsContent =
        mainContent?.includes("Clinic History") ||
        mainContent?.includes("Location") ||
        mainContent?.includes("Journal") ||
        mainContent?.includes("Related People") ||
        mainContent?.includes("No clinic") ||
        mainContent?.includes("appointment");
      expect(hasDetailsContent).toBeTruthy();
    }
  });
});

// ============================================================================
// PLACE DETAIL PAGE
// ============================================================================

test.describe("Place Detail Page @smoke", () => {
  test.setTimeout(60000);

  let placeId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await mockAllWrites(page);
    placeId = await findRealEntity(request, "places");
  });

  test("page loads without error", async ({ page }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("Place not found");
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("Failed to fetch");
  });

  test("header shows address or display_name", async ({ page }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    const headingText = await h1.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("TabBar tabs are present (Details, Requests, Ecology, Media)", async ({
    page,
  }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Place tabs: Details, Requests, Ecology, Media
    const expectedTabs = ["Details", "Requests", "Ecology", "Media"];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabButton = page
        .locator(`[role="tab"]:has-text("${tab}")`)
        .first();
      if (
        await tabButton
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        foundTabs++;
      }
    }
    // Should find at least 3 of the 4 tabs
    expect(foundTabs).toBeGreaterThanOrEqual(3);
  });

  test("cat presence section renders", async ({ page }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Place page shows LinkedCatsSection or "No cats" / cat count in sidebar
    const bodyText = await page.locator("body").textContent();
    const hasCatSection =
      bodyText?.includes("Cats") ||
      bodyText?.includes("cats") ||
      bodyText?.includes("No cats") ||
      bodyText?.includes("Cat Activity");
    expect(hasCatSection).toBeTruthy();
  });

  test("map link or map container renders", async ({ page }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Place header has "View on Map" button linking to /map with coordinates
    const viewOnMap = page.locator('a:has-text("View on Map")').first();
    const hasMapLink = await viewOnMap
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Also check for Location sidebar section with coordinates
    const bodyText = await page.locator("body").textContent();
    const hasLocationInfo =
      bodyText?.includes("Location") ||
      bodyText?.includes("Geocoded") ||
      bodyText?.includes("City");

    expect(hasMapLink || hasLocationInfo).toBeTruthy();
  });

  test("colony estimate or TNR stats visible", async ({ page }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Sidebar has Colony Size, Disease Status, and TNR Progress sections
    const bodyText = await page.locator("body").textContent();
    const hasColonyInfo =
      bodyText?.includes("Colony Size") ||
      bodyText?.includes("TNR") ||
      bodyText?.includes("Population") ||
      bodyText?.includes("Disease") ||
      bodyText?.includes("Estimate");
    expect(hasColonyInfo).toBeTruthy();
  });

  test("Ecology tab shows population data or empty state", async ({
    page,
  }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const ecologyTab = page
      .locator('[role="tab"]:has-text("Ecology")')
      .first();
    if (
      await ecologyTab.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await switchToTabBarTab(page, "Ecology");
      const mainContent = await page.locator("main").last().textContent();
      const hasEcologyContent =
        mainContent?.includes("TNR") ||
        mainContent?.includes("Population") ||
        mainContent?.includes("Readiness") ||
        mainContent?.includes("Lifecycle") ||
        mainContent?.includes("Observation") ||
        mainContent?.includes("No data") ||
        mainContent?.includes("Trend");
      expect(hasEcologyContent).toBeTruthy();
    }
  });

  test("Requests tab shows related requests or create link", async ({
    page,
  }) => {
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const requestsTab = page
      .locator('[role="tab"]:has-text("Requests")')
      .first();
    if (
      await requestsTab.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await switchToTabBarTab(page, "Requests");
      const mainContent = await page.locator("main").last().textContent();
      const hasRequestsContent =
        mainContent?.includes("Related Requests") ||
        mainContent?.includes("No requests") ||
        mainContent?.includes("Create Request") ||
        mainContent?.includes("Website Submissions");
      expect(hasRequestsContent).toBeTruthy();
    }
  });
});

// ============================================================================
// API CONTRACT TESTS
// ============================================================================

test.describe("Entity Detail API Contracts @api", () => {
  test.setTimeout(60000);

  test("GET /api/cats/[id] returns valid structure", async ({
    page,
    request,
  }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    // Use page.request for authenticated context
    const res = await page.request.get(`/api/cats/${catId}`);
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    // Should have core cat fields
    expect(data.cat_id || data.cat?.cat_id).toBeTruthy();
  });

  test("GET /api/people/[id] returns valid structure", async ({
    page,
    request,
  }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    const res = await page.request.get(`/api/people/${personId}`);
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    // Should have core person fields
    expect(data.person_id || data.person?.person_id).toBeTruthy();
  });

  test("GET /api/places/[id] returns valid structure", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    const res = await page.request.get(`/api/places/${placeId}`);
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    // Should have core place fields
    expect(data.place_id || data.place?.place_id).toBeTruthy();
  });

  test("GET /api/cats/[id]/map-details returns valid structure", async ({
    page,
    request,
  }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    const res = await page.request.get(`/api/cats/${catId}/map-details`);
    // map-details may not exist for all cats (404 is acceptable)
    if (!res.ok()) {
      expect([404, 400].includes(res.status())).toBeTruthy();
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Should have cat identification fields
    expect(data.cat_id).toBeTruthy();
  });

  test("GET /api/people/[id]/places returns array", async ({
    page,
    request,
  }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    const res = await page.request.get(`/api/people/${personId}/places`);
    // Endpoint may not exist (404) or return empty
    if (!res.ok()) {
      // 404 means endpoint doesn't exist, which is acceptable
      expect([404, 400].includes(res.status())).toBeTruthy();
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Should be an array or contain a places array
    const places = Array.isArray(data) ? data : data.places;
    expect(Array.isArray(places)).toBeTruthy();
  });
});
