import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { MAP_COLORS } from "@/lib/map-colors";
import { LAYER_CONFIGS, LEGACY_LAYER_CONFIGS } from "@/components/map/types";
import type { RiskFilter, DataFilter, AtlasPin } from "@/components/map/types";
import type { LayerGroup } from "@/components/map/GroupedLayerControl";

export const ATLAS_SUB_LAYER_IDS = ["atlas_all", "atlas_disease", "atlas_watch", "atlas_needs_tnr", "atlas_needs_trapper"] as const;
export const DISEASE_FILTER_IDS = ["dis_felv", "dis_fiv", "dis_ringworm", "dis_heartworm", "dis_panleuk"] as const;
export const HEATMAP_LAYER_IDS = ["heatmap_density", "heatmap_intact", "heatmap_disease"] as const;

export const ATLAS_MAP_LAYER_GROUPS_BASE: LayerGroup[] = [
  { id: "atlas_data", label: "Atlas Data", icon: "\u{1F4CD}", color: MAP_COLORS.layers.places, defaultExpanded: true, exclusive: true, children: [
    { id: "atlas_all", label: "All Places", color: MAP_COLORS.layers.places, defaultEnabled: true, pinSwatch: "teardrop" as const },
    { id: "atlas_disease", label: "Disease Risk", color: MAP_COLORS.pinStyle.disease, defaultEnabled: false, pinSwatch: "teardrop" as const },
    { id: "atlas_watch", label: "Watch List", color: MAP_COLORS.pinStyle.watch_list, defaultEnabled: false, pinSwatch: "teardrop" as const },
    { id: "atlas_needs_tnr", label: "Needs TNR", color: MAP_COLORS.priority.critical, defaultEnabled: false, pinSwatch: "teardrop" as const },
    { id: "atlas_needs_trapper", label: "Needs Trapper", color: MAP_COLORS.priority.high, defaultEnabled: false, pinSwatch: "teardrop" as const },
  ]},
  { id: "disease_filter", label: "Disease Filter", icon: "\u{1F9A0}", color: MAP_COLORS.pinStyle.disease, defaultExpanded: true, children: [
    { id: "dis_felv", label: "FeLV", color: MAP_COLORS.disease.felv, defaultEnabled: false },
    { id: "dis_fiv", label: "FIV", color: MAP_COLORS.disease.fiv, defaultEnabled: false },
    { id: "dis_ringworm", label: "Ringworm", color: MAP_COLORS.disease.ringworm, defaultEnabled: false },
    { id: "dis_heartworm", label: "Heartworm", color: MAP_COLORS.disease.heartworm, defaultEnabled: false },
    { id: "dis_panleuk", label: "Panleukopenia", color: MAP_COLORS.disease.panleukopenia, defaultEnabled: false },
  ]},
  { id: "analytics", label: "Analytics", icon: "\u{1F525}", color: MAP_COLORS.priority.high, defaultExpanded: false, exclusive: true, children: [
    { id: "heatmap_density", label: "Cat Density Heatmap", color: MAP_COLORS.layers.heatmap_density, defaultEnabled: false },
    { id: "heatmap_intact", label: "Intact Cat Heatmap", color: MAP_COLORS.layers.heatmap_intact, defaultEnabled: false },
    { id: "heatmap_disease", label: "Disease Heatmap", color: MAP_COLORS.layers.heatmap_disease, defaultEnabled: false },
  ]},
  { id: "operational", label: "Operational", icon: "\u{1F4CA}", color: MAP_COLORS.layers.zones, defaultExpanded: false, children: [
    { id: "zones", label: "Observation Zones", color: MAP_COLORS.layers.zones, defaultEnabled: false },
    { id: "volunteers", label: "Volunteers", color: MAP_COLORS.layers.volunteer_marker, defaultEnabled: false },
    { id: "clinic_clients", label: "Clinic Clients", color: MAP_COLORS.layers.clinic_clients, defaultEnabled: false },
    { id: "trapper_territories", label: "Trapper Coverage", color: MAP_COLORS.layers.trapper_coverage, defaultEnabled: false },
  ]},
  // "Historical" group removed — legacy layers (places, google_pins, tnr_priority,
  // historical_sources, data_coverage) overlap with atlas pins and are unused.
];

function getDefaults(): Record<string, boolean> {
  const r: Record<string, boolean> = {};
  for (const g of ATLAS_MAP_LAYER_GROUPS_BASE) for (const c of g.children) r[c.id] = c.defaultEnabled;
  for (const l of LEGACY_LAYER_CONFIGS) r[l.id] = l.defaultEnabled;
  return r;
}

function parseLayersParam(p: string | null): Record<string, boolean> | null {
  if (!p) return null;
  if (p === "none") { const d = getDefaults(); const r: Record<string, boolean> = {}; for (const id of Object.keys(d)) r[id] = false; return r; }
  const ids = p.split(",").filter(Boolean); if (ids.length === 0) return null;
  const d = getDefaults(); const k = new Set(Object.keys(d)); const v = ids.filter(id => k.has(id)); if (v.length === 0) return null;
  const r: Record<string, boolean> = {}; for (const id of Array.from(k)) r[id] = false; for (const id of v) r[id] = true; return r;
}

