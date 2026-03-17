import type { ComponentType, ReactNode } from "react";

/**
 * Generic section props passed to every section component rendered by SectionRenderer.
 * TData is the entity-specific data type (e.g., PersonDetailData, CatDetailData).
 */
export interface EntitySectionProps<TData> {
  entityId: string;
  data: TData;
  onDataChange?: (what?: string) => void;
}

/**
 * Defines a single section in an entity detail page.
 */
export interface EntitySectionDef<TData> {
  id: string;
  title: string;
  component: ComponentType<EntitySectionProps<TData>>;
  tab: string;
  order: number;
  showWhen?: (data: TData) => boolean;
  defaultCollapsed?: boolean;
}

/**
 * Defines a tab in an entity detail page.
 */
export interface EntityTabDef<TData> {
  id: string;
  label: string;
  icon?: string;
  count?: (data: TData) => number;
}

/**
 * Defines a stat item for the sidebar.
 */
export interface EntityStatDef<TData> {
  label: string;
  value: (data: TData) => string | number | ReactNode;
  icon?: string;
  href?: string | ((data: TData) => string);
  showWhen?: (data: TData) => boolean;
}

/**
 * Full configuration for an entity detail page.
 */
export interface EntityConfig<TData> {
  sections: EntitySectionDef<TData>[];
  tabs: EntityTabDef<TData>[];
  stats: EntityStatDef<TData>[];
}
