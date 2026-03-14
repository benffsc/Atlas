import type { RoleConfig } from "../types";

/**
 * Base role config — sections that appear for ALL persons.
 */
export const BASE_CONFIG: RoleConfig = {
  role: "base",

  sections: [
    {
      id: "quick-notes",
      title: "Quick Notes",
      component: null!, // Resolved from registry at render time
      tab: "main",
      order: 0,
    },
    {
      id: "clinic-notes",
      title: "Clinic Notes",
      component: null!,
      tab: "main",
      order: 5,
    },
    {
      id: "linked-cats",
      title: "Cats",
      component: null!,
      tab: "main",
      order: 20,
      showWhen: (data) => (data.person?.cat_count ?? 0) > 0 || (data.person?.cats?.length ?? 0) > 0,
    },
    {
      id: "linked-places",
      title: "Places",
      component: null!,
      tab: "main",
      order: 25,
    },
    {
      id: "verification",
      title: "Verification Status",
      component: null!,
      tab: "main",
      order: 30,
      defaultCollapsed: true,
    },
    {
      id: "photos",
      title: "Photos",
      component: null!,
      tab: "main",
      order: 35,
      defaultCollapsed: true,
    },
    {
      id: "volunteer-profile",
      title: "Volunteer Profile",
      component: null!,
      tab: "main",
      order: 15,
      showWhen: (data) => {
        const vr = data.volunteerRoles;
        return !!(vr && (vr.volunteer_profile || vr.volunteer_groups.active.length > 0));
      },
    },
    // Details tab
    {
      id: "clinic-history",
      title: "Clinic History",
      component: null!,
      tab: "details",
      order: 0,
    },
    {
      id: "location-context",
      title: "Location Context",
      component: null!,
      tab: "details",
      order: 5,
    },
    {
      id: "related-people",
      title: "Related People",
      component: null!,
      tab: "details",
      order: 10,
      showWhen: (data) => (data.person?.person_relationships?.length ?? 0) > 0,
    },
    {
      id: "journal",
      title: "Journal & Communications",
      component: null!,
      tab: "details",
      order: 15,
    },
    // History tab
    {
      id: "requests",
      title: "Requests",
      component: null!,
      tab: "history",
      order: 0,
    },
    {
      id: "submissions",
      title: "Website Submissions",
      component: null!,
      tab: "history",
      order: 5,
    },
    // Admin tab
    {
      id: "aliases",
      title: "Previous Names",
      component: null!,
      tab: "admin",
      order: 0,
    },
    {
      id: "data-sources",
      title: "Data Sources",
      component: null!,
      tab: "admin",
      order: 5,
      showWhen: (data) => (data.person?.identifiers?.length ?? 0) > 0,
    },
  ],

  tabs: [
    { id: "main", label: "Overview" },
    { id: "details", label: "Details", icon: "📋" },
    { id: "history", label: "History", icon: "📜", count: (data) => data.requests.length },
    { id: "admin", label: "Admin", icon: "⚙️" },
  ],

  stats: [
    {
      label: "Cats",
      value: (data) => data.person?.cat_count ?? 0,
      icon: "🐱",
    },
    {
      label: "Places",
      value: (data) => data.person?.place_count ?? 0,
      icon: "📍",
    },
    {
      label: "Requests",
      value: (data) => data.requests.length,
      icon: "📋",
      href: (data) => `/requests?person_id=${data.person?.person_id}`,
    },
    {
      label: "Hours Logged",
      value: (data) => data.volunteerRoles?.volunteer_profile?.hours_logged ?? 0,
      icon: "⏱️",
      showWhen: (data) => data.volunteerRoles?.volunteer_profile?.hours_logged != null,
    },
  ],

  actions: [
    {
      id: "email",
      label: "Email",
      icon: "✉️",
      showWhen: (data) => !!data.primaryEmail && !data.person?.do_not_contact,
    },
    {
      id: "print",
      label: "Print",
      href: (data) => `/people/${data.person?.person_id}/print`,
      external: true,
    },
    {
      id: "history",
      label: "History",
    },
  ],

  badges: [],
};
