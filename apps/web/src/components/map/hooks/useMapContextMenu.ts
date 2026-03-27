import { useState, useCallback, useEffect } from "react";
import type * as L from "leaflet";
import { useToast } from "@/components/feedback/Toast";

interface ContextMenuState { x: number; y: number; lat: number; lng: number; }

interface UseMapContextMenuOptions {
  mapRef: React.MutableRefObject<L.Map | null>;
  measurement: { addPoint: (latlng: { lat: number; lng: number }) => void };
  setMeasureActive: React.Dispatch<React.SetStateAction<boolean>>;
  setAddPointMode: React.Dispatch<React.SetStateAction<"place" | "annotation" | null>>;
  setPendingClick: React.Dispatch<React.SetStateAction<{ lat: number; lng: number } | null>>;
  setShowAddPointMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setStreetViewCoords: React.Dispatch<React.SetStateAction<{ lat: number; lng: number; address?: string } | null>>;
  setStreetViewFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  setStreetViewConeOnly: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMapContextMenu({ mapRef, measurement, setMeasureActive, setAddPointMode, setPendingClick, setShowAddPointMenu, setStreetViewCoords, setStreetViewFullscreen, setStreetViewConeOnly }: UseMapContextMenuOptions) {
  const { addToast } = useToast();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const handleCtxMenu = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      const cp = map.latLngToContainerPoint(e.latlng);
      setContextMenu({ x: cp.x, y: cp.y, lat: e.latlng.lat, lng: e.latlng.lng });
    };
    const close = () => setContextMenu(null);
    map.on("contextmenu", handleCtxMenu);
    map.on("click", close);
    map.on("movestart", close);
    return () => { map.off("contextmenu", handleCtxMenu); map.off("click", close); map.off("movestart", close); };
  }, [mapRef]);

  const handleContextMeasure = useCallback(() => {
    if (!contextMenu) return;
    setMeasureActive(true); setAddPointMode(null); setPendingClick(null); setShowAddPointMenu(false);
    setTimeout(() => { measurement.addPoint({ lat: contextMenu.lat, lng: contextMenu.lng }); }, 50);
    setContextMenu(null);
  }, [contextMenu, measurement, setMeasureActive, setAddPointMode, setPendingClick, setShowAddPointMenu]);

  const handleContextAddPlace = useCallback(() => {
    if (!contextMenu) return;
    setAddPointMode("place"); setMeasureActive(false);
    setPendingClick({ lat: contextMenu.lat, lng: contextMenu.lng }); setContextMenu(null);
  }, [contextMenu, setAddPointMode, setMeasureActive, setPendingClick]);

  const handleContextAddNote = useCallback(() => {
    if (!contextMenu) return;
    setAddPointMode("annotation"); setMeasureActive(false);
    setPendingClick({ lat: contextMenu.lat, lng: contextMenu.lng }); setContextMenu(null);
  }, [contextMenu, setAddPointMode, setMeasureActive, setPendingClick]);

  const handleContextDirections = useCallback(() => {
    if (!contextMenu) return;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${contextMenu.lat},${contextMenu.lng}`, "_blank");
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextStreetView = useCallback(() => {
    if (!contextMenu) return;
    setStreetViewCoords({ lat: contextMenu.lat, lng: contextMenu.lng }); setStreetViewFullscreen(false); setStreetViewConeOnly(false);
    setContextMenu(null);
  }, [contextMenu, setStreetViewCoords, setStreetViewFullscreen, setStreetViewConeOnly]);

  const handleContextCopyCoords = useCallback(() => {
    if (!contextMenu) return;
    const text = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => { addToast({ type: "success", message: `Copied: ${text}` }); });
    setContextMenu(null);
  }, [contextMenu, addToast]);

  return { contextMenu, setContextMenu, handleContextMeasure, handleContextAddPlace, handleContextAddNote, handleContextDirections, handleContextStreetView, handleContextCopyCoords };
}
