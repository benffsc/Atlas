import type { RoleConfig } from "../types";

/**
 * Trapper role config — added to base when person is a trapper.
 * Sections appear in the "trapper" tab (main view when accessed via /trappers/[id]).
 */
export const TRAPPER_CONFIG: RoleConfig = {
  role: "trapper",

  sections: [
    {
      id: "performance-banner",
      title: "Performance Summary",
      component: null!,
      tab: "trapper",
      order: 5,
    },
    {
      id: "contract-profile",
      title: "Contract & Profile",
      component: null!,
      tab: "trapper",
      order: 10,
      showWhen: (data) => !!data.trapperProfile,
    },
    {
      id: "contract-history",
      title: "Contract History",
      component: null!,
      tab: "trapper",
      order: 15,
    },
    {
      id: "trapper-stats-card",
      title: "Statistics",
      component: null!,
      tab: "trapper",
      order: 20,
    },
    {
      id: "service-areas",
      title: "Service Areas",
      component: null!,
      tab: "trapper",
      order: 25,
    },
    {
      id: "manual-catches",
      title: "Manual Catches",
      component: null!,
      tab: "trapper",
      order: 30,
    },
    {
      id: "assignment-history",
      title: "Assignment History",
      component: null!,
      tab: "trapper",
      order: 35,
    },
    {
      id: "trapper-journal",
      title: "Journal",
      component: null!,
      tab: "trapper",
      order: 40,
    },
    {
      id: "change-history",
      title: "Change History",
      component: null!,
      tab: "trapper",
      order: 45,
      showWhen: (data) => data.changeHistory.length > 0,
    },
  ],

  tabs: [
    {
      id: "trapper",
      label: "Trapper",
      icon: "🪤",
    },
  ],

  stats: [
    {
      label: "Total Caught",
      value: (data) => data.trapperStats?.total_cats_caught ?? 0,
      icon: "🐱",
    },
    {
      label: "Active Assignments",
      value: (data) => data.trapperStats?.active_assignments ?? 0,
      icon: "📋",
    },
    {
      label: "Clinic Days",
      value: (data) => data.trapperStats?.unique_clinic_days ?? 0,
      icon: "🏥",
    },
    {
      label: "Avg Cats/Day",
      value: (data) => data.trapperStats?.avg_cats_per_day ?? "—",
      icon: "📊",
    },
  ],

  actions: [
    {
      id: "view-person",
      label: "View person record",
      href: (data) => `/people/${data.person?.person_id}`,
      showWhen: () => true,
    },
    {
      id: "view-map",
      label: "View on Map",
      href: (data) => `/map?layers=trapper_territories&trapper=${data.person?.person_id}`,
      showWhen: () => true,
    },
  ],

  badges: [],
};
