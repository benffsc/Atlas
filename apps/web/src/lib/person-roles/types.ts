import type { ComponentType, ReactNode } from "react";
import type { PersonDetailData } from "@/hooks/usePersonDetail";

/**
 * Role types supported by the person detail system.
 * 'base' sections appear for all persons.
 */
export type RoleType = "base" | "trapper" | "foster" | "volunteer" | "caretaker" | "staff";

/**
 * Props passed to every section component rendered by SectionRenderer.
 */
export interface SectionProps {
  /** Person UUID */
  personId: string;
  /** Full person detail data from usePersonDetail */
  data: PersonDetailData;
  /** Callback to refetch specific data after mutations */
  onDataChange?: (what?: "person" | "journal" | "trapper" | "all") => void;
}

/**
 * Defines a single section in the person detail page.
 */
export interface SectionDefinition {
  /** Unique section ID (e.g., "journal", "contract-profile") */
  id: string;
  /** Display title for the section header */
  title: string;
  /** React component to render */
  component: ComponentType<SectionProps>;
  /** Which tab this section belongs to */
  tab: string;
  /** Sort order within tab (lower = higher) */
  order: number;
  /** Conditional visibility — return false to hide */
  showWhen?: (data: PersonDetailData) => boolean;
  /** Whether the section should start collapsed */
  defaultCollapsed?: boolean;
}

/**
 * Defines a tab in the person detail page.
 */
export interface TabDefinition {
  id: string;
  label: string;
  icon?: string;
  /** Dynamic count badge */
  count?: (data: PersonDetailData) => number;
}

/**
 * Defines an action button in the entity header.
 */
export interface ActionDefinition {
  id: string;
  label: string;
  icon?: string;
  /** When to show this action */
  showWhen?: (data: PersonDetailData) => boolean;
  /** Link href (mutually exclusive with onClick) */
  href?: string | ((data: PersonDetailData) => string);
  /** Whether link opens in new tab */
  external?: boolean;
}

/**
 * Defines a stat item for the sidebar.
 */
export interface StatDefinition {
  label: string;
  value: (data: PersonDetailData) => string | number | ReactNode;
  icon?: string;
  href?: string | ((data: PersonDetailData) => string);
  showWhen?: (data: PersonDetailData) => boolean;
}

/**
 * Defines a badge to show in the entity header.
 */
export interface BadgeDefinition {
  id: string;
  render: (data: PersonDetailData) => ReactNode;
  showWhen?: (data: PersonDetailData) => boolean;
}

/**
 * Configuration for a specific role.
 * Merged with base config to produce the final page config.
 */
export interface RoleConfig {
  role: RoleType;
  /** Sections contributed by this role */
  sections: SectionDefinition[];
  /** Tabs contributed by this role */
  tabs: TabDefinition[];
  /** Stats for the sidebar */
  stats: StatDefinition[];
  /** Action buttons for the header */
  actions: ActionDefinition[];
  /** Badges for the header */
  badges: BadgeDefinition[];
}

/**
 * Merged configuration used by PersonDetailShell.
 */
export interface MergedConfig {
  sections: SectionDefinition[];
  tabs: TabDefinition[];
  stats: StatDefinition[];
  actions: ActionDefinition[];
  badges: BadgeDefinition[];
  roles: RoleType[];
}
