"use client";

import { ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  icon?: string;
  count?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  size?: "sm" | "md" | "lg";
}

/**
 * Simple tab bar for switching between content sections.
 * Use with useState to manage active tab.
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useState("details");
 * <TabBar
 *   tabs={[
 *     { id: "details", label: "Details" },
 *     { id: "activity", label: "Activity", count: 12 },
 *     { id: "admin", label: "Admin", icon: "⚙️" },
 *   ]}
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 * />
 * ```
 */
export function TabBar({ tabs, activeTab, onTabChange, size = "md" }: TabBarProps) {
  const padding = size === "sm" ? "0.35rem 0.75rem" : size === "lg" ? "0.75rem 1.5rem" : "0.5rem 1rem";
  const fontSize = size === "sm" ? "0.8rem" : size === "lg" ? "1rem" : "0.9rem";

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: "0.25rem",
        borderBottom: "2px solid #e5e7eb",
        marginBottom: "1rem",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            data-testid={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding,
              fontSize,
              fontWeight: 600,
              color: isActive ? "#166534" : "#6b7280",
              background: isActive ? "#f0fdf4" : "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid #166534" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              transition: "all 0.15s ease",
            }}
          >
            {tab.icon && <span>{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span
                style={{
                  background: isActive ? "#166534" : "#d1d5db",
                  color: isActive ? "#fff" : "#4b5563",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  children: ReactNode;
  tabId: string;
  activeTab: string;
}

/**
 * Content panel that shows only when its tab is active.
 *
 * @example
 * ```tsx
 * <TabPanel tabId="details" activeTab={activeTab}>
 *   <DetailsContent />
 * </TabPanel>
 * ```
 */
export function TabPanel({ children, tabId, activeTab }: TabPanelProps) {
  if (tabId !== activeTab) return null;
  return <div role="tabpanel" data-testid={`tabpanel-${tabId}`}>{children}</div>;
}

export default TabBar;
