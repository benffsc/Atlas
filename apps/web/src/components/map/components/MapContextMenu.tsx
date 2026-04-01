import { useEffect, useState } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

const mp = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const RulerIcon = () => <svg {...mp}><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z" /><path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /></svg>;
const DirIcon = () => <svg {...mp}><path d="M3 11l19-9-9 19-2-8-8-2z" /></svg>;
const SvIcon = () => <svg {...mp}><circle cx="12" cy="5" r="3" /><path d="M12 8v4" /><path d="M6.5 17.5C6.5 15 9 13 12 13s5.5 2 5.5 4.5" /></svg>;
const PinIcon = () => <svg {...mp}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const NoteIcon = () => <svg {...mp}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const CopyIcon = () => <svg {...mp}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;

interface Props { contextMenu: { x: number; y: number; lat: number; lng: number }; onMeasure: () => void; onDirections: () => void; onStreetView: () => void; onAddPlace: () => void; onAddNote: () => void; onCopyCoords: () => void; }

export function MapContextMenu({ contextMenu, onMeasure, onDirections, onStreetView, onAddPlace, onAddNote, onCopyCoords }: Props) {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Reverse geocode to show address
  useEffect(() => {
    setAddress(null);
    if (typeof google === "undefined") return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat: contextMenu.lat, lng: contextMenu.lng } }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        setAddress(results[0].formatted_address);
      }
    });
  }, [contextMenu.lat, contextMenu.lng]);

  const coords = `${contextMenu.lat.toFixed(5)}, ${contextMenu.lng.toFixed(5)}`;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
    onCopyCoords();
  };

  return (
    <div className="map-context-menu" role="menu" style={{ position: "absolute", left: contextMenu.x, top: contextMenu.y, zIndex: MAP_Z_INDEX.controls + 10 }}>
      <div className="map-context-menu__coords">
        {address || coords}
      </div>
      {address && (
        <div style={{ padding: "0 12px 4px", fontSize: 10, color: "var(--text-tertiary, #9ca3af)" }}>
          {coords}
        </div>
      )}
      <button className="map-context-menu__item" role="menuitem" onClick={onMeasure}><RulerIcon /> Measure from here</button>
      <button className="map-context-menu__item" role="menuitem" onClick={onDirections}><DirIcon /> Directions to here</button>
      <button className="map-context-menu__item" role="menuitem" onClick={onStreetView}><SvIcon /> Street View</button>
      <div className="map-context-menu__divider" />
      <button className="map-context-menu__item" role="menuitem" onClick={onAddPlace}><PinIcon /> Add place here</button>
      <button className="map-context-menu__item" role="menuitem" onClick={onAddNote}><NoteIcon /> Add note here</button>
      <div className="map-context-menu__divider" />
      {address && (
        <button className="map-context-menu__item" role="menuitem" onClick={() => handleCopy(address, "address")}>
          <CopyIcon /> {copied === "address" ? "Copied!" : "Copy address"}
        </button>
      )}
      <button className="map-context-menu__item" role="menuitem" onClick={() => handleCopy(coords, "coords")}>
        <CopyIcon /> {copied === "coords" ? "Copied!" : "Copy coordinates"}
      </button>
    </div>
  );
}
