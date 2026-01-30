"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

export interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
  /** Hide this tab conditionally */
  show?: boolean;
  /** Count badge next to label */
  badge?: number | string;
}

interface ProfileLayoutProps {
  /** Persistent header (back button, name, badges, actions) */
  header: React.ReactNode;
  tabs: Tab[];
  defaultTab?: string;
  /** Content rendered below tabs (modals, history panels) */
  children?: React.ReactNode;
}

export function ProfileLayout({ header, tabs, defaultTab, children }: ProfileLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visibleTabs = tabs.filter((t) => t.show !== false);
  const urlTab = searchParams.get("tab");
  const activeTab = visibleTabs.find((t) => t.id === urlTab)?.id
    || visibleTabs.find((t) => t.id === defaultTab)?.id
    || visibleTabs[0]?.id;

  const setActiveTab = useCallback(
    (tabId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tabId === (defaultTab || visibleTabs[0]?.id)) {
        params.delete("tab");
      } else {
        params.set("tab", tabId);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname, defaultTab, visibleTabs],
  );

  const activeContent = visibleTabs.find((t) => t.id === activeTab)?.content;

  return (
    <>
      {header}

      {visibleTabs.length > 1 && (
        <div className="profile-tabs">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`profile-tab${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.badge != null && (
                <span className="tab-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {activeContent}

      {children}
    </>
  );
}
