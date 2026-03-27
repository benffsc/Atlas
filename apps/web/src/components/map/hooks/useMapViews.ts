import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type * as L from "leaflet";
import { useToast } from "@/components/feedback/Toast";
import { SYSTEM_VIEWS, loadCustomViews, addCustomView, deleteCustomView, viewToEnabledLayers, enabledLayersToList, type MapView } from "@/lib/map-views";
import { LEGACY_LAYER_CONFIGS } from "@/components/map/types";

export { SYSTEM_VIEWS };
export type { MapView };

interface UseMapViewsOptions {
  mapRef: React.MutableRefObject<L.Map | null>;
  enabledLayers: Record<string, boolean>;
  setEnabledLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSelectedZone: React.Dispatch<React.SetStateAction<string>>;
  setDateFrom: React.Dispatch<React.SetStateAction<string | null>>;
  setDateTo: React.Dispatch<React.SetStateAction<string | null>>;
  dateFrom: string | null;
  dateTo: string | null;
  selectedZone: string;
  atlasMapLayerGroupsBase: Array<{ id: string; children: Array<{ id: string }> }>;
}

export function useMapViews({ mapRef, enabledLayers, setEnabledLayers, setSelectedZone, setDateFrom, setDateTo, dateFrom, dateTo, selectedZone, atlasMapLayerGroupsBase }: UseMapViewsOptions) {
  const { addToast } = useToast();
  const [customViews, setCustomViews] = useState<MapView[]>(() => loadCustomViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const allLayerIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of atlasMapLayerGroupsBase) { for (const child of group.children) ids.push(child.id); }
    for (const l of LEGACY_LAYER_CONFIGS) ids.push(l.id);
    return ids;
  }, [atlasMapLayerGroupsBase]);

  const handleApplyView = useCallback((view: MapView) => {
    const newLayers = viewToEnabledLayers(view, allLayerIds);
    setEnabledLayers(newLayers); setActiveViewId(view.id);
    if (view.zone) setSelectedZone(view.zone);
    if (view.dateFrom !== undefined) setDateFrom(view.dateFrom);
    if (view.dateTo !== undefined) setDateTo(view.dateTo);
    if (view.zoom && view.center && mapRef.current) mapRef.current.setView(view.center, view.zoom);
    addToast({ type: "success", message: `View: ${view.name}` });
  }, [allLayerIds, addToast, mapRef, setEnabledLayers, setSelectedZone, setDateFrom, setDateTo]);

  const handleSaveView = useCallback((name: string) => {
    const map = mapRef.current;
    const newView = addCustomView({ name, layers: enabledLayersToList(enabledLayers), zoom: map?.getZoom(), center: map ? [map.getCenter().lat, map.getCenter().lng] : undefined, dateFrom, dateTo, zone: selectedZone !== "All Zones" ? selectedZone : undefined });
    setCustomViews(loadCustomViews()); setActiveViewId(newView.id);
    addToast({ type: "success", message: `Saved view: ${name}` });
  }, [enabledLayers, dateFrom, dateTo, selectedZone, addToast, mapRef]);

  const handleDeleteView = useCallback((id: string) => {
    deleteCustomView(id); setCustomViews(loadCustomViews());
    if (activeViewId === id) setActiveViewId(null);
  }, [activeViewId]);

  const prevLayersRef = useRef(enabledLayers);
  useEffect(() => {
    if (prevLayersRef.current !== enabledLayers && activeViewId) {
      const view = [...SYSTEM_VIEWS, ...customViews].find((v) => v.id === activeViewId);
      if (view) {
        const viewLayers = new Set(view.layers);
        const currentLayers = new Set(enabledLayersToList(enabledLayers));
        if (viewLayers.size !== currentLayers.size || ![...viewLayers].every((l) => currentLayers.has(l))) setActiveViewId(null);
      }
    }
    prevLayersRef.current = enabledLayers;
  }, [enabledLayers, activeViewId, customViews]);

  return { customViews, activeViewId, handleApplyView, handleSaveView, handleDeleteView };
}
