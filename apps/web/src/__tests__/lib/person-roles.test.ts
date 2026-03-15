import { describe, it, expect } from "vitest";
import { detectRoles, getRoleConfig, ROLE_CONFIGS } from "@/lib/person-roles/configs/index";
import type { PersonDetailData } from "@/hooks/usePersonDetail";

// Minimal mock data for detectRoles
function mockPersonData(overrides: Partial<PersonDetailData> = {}): PersonDetailData {
  return {
    person: { person_id: "test-id", display_name: "Test Person" },
    isTrapper: false,
    trapperInfo: null,
    trapperStats: null,
    volunteerRoles: null,
    ...overrides,
  } as PersonDetailData;
}

// =============================================================================
// detectRoles
// =============================================================================

describe("detectRoles", () => {
  it("always includes 'base' role", () => {
    const roles = detectRoles(mockPersonData());
    expect(roles).toContain("base");
  });

  it("detects trapper from isTrapper flag", () => {
    const roles = detectRoles(mockPersonData({ isTrapper: true }));
    expect(roles).toContain("trapper");
  });

  it("detects trapper from trapperStats", () => {
    const roles = detectRoles(mockPersonData({ trapperStats: { total_assignments: 5 } as unknown as PersonDetailData["trapperStats"] }));
    expect(roles).toContain("trapper");
  });

  it("detects trapper from trapperInfo", () => {
    const roles = detectRoles(mockPersonData({ trapperInfo: { trapper_type: "ffsc_volunteer" } as PersonDetailData["trapperInfo"] }));
    expect(roles).toContain("trapper");
  });

  it("does not detect trapper when all trapper fields are falsy", () => {
    const roles = detectRoles(mockPersonData({ isTrapper: false, trapperInfo: null, trapperStats: null }));
    expect(roles).not.toContain("trapper");
  });

  it("detects foster from volunteerRoles", () => {
    const roles = detectRoles(mockPersonData({
      volunteerRoles: {
        roles: [{ role: "foster", role_status: "active" }],
      } as PersonDetailData["volunteerRoles"],
    }));
    expect(roles).toContain("foster");
  });

  it("does not detect foster when role_status is inactive", () => {
    const roles = detectRoles(mockPersonData({
      volunteerRoles: {
        roles: [{ role: "foster", role_status: "inactive" }],
      } as PersonDetailData["volunteerRoles"],
    }));
    expect(roles).not.toContain("foster");
  });

  it("does not detect foster when no foster role present", () => {
    const roles = detectRoles(mockPersonData({
      volunteerRoles: {
        roles: [{ role: "trapper", role_status: "active" }],
      } as PersonDetailData["volunteerRoles"],
    }));
    expect(roles).not.toContain("foster");
  });

  it("detects both trapper and foster", () => {
    const roles = detectRoles(mockPersonData({
      isTrapper: true,
      volunteerRoles: {
        roles: [{ role: "foster", role_status: "active" }],
      } as PersonDetailData["volunteerRoles"],
    }));
    expect(roles).toContain("base");
    expect(roles).toContain("trapper");
    expect(roles).toContain("foster");
  });

  it("handles null volunteerRoles gracefully", () => {
    const roles = detectRoles(mockPersonData({ volunteerRoles: null }));
    expect(roles).toEqual(["base"]);
  });
});

// =============================================================================
// getRoleConfig
// =============================================================================

