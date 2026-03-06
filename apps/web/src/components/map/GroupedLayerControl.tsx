"use client";

import { useState, useRef, useEffect } from "react";

export interface LayerItem {
  id: string;
  label: string;
  color: string;
  defaultEnabled: boolean;
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

export interface GroupedLayerControlProps {
  groups: LayerGroup[];
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  counts?: Record<string, number>;
  /** Compact mode for dashboard (smaller font, tighter spacing) */
  compact?: boolean;
}

export function GroupedLayerControl({
  groups,
  enabledLayers,
  onToggleLayer,
  counts,
  compact = false,
}: GroupedLayerControlProps) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(groups.map((g) => [g.id, g.defaultExpanded]))
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

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
          {groups.map((group) => {
            const isExpanded = expandedGroups[group.id];
            const groupActiveCount = group.children.filter(
              (c) => enabledLayers[c.id]
            ).length;

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
                  <span className="layer-group-icon">{group.icon || "📍"}</span>
                  <span className="layer-group-label">{group.label}</span>
                  {groupActiveCount > 0 && (
                    <span className="layer-group-badge">{groupActiveCount}</span>
                  )}
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
                          <span
                            className="layer-color-swatch"
                            style={{ background: item.color }}
                          />
                          {group.exclusive ? (
                            <span className={`layer-radio${isOn ? " checked" : ""}`} />
                          ) : (
                            <span className={`layer-check${isOn ? " checked" : ""}`} />
                          )}
                          <span className="layer-item-label">{item.label}</span>
                          {count !== undefined && (
                            <span className="layer-count-badge">{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
