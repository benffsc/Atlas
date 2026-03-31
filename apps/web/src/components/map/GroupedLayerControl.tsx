"use client";

import { useState, useRef, useEffect } from "react";

export interface LayerItem {
  id: string;
  label: string;
  color: string;
  defaultEnabled: boolean;
  /** Show a small pin SVG swatch next to the label */
  pinSwatch?: "teardrop" | "circle";
  /** Override swatch size (default: 12) */
  pinSwatchSize?: number;
}

export interface LayerGroup {
  id: string;
  label: string;
  icon?: string;
  color: string;
  defaultExpanded: boolean;
  /** When true, only one child can be active at a time (radio behavior) */
  exclusive?: boolean;
  children: LayerItem[];
}

export interface PinKeyConfig {
  colors: Array<{ color: string; label: string; shape: "teardrop" | "circle" }>;
  statusDots: Array<{ color: string; label: string }>;
  sizes: Array<{ label: string; detail: string }>;
}

export interface GroupedLayerControlProps {
  groups: LayerGroup[];
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  counts?: Record<string, number>;
  /** Set of layer IDs currently loading data (shows spinner next to label) */
  loadingLayers?: Set<string>;
  /** Compact mode for dashboard (smaller font, tighter spacing) */
  compact?: boolean;
  /** Inline mode renders groups directly without trigger button/popover (for sidebar panels) */
  inline?: boolean;
  /** Show a compact pin key (legend) below the layer toggles */
  pinKey?: PinKeyConfig;
}

/** Small pin shape for layer toggle items — shows what each layer looks like */
function PinSwatchIcon({ shape, color, size }: { shape: "teardrop" | "circle"; color: string; size: number }) {
  if (shape === "circle") {
    return (
      <span
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          border: "1.5px solid white",
          boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)",
          flexShrink: 0,
        }}
      />
    );
  }
  const h = Math.round(size * 1.35);
  return (
    <svg width={size} height={h} viewBox="0 0 24 32" style={{ flexShrink: 0 }}>
      <path
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
        d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
      />
      <circle cx="12" cy="10" r="4" fill="white" />
      <circle cx="12" cy="10" r="2" fill={color} />
    </svg>
  );
}

