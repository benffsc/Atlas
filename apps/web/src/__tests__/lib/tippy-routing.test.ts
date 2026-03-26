import { describe, it, expect } from "vitest";
import {
  detectIntentAndForceToolChoice,
  getToolsForAccessLevel,
  WRITE_TOOLS,
  ADMIN_TOOLS,
} from "@/lib/tippy-routing";

// =============================================================================
// Mock tool list (mirrors TIPPY_TOOLS shape)
// =============================================================================

const MOCK_TOOLS = [
  { name: "analyze_place_situation" },
  { name: "query_cats_at_place" },
  { name: "query_request_stats" },
  { name: "query_staff_info" },
  { name: "query_trapper_stats" },
  { name: "query_partner_org_stats" },
  { name: "comprehensive_person_lookup" },
  { name: "query_cat_journey" },
  { name: "create_reminder" },
  { name: "send_staff_message" },
  { name: "log_field_event" },
  { name: "save_lookup" },
  { name: "log_site_observation" },
  { name: "create_draft_request" },
  { name: "flag_anomaly" },
  { name: "search_cats_by_description" },
  { name: "run_sql" },
];

// =============================================================================
// detectIntentAndForceToolChoice — Address / Place patterns
// =============================================================================

describe("detectIntentAndForceToolChoice", () => {
  describe("address → analyze_place_situation", () => {
    it("what's happening at 123 Main St", () => {
      const result = detectIntentAndForceToolChoice(
        "What's happening at 123 Main St?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("tell me about 456 Oak Ave", () => {
      const result = detectIntentAndForceToolChoice(
        "Tell me about 456 Oak Ave",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("cats at 789 Elm Rd", () => {
      const result = detectIntentAndForceToolChoice(
        "cats at 789 Elm Rd",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("situation at 101 Fisher Lane, Santa Rosa", () => {
      const result = detectIntentAndForceToolChoice(
        "Situation at 101 Fisher Lane, Santa Rosa",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("what do we know about 1170 Walker Rd", () => {
      const result = detectIntentAndForceToolChoice(
        "What do we know about 1170 Walker Rd?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("colony at 500 Petaluma Blvd", () => {
      const result = detectIntentAndForceToolChoice(
        "colony at 500 Petaluma Blvd",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("look up 225 Scenic Ave", () => {
      const result = detectIntentAndForceToolChoice(
        "look up 225 Scenic Ave",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("anything going on at 350 Industrial Dr", () => {
      const result = detectIntentAndForceToolChoice(
        "Anything going on at 350 Industrial Dr?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });
  });

  // ===========================================================================
  // Reminder patterns
  // ===========================================================================

  describe("reminder → create_reminder", () => {
    it("remind me to check on 115 Magnolia tomorrow", () => {
      const result = detectIntentAndForceToolChoice(
        "Remind me to check on 115 Magnolia tomorrow",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("set a reminder for next week", () => {
      const result = detectIntentAndForceToolChoice(
        "Set a reminder for next week to follow up",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("don't let me forget about the colony meeting", () => {
      const result = detectIntentAndForceToolChoice(
        "Don't let me forget about the colony meeting",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("follow up on this later", () => {
      const result = detectIntentAndForceToolChoice(
        "follow up on this later",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("add a reminder for Tuesday", () => {
      const result = detectIntentAndForceToolChoice(
        "add a reminder for Tuesday",
        "full"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("reminders NOT forced for read_only users", () => {
      const result = detectIntentAndForceToolChoice(
        "Remind me to check on this",
        "read_only"
      );
      // read_only users can't create reminders, so should not force
      expect(result).toBeUndefined();
    });
  });

  // ===========================================================================
  // Messaging patterns
  // ===========================================================================

  describe("messaging → send_staff_message", () => {
    it("tell Ben that the colony needs attention", () => {
      const result = detectIntentAndForceToolChoice(
        "Tell Ben that the colony at Oak St needs attention",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "send_staff_message" });
    });

    it("message Jami about the intake queue", () => {
      const result = detectIntentAndForceToolChoice(
        "Message Jami about the intake queue",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "send_staff_message" });
    });

    it("let Crystal know about the new traps", () => {
      const result = detectIntentAndForceToolChoice(
        "Let Crystal know about the new traps",
        "full"
      );
      expect(result).toEqual({ type: "tool", name: "send_staff_message" });
    });

    it("messaging NOT forced for read_only users", () => {
      const result = detectIntentAndForceToolChoice(
        "Tell Ben that we need more traps",
        "read_only"
      );
      expect(result).toBeUndefined();
    });
  });

  // ===========================================================================
  // Staff patterns
  // ===========================================================================

  describe("staff → query_staff_info", () => {
    it("how many staff do we have", () => {
      const result = detectIntentAndForceToolChoice(
        "How many staff do we have?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });

    it("staff count", () => {
      const result = detectIntentAndForceToolChoice(
        "staff count",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });

    it("who are our staff members", () => {
      const result = detectIntentAndForceToolChoice(
        "Who are our staff members?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });

    it("list of staff", () => {
      const result = detectIntentAndForceToolChoice(
        "list of staff",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });

    it("staff info", () => {
      const result = detectIntentAndForceToolChoice(
        "staff info",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });
  });

  // ===========================================================================
  // Trapper patterns
  // ===========================================================================

  describe("trapper → query_trapper_stats", () => {
    it("how many trappers do we have", () => {
      const result = detectIntentAndForceToolChoice(
        "How many trappers do we have?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_trapper_stats" });
    });

    it("active trappers", () => {
      const result = detectIntentAndForceToolChoice(
        "active trappers",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_trapper_stats" });
    });

    it("trapper stats", () => {
      const result = detectIntentAndForceToolChoice(
        "trapper stats",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_trapper_stats" });
    });

    it("how many volunteers are there", () => {
      const result = detectIntentAndForceToolChoice(
        "How many volunteers are there?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_trapper_stats" });
    });
  });

  // ===========================================================================
  // Partner org patterns
  // ===========================================================================

  describe("partner org → query_partner_org_stats", () => {
    it("how many SCAS cats have we done", () => {
      const result = detectIntentAndForceToolChoice(
        "How many SCAS cats have we done?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_partner_org_stats" });
    });

    it("SCAS stats", () => {
      const result = detectIntentAndForceToolChoice(
        "SCAS stats",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_partner_org_stats" });
    });

    it("how many shelter cats", () => {
      const result = detectIntentAndForceToolChoice(
        "How many shelter cats did we fix?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_partner_org_stats" });
    });
  });

  // ===========================================================================
  // FFS-744: Cat description search patterns
  // ===========================================================================

  describe("cat description → search_cats_by_description", () => {
    it("find the orange tabby on Pozzan Road", () => {
      const result = detectIntentAndForceToolChoice(
        "Find the orange tabby on Pozzan Road",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "search_cats_by_description" });
    });

    it("any calico cats near Oak St", () => {
      const result = detectIntentAndForceToolChoice(
        "Any calico cats near Oak St?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "search_cats_by_description" });
    });

    it("search for a black cat at Walker Rd", () => {
      const result = detectIntentAndForceToolChoice(
        "Search for a black cat at Walker Rd",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "search_cats_by_description" });
    });

    it("orange cat on Selvage", () => {
      const result = detectIntentAndForceToolChoice(
        "orange cat on Selvage",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "search_cats_by_description" });
    });

    it("look for a gray kitten near downtown", () => {
      const result = detectIntentAndForceToolChoice(
        "Look for a gray kitten near downtown",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "search_cats_by_description" });
    });
  });

  // ===========================================================================
  // Ambiguous / no-match → undefined (let Claude decide)
  // ===========================================================================

  describe("ambiguous/no-match → undefined", () => {
    it("general greeting returns undefined", () => {
      expect(
        detectIntentAndForceToolChoice("Hello, how are you?", "read_only")
      ).toBeUndefined();
    });

    it("vague question returns undefined", () => {
      expect(
        detectIntentAndForceToolChoice("What can you help me with?", "read_only")
      ).toBeUndefined();
    });

    it("cat name without address returns undefined", () => {
      expect(
        detectIntentAndForceToolChoice("Tell me about Whiskers", "read_only")
      ).toBeUndefined();
    });

    it("address without query intent returns undefined", () => {
      // Has an address but no query pattern like "what's", "tell me", etc.
      expect(
        detectIntentAndForceToolChoice("I live at 123 Main St", "read_only")
      ).toBeUndefined();
    });

    it("empty string returns undefined", () => {
      expect(detectIntentAndForceToolChoice("", "read_only")).toBeUndefined();
    });

    it("very long string returns undefined if no patterns match", () => {
      const longStr = "a".repeat(5000);
      expect(
        detectIntentAndForceToolChoice(longStr, "read_only")
      ).toBeUndefined();
    });
  });

  // ===========================================================================
  // Negative / non-obvious cases
  // ===========================================================================

  describe("negative cases", () => {
    it("'staff' in a trapper question doesn't trigger staff lookup", () => {
      // "staff" embedded in trapper context shouldn't match staff pattern
      const result = detectIntentAndForceToolChoice(
        "How many trappers does the staff manage?",
        "read_only"
      );
      // Trapper pattern matches because of "trappers"
      expect(result).toEqual({ type: "tool", name: "query_trapper_stats" });
    });

    it("address word without actual address number doesn't trigger place", () => {
      const result = detectIntentAndForceToolChoice(
        "What's the situation on Main Street in general?",
        "read_only"
      );
      // No leading number → address pattern shouldn't match
      expect(result).toBeUndefined();
    });

    it("reminder pattern ignored for read_only", () => {
      const result = detectIntentAndForceToolChoice(
        "remind me to check on this tomorrow",
        "read_only"
      );
      expect(result).toBeUndefined();
    });

    it("message pattern ignored for read_only", () => {
      const result = detectIntentAndForceToolChoice(
        "Tell Ben about the colony",
        "read_only"
      );
      expect(result).toBeUndefined();
    });

    it("write tools forced for full access too", () => {
      const result = detectIntentAndForceToolChoice(
        "Remind me to follow up next week",
        "full"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("mixed case is handled", () => {
      const result = detectIntentAndForceToolChoice(
        "WHAT'S HAPPENING AT 123 MAIN ST?",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "analyze_place_situation" });
    });

    it("special characters in message don't crash", () => {
      expect(() =>
        detectIntentAndForceToolChoice("What about 🐱 at 123 Oak St?", "read_only")
      ).not.toThrow();
    });

    it("unicode in message doesn't crash", () => {
      expect(() =>
        detectIntentAndForceToolChoice("¿Qué pasa en 123 Main St?", "read_only")
      ).not.toThrow();
    });

    it("multiple intent signals — first match wins (reminder before address)", () => {
      // "Remind me" triggers before address check
      const result = detectIntentAndForceToolChoice(
        "Remind me to check on 123 Oak St tomorrow",
        "read_write"
      );
      expect(result).toEqual({ type: "tool", name: "create_reminder" });
    });

    it("staff pattern checked before trapper (priority ordering)", () => {
      // "staff" should match staff, not fall through to trapper
      const result = detectIntentAndForceToolChoice(
        "how many staff members",
        "read_only"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });

    it("'none' access level still detects read-only intents", () => {
      // Even 'none' users can have intent detection (tools just won't be available)
      const result = detectIntentAndForceToolChoice(
        "how many staff",
        "none"
      );
      expect(result).toEqual({ type: "tool", name: "query_staff_info" });
    });
  });
});

// =============================================================================
// getToolsForAccessLevel
// =============================================================================

describe("getToolsForAccessLevel", () => {
  describe("access level 'none'", () => {
    it("returns empty array", () => {
      expect(getToolsForAccessLevel(MOCK_TOOLS, "none")).toEqual([]);
    });

    it("returns empty array for null", () => {
      expect(getToolsForAccessLevel(MOCK_TOOLS, null)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(getToolsForAccessLevel(MOCK_TOOLS, "")).toEqual([]);
    });
  });

  describe("access level 'read_only'", () => {
    it("excludes all write tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_only");
      const names = result.map((t) => t.name);
      for (const writeTool of WRITE_TOOLS) {
        expect(names).not.toContain(writeTool);
      }
    });

    it("excludes all admin tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_only");
      const names = result.map((t) => t.name);
      for (const adminTool of ADMIN_TOOLS) {
        expect(names).not.toContain(adminTool);
      }
    });

    it("includes read tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_only");
      const names = result.map((t) => t.name);
      expect(names).toContain("analyze_place_situation");
      expect(names).toContain("query_staff_info");
      expect(names).toContain("query_trapper_stats");
    });

    it("returns fewer tools than the full set", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_only");
      expect(result.length).toBeLessThan(MOCK_TOOLS.length);
    });
  });

  describe("access level 'read_write'", () => {
    it("includes write tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_write");
      const names = result.map((t) => t.name);
      expect(names).toContain("create_reminder");
      expect(names).toContain("send_staff_message");
      expect(names).toContain("log_field_event");
    });

    it("excludes admin tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_write");
      const names = result.map((t) => t.name);
      for (const adminTool of ADMIN_TOOLS) {
        expect(names).not.toContain(adminTool);
      }
    });

    it("includes read tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "read_write");
      const names = result.map((t) => t.name);
      expect(names).toContain("analyze_place_situation");
      expect(names).toContain("query_request_stats");
    });
  });

  describe("access level 'full'", () => {
    it("returns all tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "full");
      expect(result.length).toBe(MOCK_TOOLS.length);
    });

    it("includes write tools", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "full");
      const names = result.map((t) => t.name);
      expect(names).toContain("create_reminder");
      expect(names).toContain("send_staff_message");
    });

    it("includes all mock tools by name", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "full");
      const names = result.map((t) => t.name);
      for (const tool of MOCK_TOOLS) {
        expect(names).toContain(tool.name);
      }
    });
  });

  describe("edge cases", () => {
    it("empty tools array returns empty for any access", () => {
      expect(getToolsForAccessLevel([], "full")).toEqual([]);
      expect(getToolsForAccessLevel([], "read_only")).toEqual([]);
    });

    it("unknown access level returns all tools (fallthrough)", () => {
      const result = getToolsForAccessLevel(MOCK_TOOLS, "super_admin");
      expect(result.length).toBe(MOCK_TOOLS.length);
    });
  });
});

// =============================================================================
// Constants
// =============================================================================

describe("constants", () => {
  it("WRITE_TOOLS contains expected tools", () => {
    expect(WRITE_TOOLS).toContain("create_reminder");
    expect(WRITE_TOOLS).toContain("send_staff_message");
    expect(WRITE_TOOLS).toContain("log_field_event");
    expect(WRITE_TOOLS).toContain("create_draft_request");
  });

  it("WRITE_TOOLS does not contain read tools", () => {
    expect(WRITE_TOOLS).not.toContain("analyze_place_situation");
    expect(WRITE_TOOLS).not.toContain("query_staff_info");
    expect(WRITE_TOOLS).not.toContain("query_trapper_stats");
  });

  it("ADMIN_TOOLS is currently empty (temp demo mode)", () => {
    expect(ADMIN_TOOLS).toEqual([]);
  });
});
