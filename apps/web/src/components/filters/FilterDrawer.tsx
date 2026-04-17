"use client";

/**
 * FilterDrawer — Right-side drawer for complex filter controls.
 *
 * FFS-1261 / Dom Design: For pages with 4+ filters, moves filter controls
 * into an ActionDrawer. Keep search + 1-2 primary selects inline in FilterBar.
 * Show ActiveFilterTags when drawer is closed.
 *
 * Usage:
 *   const [drawerOpen, setDrawerOpen] = useState(false);
 *
 *   <FilterBar>
 *     <SearchInput ... />
 *     <Button icon="sliders-horizontal" onClick={() => setDrawerOpen(true)}>
 *       Filters {activeCount > 0 && `(${activeCount})`}
 *     </Button>
 *   </FilterBar>
 *   <ActiveFilterTags ... />
 *   <FilterDrawer
 *     isOpen={drawerOpen}
 *     onClose={() => setDrawerOpen(false)}
 *     onClear={clearFilters}
 *     activeCount={activeCount}
 *   >
 *     <FilterDrawerSection label="Sex">
 *       <ToggleButtonGroup ... />
 *     </FilterDrawerSection>
 *   </FilterDrawer>
 */

import { type ReactNode } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";

interface FilterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onClear?: () => void;
  /** Number of active (non-default) filters — shown in header */
  activeCount?: number;
  children: ReactNode;
}

export function FilterDrawer({
  isOpen,
  onClose,
  onClear,
  activeCount = 0,
  children,
}: FilterDrawerProps) {
  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Filters${activeCount > 0 ? ` (${activeCount})` : ""}`}
      width="md"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          {onClear && activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onClear(); onClose(); }}
            >
              Clear all
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {children}
      </div>
    </ActionDrawer>
  );
}

// ── Section within the drawer ───────────────────────────────────────────────

interface FilterDrawerSectionProps {
  label: string;
  children: ReactNode;
}

export function FilterDrawerSection({ label, children }: FilterDrawerSectionProps) {
  return (
    <div>
      <div style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "var(--text-muted, #6b7280)",
        marginBottom: "0.5rem",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}
