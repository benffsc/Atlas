import type { RoleConfig } from "../types";

/**
 * Foster role config — added to base when person has an active foster role.
 * Sections appear in the "foster" tab (main view when accessed via /fosters/[id]).
 */
export const FOSTER_CONFIG: RoleConfig = {
  role: "foster",

  sections: [
    {
      id: "foster-overview",
      title: "Foster Overview",
      component: null!,
      tab: "foster",
      order: 5,
    },
    {
      id: "foster-cats",
      title: "Foster Cats",
      component: null!,
      tab: "foster",
      order: 10,
    },
    {
      id: "foster-agreements",
      title: "Agreements",
      component: null!,
      tab: "foster",
      order: 15,
      defaultCollapsed: true,
    },
  ],

  tabs: [
    {
      id: "foster",
      label: "Foster",
      icon: "💛",
      count: (data) => data.fosterCats?.length ?? 0,
    },
  ],

  stats: [
    {
      label: "Cats Fostered",
      value: (data) =>
        data.volunteerRoles?.operational_summary?.foster_stats?.cats_fostered ?? 0,
      icon: "🐱",
    },
    {
      label: "Distinct Cats",
      value: (data) =>
        data.volunteerRoles?.operational_summary?.foster_stats?.current_fosters ?? 0,
      icon: "🏠",
    },
  ],

  actions: [
    {
      id: "view-person",
      label: "View person record",
      href: (data) => `/people/${data.person?.person_id}`,
      showWhen: () => true,
    },
  ],

  badges: [],
};
