import { describe, it, expect } from "vitest";
import {
  formatPlaceKind,
  formatRole,
  formatMatchReason,
  formatSourceSystem,
  formatStatus,
  formatEnum,
} from "@/lib/display-labels";

// =============================================================================
// formatPlaceKind
// =============================================================================

describe("formatPlaceKind", () => {
  it("formats current schema values", () => {
    expect(formatPlaceKind("single_family")).toBe("House");
    expect(formatPlaceKind("apartment_unit")).toBe("Apartment");
    expect(formatPlaceKind("mobile_home")).toBe("Mobile Home");
    expect(formatPlaceKind("business")).toBe("Business");
  });

  it("formats legacy values", () => {
    expect(formatPlaceKind("residential_house")).toBe("House");
    expect(formatPlaceKind("farm_ranch")).toBe("Farm/Ranch");
    expect(formatPlaceKind("mobile_home_space")).toBe("Mobile Home");
  });

  it("returns 'Unknown' for null", () => {
    expect(formatPlaceKind(null)).toBe("Unknown");
  });

  it("returns 'Unknown' for undefined", () => {
    expect(formatPlaceKind(undefined)).toBe("Unknown");
  });

  it("title-cases unknown values", () => {
    expect(formatPlaceKind("some_new_type")).toBe("Some New Type");
  });
});

// =============================================================================
// formatRole
// =============================================================================

describe("formatRole", () => {
  it("formats known roles", () => {
    expect(formatRole("resident")).toBe("Resident");
    expect(formatRole("colony_caretaker")).toBe("Caretaker");
    expect(formatRole("property_owner")).toBe("Property Owner");
  });

  it("formats relationship labels", () => {
    expect(formatRole("owner")).toBe("Owner");
    expect(formatRole("foster")).toBe("Foster");
    expect(formatRole("adopter")).toBe("Adopter");
  });

  it("returns empty string for null", () => {
    expect(formatRole(null)).toBe("");
  });

  it("title-cases unknown roles", () => {
    expect(formatRole("custom_role")).toBe("Custom Role");
  });
});

// =============================================================================
// formatMatchReason
// =============================================================================

describe("formatMatchReason", () => {
  it("formats full variant", () => {
    expect(formatMatchReason("exact_name")).toBe("Exact name");
    expect(formatMatchReason("trigram")).toBe("Fuzzy match");
  });

  it("formats short variant", () => {
    expect(formatMatchReason("exact_name", true)).toBe("Exact");
    expect(formatMatchReason("trigram", true)).toBe("Fuzzy");
  });

  it("returns empty string for null", () => {
    expect(formatMatchReason(null)).toBe("");
  });

  it("title-cases unknown reasons", () => {
    expect(formatMatchReason("new_reason")).toBe("New Reason");
  });
});

// =============================================================================
// formatSourceSystem
// =============================================================================

describe("formatSourceSystem", () => {
  it("formats all known source systems", () => {
    expect(formatSourceSystem("clinichq")).toBe("ClinicHQ");
    expect(formatSourceSystem("shelterluv")).toBe("ShelterLuv");
    expect(formatSourceSystem("volunteerhub")).toBe("VolunteerHub");
    expect(formatSourceSystem("airtable")).toBe("Airtable");
    expect(formatSourceSystem("web_intake")).toBe("Web Intake");
    expect(formatSourceSystem("petlink")).toBe("PetLink");
    expect(formatSourceSystem("google_maps")).toBe("Google Maps");
    expect(formatSourceSystem("atlas_ui")).toBe("Atlas");
  });

  it("returns empty string for null", () => {
    expect(formatSourceSystem(null)).toBe("");
  });

  it("title-cases unknown systems", () => {
    expect(formatSourceSystem("new_source")).toBe("New Source");
  });
});

// =============================================================================
// formatStatus
// =============================================================================

describe("formatStatus", () => {
  it("formats known statuses", () => {
    expect(formatStatus("new")).toBe("New");
    expect(formatStatus("completed")).toBe("Completed");
    expect(formatStatus("in_progress")).toBe("In Progress");
    expect(formatStatus("on_hold")).toBe("On Hold");
  });

  it("returns empty string for null", () => {
    expect(formatStatus(null)).toBe("");
  });

  it("title-cases unknown statuses", () => {
    expect(formatStatus("pending_review")).toBe("Pending Review");
  });
});

// =============================================================================
// formatEnum
// =============================================================================

describe("formatEnum", () => {
  it("uses provided labels map", () => {
    const labels = { active: "Active", inactive: "Inactive" };
    expect(formatEnum("active", labels)).toBe("Active");
  });

  it("title-cases when value not in labels", () => {
    const labels = { active: "Active" };
    expect(formatEnum("unknown_val", labels)).toBe("Unknown Val");
  });

  it("title-cases without labels", () => {
    expect(formatEnum("some_value")).toBe("Some Value");
  });

  it("returns empty string for null", () => {
    expect(formatEnum(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatEnum(undefined)).toBe("");
  });
});
