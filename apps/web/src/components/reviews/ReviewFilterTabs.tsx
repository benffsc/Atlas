"use client";

export interface FilterTab {
  key: string;
  label: string;
  count: number;
  color: string;
}

export interface ReviewFilterTabsProps {
  tabs: FilterTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function ReviewFilterTabs({
  tabs,
  activeTab,
  onTabChange,
}: ReviewFilterTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: isActive ? tab.color : "transparent",
              color: isActive ? "#fff" : "var(--foreground)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {tab.label}
            <span
              style={{
                marginLeft: "0.5rem",
                background: isActive
                  ? "rgba(255,255,255,0.2)"
                  : "var(--bg-muted)",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ReviewFilterTabs;
