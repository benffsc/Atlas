import { describe, it, expect } from "vitest";
import { TIPPY_V2_TOOLS } from "@/app/api/tippy/tools-v2";

// =============================================================================
// Phase 1B: Tool descriptions include new capabilities
// =============================================================================

describe("tool descriptions — Phase 1B updates", () => {
  const findTool = (name: string) =>
    TIPPY_V2_TOOLS.find((t) => t.name === name);

  it("full_place_briefing mentions corridor detection", () => {
    const tool = findTool("full_place_briefing");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Corridor detection");
  });

  it("cat_lookup mentions journey data", () => {
    const tool = findTool("cat_lookup");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("journey data");
  });

  it("log_event description mentions link_corridor_place", () => {
    const tool = findTool("log_event");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("link_corridor_place");
  });

  it("log_event action_type enum includes link_corridor_place", () => {
    const tool = findTool("log_event");
    const actionTypeEnum =
      tool!.input_schema.properties.action_type.enum as string[];
    expect(actionTypeEnum).toContain("link_corridor_place");
    expect(actionTypeEnum).toContain("add_field_contact");
    expect(actionTypeEnum).toContain("field_event");
  });
});

// =============================================================================
// Phase 1D: Place media route has required exports
// =============================================================================

describe("place media route exports", () => {
  it("exports GET and POST handlers", async () => {
    const mod = await import("@/app/api/places/[id]/media/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});

// =============================================================================
// Notification route exports
// =============================================================================

describe("notification route exports", () => {
  it("/api/notifications exports GET and POST", async () => {
    const mod = await import("@/app/api/notifications/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });

  it("/api/notifications/[id] exports PATCH", async () => {
    const mod = await import("@/app/api/notifications/[id]/route");
    expect(typeof mod.PATCH).toBe("function");
  });

  it("/api/cron/tippy-followups exports GET", async () => {
    const mod = await import("@/app/api/cron/tippy-followups/route");
    expect(typeof mod.GET).toBe("function");
  });
});

// =============================================================================
// NotificationBell component renders
// =============================================================================

describe("NotificationBell module", () => {
  it("exports NotificationBell component", async () => {
    const mod = await import("@/components/NotificationBell");
    expect(typeof mod.NotificationBell).toBe("function");
  });
});