function LayerGroupList({
  groups,
  enabledLayers,
  onToggleLayer,
  counts,
  loadingLayers,
  defaultExpanded,
}: {
  groups: LayerGroup[];
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  counts?: Record<string, number>;
  loadingLayers?: Set<string>;
  defaultExpanded: Record<string, boolean>;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(defaultExpanded);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <>
      {groups.map((group) => {
        const isExpanded = expandedGroups[group.id];
        const groupActiveCount = group.children.filter(
          (c) => enabledLayers[c.id]
        ).length;
        const groupLoading = loadingLayers && group.children.some(c => loadingLayers.has(c.id));

        return (
          <div key={group.id} className="layer-group">
            <button
              className="layer-group-header"
              onClick={() => toggleGroup(group.id)}
            >
              <svg
                className={`layer-chevron${isExpanded ? " expanded" : ""}`}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M4 3L8 6L4 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="layer-group-icon">{group.icon || "\u{1F4CD}"}</span>
              <span className="layer-group-label">{group.label}</span>
              {groupActiveCount > 0 && (
                <span className="layer-group-badge">{groupActiveCount}</span>
              )}
              {groupLoading && <span className="layer-loading-spinner" />}
            </button>

            {isExpanded && (
              <div className="layer-group-children">
                {group.children.map((item) => {
                  const isOn = !!enabledLayers[item.id];
                  const count = counts?.[item.id];

                  return (
                    <button
                      key={item.id}
                      className={`layer-item${isOn ? " active" : ""}`}
                      onClick={() => onToggleLayer(item.id)}
                    >
                      {item.pinSwatch ? (
                        <PinSwatchIcon shape={item.pinSwatch} color={item.color} size={item.pinSwatchSize ?? 12} />
                      ) : (
                        <span
                          className="layer-color-swatch"
                          style={{ background: item.color }}
                        />
                      )}
                      {group.exclusive ? (
                        <span className={`layer-radio${isOn ? " checked" : ""}`} />
                      ) : (
                        <span className={`layer-check${isOn ? " checked" : ""}`} />
                      )}
                      <span className="layer-item-label">{item.label}</span>
                      {count !== undefined && (
                        <span className="layer-count-badge">{count}</span>
                      )}
                      {isOn && loadingLayers?.has(item.id) && (
                        <span className="layer-loading-spinner" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Compact pin key — shows color/shape, status dots, and size tiers */
function PinKeyPanel({ config }: { config: PinKeyConfig }) {
  const sectionTitle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4,
  };
  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, padding: "2px 0",
  };
  const label: React.CSSProperties = { fontSize: 11, color: "var(--text-secondary)" };

  return (
    <div className="pin-key-panel" style={{ borderTop: "1px solid var(--border-default)", marginTop: 8, paddingTop: 8 }}>
      {/* Color = Status */}
      <div style={sectionTitle}>Pin Colors</div>
      {config.colors.map(({ color, label: lbl, shape }) => (
        <div key={lbl} style={row}>
          <PinSwatchIcon shape={shape} color={color} size={12} />
          <span style={label}>{lbl}</span>
        </div>
      ))}

      {/* Status dots */}
      {config.statusDots.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>Status Dots</div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2 }}>
            Bottom-right indicator (zoom 11+)
          </div>
          {config.statusDots.map(({ color, label: lbl }) => (
            <div key={lbl} style={row}>
              <span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: color, border: "1.5px solid white",
                boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)", flexShrink: 0,
              }} />
              <span style={label}>{lbl}</span>
            </div>
          ))}
        </>
      )}

      {/* Size tiers */}
      {config.sizes.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>Pin Size</div>
          {config.sizes.map(({ label: lbl, detail }) => (
            <div key={lbl} style={row}>
              <span style={{ ...label, fontWeight: 500 }}>{lbl}</span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{detail}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function GroupedLayerControl({
  groups,
  enabledLayers,
  onToggleLayer,
  counts,
  loadingLayers,
  compact = false,
  inline = false,
  pinKey,
}: GroupedLayerControlProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const defaultExpanded = Object.fromEntries(
    groups.map((g) => [g.id, g.defaultExpanded])
  );

  // Close on outside click (only for popover mode)
  useEffect(() => {
    if (inline || !open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, inline]);

  // Inline mode: render groups directly without trigger/popover
  if (inline) {
    return (
      <div className={`grouped-layer-control inline${compact ? " compact" : ""}`}>
        <LayerGroupList
          groups={groups}
          enabledLayers={enabledLayers}
          onToggleLayer={onToggleLayer}
          counts={counts}
          loadingLayers={loadingLayers}
          defaultExpanded={defaultExpanded}
        />
        {pinKey && <PinKeyPanel config={pinKey} />}
      </div>
    );
  }

  // Count active layers across all groups
  const activeCount = Object.values(enabledLayers).filter(Boolean).length;

  return (
    <div className={`grouped-layer-control${compact ? " compact" : ""}`} ref={panelRef}>
      <button
        className={`grouped-layer-trigger${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        title="Map Layers"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1L1 5L8 9L15 5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M1 8L8 12L15 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M1 11L8 15L15 11" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        Layers
        {activeCount > 0 && (
          <span className="layer-active-badge">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="grouped-layer-panel">
          <LayerGroupList
            groups={groups}
            enabledLayers={enabledLayers}
            onToggleLayer={onToggleLayer}
            counts={counts}
            loadingLayers={loadingLayers}
            defaultExpanded={defaultExpanded}
          />
        </div>
      )}
    </div>
  );
}