describe("getRoleConfig", () => {
  it("returns base tabs for base-only role", () => {
    const config = getRoleConfig(["base"]);
    const tabIds = config.tabs.map(t => t.id);
    expect(tabIds).toContain("main");
    expect(tabIds).toContain("details");
    expect(tabIds).toContain("history");
    expect(tabIds).toContain("admin");
    expect(tabIds).not.toContain("trapper");
    expect(tabIds).not.toContain("foster");
  });

  it("base tab labels are correct", () => {
    const config = getRoleConfig(["base"]);
    const tabLabels = Object.fromEntries(config.tabs.map(t => [t.id, t.label]));
    expect(tabLabels.main).toBe("Overview");
    expect(tabLabels.details).toBe("Details");
    expect(tabLabels.history).toBe("History");
    expect(tabLabels.admin).toBe("Admin");
  });

  it("adds trapper tab when trapper role included", () => {
    const config = getRoleConfig(["base", "trapper"]);
    const tabIds = config.tabs.map(t => t.id);
    expect(tabIds).toContain("trapper");
  });

  it("adds foster tab when foster role included", () => {
    const config = getRoleConfig(["base", "foster"]);
    const tabIds = config.tabs.map(t => t.id);
    expect(tabIds).toContain("foster");
  });

  it("tab ordering: trapper(0) < foster(0.5) < main(1) < details(2) < history(3) < admin(4)", () => {
    const config = getRoleConfig(["base", "trapper", "foster"]);
    const tabIds = config.tabs.map(t => t.id);
    const trapperIdx = tabIds.indexOf("trapper");
    const fosterIdx = tabIds.indexOf("foster");
    const mainIdx = tabIds.indexOf("main");
    const detailsIdx = tabIds.indexOf("details");
    const historyIdx = tabIds.indexOf("history");
    const adminIdx = tabIds.indexOf("admin");

    expect(trapperIdx).toBeLessThan(fosterIdx);
    expect(fosterIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(detailsIdx);
    expect(detailsIdx).toBeLessThan(historyIdx);
    expect(historyIdx).toBeLessThan(adminIdx);
  });

  it("auto-includes base when not specified", () => {
    const config = getRoleConfig(["trapper"]);
    expect(config.roles).toContain("base");
    const tabIds = config.tabs.map(t => t.id);
    expect(tabIds).toContain("main");
    expect(tabIds).toContain("trapper");
  });

  it("sections are sorted by tab then order", () => {
    const config = getRoleConfig(["base", "trapper"]);
    for (let i = 1; i < config.sections.length; i++) {
      const prev = config.sections[i - 1];
      const curr = config.sections[i];
      if (prev.tab === curr.tab) {
        expect(prev.order).toBeLessThanOrEqual(curr.order);
      }
    }
  });

  it("has no duplicate tab ids", () => {
    const config = getRoleConfig(["base", "trapper", "foster"]);
    const tabIds = config.tabs.map(t => t.id);
    expect(new Set(tabIds).size).toBe(tabIds.length);
  });

  it("includes sections from all specified roles", () => {
    const baseConfig = getRoleConfig(["base"]);
    const trapperConfig = getRoleConfig(["base", "trapper"]);
    expect(trapperConfig.sections.length).toBeGreaterThan(baseConfig.sections.length);
  });

  it("returns roles array including all provided roles", () => {
    const config = getRoleConfig(["base", "trapper", "foster"]);
    expect(config.roles).toEqual(["base", "trapper", "foster"]);
  });
});

// =============================================================================
// ROLE_CONFIGS registry
// =============================================================================

describe("ROLE_CONFIGS", () => {
  it("has configs for all role types", () => {
    expect(ROLE_CONFIGS).toHaveProperty("base");
    expect(ROLE_CONFIGS).toHaveProperty("trapper");
    expect(ROLE_CONFIGS).toHaveProperty("foster");
    expect(ROLE_CONFIGS).toHaveProperty("volunteer");
    expect(ROLE_CONFIGS).toHaveProperty("caretaker");
    expect(ROLE_CONFIGS).toHaveProperty("staff");
  });

  it("base config has 4 tabs", () => {
    expect(ROLE_CONFIGS.base.tabs).toHaveLength(4);
  });

  it("trapper config has Trapper tab", () => {
    const trapperTabs = ROLE_CONFIGS.trapper.tabs.map(t => t.id);
    expect(trapperTabs).toContain("trapper");
  });

  it("foster config has Foster tab", () => {
    const fosterTabs = ROLE_CONFIGS.foster.tabs.map(t => t.id);
    expect(fosterTabs).toContain("foster");
  });

  it("placeholder roles have empty arrays", () => {
    for (const role of ["volunteer", "caretaker", "staff"] as const) {
      expect(ROLE_CONFIGS[role].sections).toHaveLength(0);
      expect(ROLE_CONFIGS[role].tabs).toHaveLength(0);
    }
  });
});
