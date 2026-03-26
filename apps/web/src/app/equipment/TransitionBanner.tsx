"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

/**
 * Dismissible info banner shown during Airtable → Atlas equipment transition.
 * Controlled by `ops.app_config` key `equipment.transition_active`.
 * Dismissal persisted in sessionStorage so it stays hidden for the tab session.
 */
export function TransitionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // If already dismissed this session, don't fetch
    if (sessionStorage.getItem("equipment-transition-dismissed")) return;

    fetchApi<{ transition_active: boolean }>("/api/equipment/sync-status")
      .then((d) => {
        if (d.transition_active) setVisible(true);
      })
      .catch(() => {});
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "0.625rem 1rem",
        marginBottom: "1rem",
        borderRadius: "8px",
        background: "var(--info-bg)",
        border: "1px solid var(--info-border)",
        color: "var(--info-text)",
        fontSize: "0.85rem",
      }}
    >
      <span>
        Equipment is transitioning to Atlas. Use the Kiosk for checkouts. Airtable syncs every 4h.
      </span>
      <button
        onClick={() => {
          setVisible(false);
          sessionStorage.setItem("equipment-transition-dismissed", "1");
        }}
        style={{
          background: "none",
          border: "none",
          color: "var(--info-text)",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          padding: "0.25rem",
          flexShrink: 0,
          opacity: 0.7,
        }}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
