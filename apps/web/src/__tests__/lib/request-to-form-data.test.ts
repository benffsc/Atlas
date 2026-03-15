import { describe, it, expect } from "vitest";
import { requestToFormData } from "@/lib/request-to-form-data";

// =============================================================================
// Contact mapping
// =============================================================================

describe("requestToFormData — Contact", () => {
  it("splits requester_name into first_name and last_name", () => {
    const result = requestToFormData({ requester_name: "Alice Smith" });
    expect(result.first_name).toBe("Alice");
    expect(result.last_name).toBe("Smith");
  });

  it("handles single-word name (no last name)", () => {
    const result = requestToFormData({ requester_name: "Alice" });
    expect(result.first_name).toBe("Alice");
    expect(result.last_name).toBeNull();
  });

  it("handles multi-part last name", () => {
    const result = requestToFormData({ requester_name: "Maria De La Cruz" });
    expect(result.first_name).toBe("Maria");
    expect(result.last_name).toBe("De La Cruz");
  });

  it("maps phone and email", () => {
    const result = requestToFormData({
      requester_phone: "7075551234",
      requester_email: "alice@example.com",
    });
    expect(result.phone).toBe("7075551234");
    expect(result.email).toBe("alice@example.com");
  });

  it("maps third-party fields", () => {
    const result = requestToFormData({
      is_third_party_report: true,
      third_party_relationship: "neighbor",
    });
    expect(result.is_third_party_report).toBe(true);
    expect(result.third_party_relationship).toBe("neighbor");
  });

  it("skips null values", () => {
    const result = requestToFormData({
      requester_phone: null,
      requester_email: null,
    });
    expect(result).not.toHaveProperty("phone");
    expect(result).not.toHaveProperty("email");
  });
});

// =============================================================================
// Location mapping
// =============================================================================

describe("requestToFormData — Location", () => {
  it("maps place fields to form fields", () => {
    const result = requestToFormData({
      place_address: "123 Main St",
      place_city: "Santa Rosa",
      place_postal_code: "95401",
      county: "Sonoma",
      property_type: "single_family",
    });
    expect(result.address).toBe("123 Main St");
    expect(result.city).toBe("Santa Rosa");
    expect(result.zip).toBe("95401");
    expect(result.county).toBe("Sonoma");
    expect(result.property_type).toBe("single_family");
  });

  it("maps permission_status to has_property_access", () => {
    const result = requestToFormData({ permission_status: "granted" });
    expect(result.has_property_access).toBe("granted");
  });
});

// =============================================================================
// Cat info mapping
// =============================================================================

describe("requestToFormData — Cat Info", () => {
  it("maps estimated_cat_count to cat_count", () => {
    const result = requestToFormData({ estimated_cat_count: 5 });
    expect(result.cat_count).toBe(5);
  });

  it("maps total_cats_reported to peak_count", () => {
    const result = requestToFormData({ total_cats_reported: 12 });
    expect(result.peak_count).toBe(12);
  });

  it("maps cats_are_friendly to cats_friendly", () => {
    const result = requestToFormData({ cats_are_friendly: true });
    expect(result.cats_friendly).toBe(true);
  });

  it("maps feeding fields", () => {
    const result = requestToFormData({
      is_being_fed: true,
      feeding_frequency: "daily",
      feeder_name: "Bob",
    });
    expect(result.is_being_fed).toBe(true);
    expect(result.feeding_frequency).toBe("daily");
    expect(result.feeder_name).toBe("Bob");
  });
});

// =============================================================================
// Kitten age bucket conversion
// =============================================================================