function serialize(el: Record<string, boolean>): string | null {
  const d = getDefaults();
  const cur = Object.keys(el).filter(k => el[k]).sort();
  const def = Object.keys(d).filter(k => d[k]).sort();
  if (cur.join(",") === def.join(",")) return null;
  if (cur.length === 0) return "none";
  return cur.join(",");
}

export function useMapLayers({ atlasPins }: { atlasPins: AtlasPin[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(() => {
    const fromUrl = parseLayersParam(searchParams.get("layers"));
    return fromUrl || Object.fromEntries(LAYER_CONFIGS.map(l => [l.id, l.defaultEnabled]));
  });

  useEffect(() => {
    const s = serialize(enabledLayers);
    const params = new URLSearchParams(searchParams.toString());
    if (s) params.set("layers", s); else params.delete("layers");
    const newUrl = params.toString() ? `${pathname}?${params}` : pathname;
    const curUrl = searchParams.toString() ? `${pathname}?${searchParams}` : pathname;
    if (newUrl !== curUrl) router.replace(newUrl, { scroll: false });
  }, [enabledLayers, pathname, router, searchParams]);

  const toggleLayer = useCallback((layerId: string) => {
    setEnabledLayers(prev => {
      const next = { ...prev };
      const group = ATLAS_MAP_LAYER_GROUPS_BASE.find(g => g.children.some(c => c.id === layerId));
      if (group?.exclusive) {
        const wasOn = !!prev[layerId];
        for (const child of group.children) next[child.id] = false;
        if (layerId !== "atlas_disease" || wasOn) for (const disId of DISEASE_FILTER_IDS) next[disId] = false;
        if (!wasOn) next[layerId] = true;
      } else { next[layerId] = !prev[layerId]; }
      return next;
    });
  }, []);

  const atlasLayerEnabled = useMemo(() => ATLAS_SUB_LAYER_IDS.some(id => enabledLayers[id]), [enabledLayers]);
  const riskFilter: RiskFilter = useMemo(() => {
    if (enabledLayers.atlas_disease) return "disease";
    if (enabledLayers.atlas_watch) return "watch_list";
    if (enabledLayers.atlas_needs_tnr) return "needs_tnr";
    if (enabledLayers.atlas_needs_trapper) return "needs_trapper";
    return "all";
  }, [enabledLayers]);
  const diseaseFilter: string[] = useMemo(() => {
    const a: string[] = [];
    if (enabledLayers.dis_felv) a.push("felv"); if (enabledLayers.dis_fiv) a.push("fiv");
    if (enabledLayers.dis_ringworm) a.push("ringworm"); if (enabledLayers.dis_heartworm) a.push("heartworm");
    if (enabledLayers.dis_panleuk) a.push("panleukopenia");
    return a;
  }, [enabledLayers]);
  const dataFilter: DataFilter = "all";
  const atlasMapLayerGroups = useMemo(() => enabledLayers.atlas_disease ? ATLAS_MAP_LAYER_GROUPS_BASE : ATLAS_MAP_LAYER_GROUPS_BASE.filter(g => g.id !== "disease_filter"), [enabledLayers.atlas_disease]);
  const atlasSubLayerCounts = useMemo(() => {
    const c: Record<string, number> = { atlas_all: atlasPins.length, atlas_disease: 0, atlas_watch: 0, atlas_needs_tnr: 0, atlas_needs_trapper: 0, dis_felv: 0, dis_fiv: 0, dis_ringworm: 0, dis_heartworm: 0, dis_panleuk: 0 };
    for (const p of atlasPins) {
      if (p.disease_risk) c.atlas_disease++; if (p.watch_list) c.atlas_watch++;
      if (p.cat_count > 0 && p.cat_count > p.total_altered) c.atlas_needs_tnr++;
      if (p.needs_trapper_count > 0) c.atlas_needs_trapper++;
      if (p.disease_badges) for (const b of p.disease_badges) {
        if (b.disease_key === "felv") c.dis_felv++; else if (b.disease_key === "fiv") c.dis_fiv++;
        else if (b.disease_key === "ringworm") c.dis_ringworm++; else if (b.disease_key === "heartworm") c.dis_heartworm++;
        else if (b.disease_key === "panleukopenia") c.dis_panleuk++;
      }
    }
    return c;
  }, [atlasPins]);
  const apiLayers = useMemo(() => {
    const s = new Set<string>();
    for (const [id, on] of Object.entries(enabledLayers)) {
      if (!on) continue;
      if ((ATLAS_SUB_LAYER_IDS as readonly string[]).includes(id)) s.add("atlas_pins");
      else if ((DISEASE_FILTER_IDS as readonly string[]).includes(id)) { /* client-only */ }
      else if ((HEATMAP_LAYER_IDS as readonly string[]).includes(id)) s.add("atlas_pins");
      else s.add(id);
    }
    return Array.from(s);
  }, [enabledLayers]);
  const heatmapEnabled = !!(enabledLayers.heatmap_density || enabledLayers.heatmap_intact || enabledLayers.heatmap_disease);
  const heatmapMode: "density" | "intact" | "disease" =
    enabledLayers.heatmap_disease ? "disease"
    : enabledLayers.heatmap_intact ? "intact"
    : "density";

  return { enabledLayers, setEnabledLayers, toggleLayer, atlasLayerEnabled, riskFilter, diseaseFilter, dataFilter, atlasMapLayerGroups, atlasSubLayerCounts, apiLayers, heatmapEnabled, heatmapMode };
}
