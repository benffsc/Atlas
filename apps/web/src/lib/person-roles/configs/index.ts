import type { RoleType, RoleConfig, MergedConfig, SectionDefinition, TabDefinition } from "../types";
import type { PersonDetailData } from "@/hooks/usePersonDetail";
import { BASE_CONFIG } from "./base";
import { TRAPPER_CONFIG } from "./trapper";

/**
 * Registry of all role configs.
 * To add a new role (e.g., foster), create configs/foster.ts and register here.
 */
const ROLE_CONFIGS: Record<RoleType, RoleConfig> = {
  base: BASE_CONFIG,
  trapper: TRAPPER_CONFIG,
  // Future roles:
  foster: { role: "foster", sections: [], tabs: [], stats: [], actions: [], badges: [] },
  volunteer: { role: "volunteer", sections: [], tabs: [], stats: [], actions: [], badges: [] },
  caretaker: { role: "caretaker", sections: [], tabs: [], stats: [], actions: [], badges: [] },
  staff: { role: "staff", sections: [], tabs: [], stats: [], actions: [], badges: [] },
};

/**
 * Detect which roles a person has based on fetched data.
 */
export function detectRoles(data: PersonDetailData): RoleType[] {
  const roles: RoleType[] = ["base"];

  if (data.isTrapper || data.trapperStats || data.trapperInfo) {
    roles.push("trapper");
  }

  // Future: detect foster, volunteer, caretaker, staff from volunteerRoles
  if (data.volunteerRoles?.roles?.some(r => r.role === "foster" && r.role_status === "active")) {
    roles.push("foster");
  }

  return roles;
}

/**
 * Merge base + role-specific configs into a single config.
 *
 * - Sections are concatenated and sorted by (tab, order)
 * - Tabs are deduplicated by id (first definition wins for label/icon)
 * - Stats, actions, badges are concatenated
 *
 * @param roles - Roles to include (always includes 'base')
 */
export function getRoleConfig(roles: RoleType[]): MergedConfig {
  const allRoles = roles.includes("base") ? roles : ["base" as RoleType, ...roles];

  const sections: SectionDefinition[] = [];
  const tabMap = new Map<string, TabDefinition>();
  const stats: MergedConfig["stats"] = [];
  const actions: MergedConfig["actions"] = [];
  const badges: MergedConfig["badges"] = [];

  for (const role of allRoles) {
    const config = ROLE_CONFIGS[role];
    if (!config) continue;

    sections.push(...config.sections);
    stats.push(...config.stats);
    actions.push(...config.actions);
    badges.push(...config.badges);

    for (const tab of config.tabs) {
      if (!tabMap.has(tab.id)) {
        tabMap.set(tab.id, tab);
      }
    }
  }

  // Sort sections by tab then order
  sections.sort((a, b) => {
    if (a.tab !== b.tab) return a.tab.localeCompare(b.tab);
    return a.order - b.order;
  });

  // Build tab list: trapper first (if present), then main, then others
  const tabs = Array.from(tabMap.values());
  tabs.sort((a, b) => {
    const order: Record<string, number> = { trapper: 0, main: 1, details: 2, history: 3, admin: 4 };
    return (order[a.id] ?? 99) - (order[b.id] ?? 99);
  });

  return { sections, tabs, stats, actions, badges, roles: allRoles };
}

export { ROLE_CONFIGS };