describe("requestToFormData — Kitten Age", () => {
  it("uses kitten_age_estimate directly when provided", () => {
    const result = requestToFormData({
      has_kittens: true,
      kitten_age_estimate: "8-12 wks",
    });
    expect(result.kitten_age_estimate).toBe("8-12 wks");
  });

  it("converts kitten_age_weeks < 4 to 'Under 4 wks'", () => {
    const result = requestToFormData({ has_kittens: true, kitten_age_weeks: 2 });
    expect(result.kitten_age_estimate).toBe("Under 4 wks");
  });

  it("converts kitten_age_weeks 4-7 to '4-8 wks'", () => {
    const result = requestToFormData({ has_kittens: true, kitten_age_weeks: 6 });
    expect(result.kitten_age_estimate).toBe("4-8 wks");
  });

  it("converts kitten_age_weeks 8-11 to '8-12 wks'", () => {
    const result = requestToFormData({ has_kittens: true, kitten_age_weeks: 10 });
    expect(result.kitten_age_estimate).toBe("8-12 wks");
  });

  it("converts kitten_age_weeks 12-15 to '12-16 wks'", () => {
    const result = requestToFormData({ has_kittens: true, kitten_age_weeks: 14 });
    expect(result.kitten_age_estimate).toBe("12-16 wks");
  });

  it("converts kitten_age_weeks >= 16 to '4+ months'", () => {
    const result = requestToFormData({ has_kittens: true, kitten_age_weeks: 20 });
    expect(result.kitten_age_estimate).toBe("4+ months");
  });

  it("prefers kitten_age_estimate over kitten_age_weeks", () => {
    const result = requestToFormData({
      has_kittens: true,
      kitten_age_estimate: "Under 4 wks",
      kitten_age_weeks: 10,
    });
    expect(result.kitten_age_estimate).toBe("Under 4 wks");
  });
});

// =============================================================================
// Medical mapping
// =============================================================================

describe("requestToFormData — Medical", () => {
  it("maps medical fields", () => {
    const result = requestToFormData({
      has_medical_concerns: true,
      medical_description: "Limping",
      is_emergency: false,
      urgency_reasons: ["injured"],
    });
    expect(result.has_medical_concerns).toBe(true);
    expect(result.medical_description).toBe("Limping");
    expect(result.is_emergency).toBe(false);
    expect(result.urgency_reasons).toEqual(["injured"]);
  });
});

// =============================================================================
// Staff mapping
// =============================================================================

describe("requestToFormData — Staff", () => {
  it("maps staff fields with renamed keys", () => {
    const result = requestToFormData({
      created_at: "2026-01-15",
      created_by: "admin",
      data_source: "web_intake",
      priority: "High",
      notes: "Urgent case",
      scheduled_date: "2026-02-01",
    });
    expect(result.date_received).toBe("2026-01-15");
    expect(result.received_by).toBe("admin");
    expect(result.intake_source).toBe("web_intake");
    expect(result.priority).toBe("High");
    expect(result.staff_notes).toBe("Urgent case");
    expect(result.scheduled_date).toBe("2026-02-01");
  });
});

// =============================================================================
// Full mapping
// =============================================================================

describe("requestToFormData — Integration", () => {
  it("maps a complete request correctly", () => {
    const result = requestToFormData({
      requester_name: "Jane Doe",
      requester_phone: "7075559999",
      requester_email: "jane@example.com",
      place_address: "456 Oak Ave",
      place_city: "Petaluma",
      estimated_cat_count: 8,
      has_kittens: true,
      kitten_age_weeks: 3,
      priority: "Urgent",
    });

    expect(result.first_name).toBe("Jane");
    expect(result.last_name).toBe("Doe");
    expect(result.phone).toBe("7075559999");
    expect(result.address).toBe("456 Oak Ave");
    expect(result.city).toBe("Petaluma");
    expect(result.cat_count).toBe(8);
    expect(result.has_kittens).toBe(true);
    expect(result.kitten_age_estimate).toBe("Under 4 wks");
    expect(result.priority).toBe("Urgent");
  });

  it("returns empty object for empty request", () => {
    const result = requestToFormData({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("omits all null fields", () => {
    const result = requestToFormData({
      requester_phone: null,
      requester_email: null,
      place_address: null,
      estimated_cat_count: null,
    });
    expect(Object.keys(result)).toHaveLength(0);
  });
});
