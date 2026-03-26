/**
 * Map Saved Views
 *
 * Built-in system views + user-saved custom views stored in localStorage.
 * Each view captures: enabled layers, zoom, center, date range, zone.
 */

export interface MapView {
  id: string;
  name: string;
  isSystem: boolean;
  layers: string[]; // IDs of enabled layers
  zoom?: number;
  center?: [number, number]; // [lat, lng]
  dateFrom?: string | null;
  dateTo?: string | null;
  zone?: string;
}

/** Built-in system views for demo + daily workflows */
export const SYSTEM_VIEWS: MapView[] = [
  {
    id: "sys_full_picture",
    name: "Full Picture",
    isSystem: true,
    layers: ["atlas_all"],
  },
  {
    id: "sys_disease_overview",
    name: "Disease Overview",
    isSystem: true,
    layers: ["atlas_disease"],
  },
  {
    id: "sys_tnr_priority",
    name: "TNR Priority",
    isSystem: true,
    layers: ["atlas_needs_tnr"],
  },
  {
    id: "sys_trapper_assignments",
    name: "Trapper Assignments",
    isSystem: true,
    layers: ["atlas_needs_trapper", "trapper_territories"],
  },
  {
    id: "sys_cat_density",
    name: "Cat Density Heatmap",
    isSystem: true,
    layers: ["atlas_all", "heatmap_density"],
  },
  {
    id: "sys_disease_heatmap",
    name: "Disease Heatmap",
    isSystem: true,
    layers: ["atlas_disease", "heatmap_disease"],
  },
];

const STORAGE_KEY = "map-saved-views";

export function loadCustomViews(): MapView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MapView[];
  } catch {
    return [];
  }
}

export function saveCustomViews(views: MapView[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

export function addCustomView(view: Omit<MapView, "id" | "isSystem">): MapView {
  const custom = loadCustomViews();
  const newView: MapView = {
    ...view,
    id: `custom_${Date.now()}`,
    isSystem: false,
  };
  custom.push(newView);
  saveCustomViews(custom);
  return newView;
}

export function deleteCustomView(id: string): void {
  const custom = loadCustomViews().filter((v) => v.id !== id);
  saveCustomViews(custom);
}

export function getAllViews(): MapView[] {
  return [...SYSTEM_VIEWS, ...loadCustomViews()];
}

/**
 * Build enabledLayers record from a view's layer list.
 * All known layer IDs start as false, then the view's layers are set to true.
 */
export function viewToEnabledLayers(
  view: MapView,
  allLayerIds: string[]
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const id of allLayerIds) result[id] = false;
  for (const id of view.layers) {
    if (id in result) result[id] = true;
  }
  return result;
}

/**
 * Extract enabled layer IDs from a layers record.
 */
export function enabledLayersToList(enabledLayers: Record<string, boolean>): string[] {
  return Object.keys(enabledLayers).filter((k) => enabledLayers[k]);
}
