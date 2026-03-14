import type { ComponentType } from "react";
import type { SectionProps } from "./types";

/**
 * Global registry of section components.
 *
 * Section components are registered here so that configs can reference them
 * by ID without circular imports. Components are lazy-loaded via dynamic imports.
 */
const SECTION_REGISTRY = new Map<string, ComponentType<SectionProps>>();

/**
 * Register a section component. Called at module load time by section files.
 */
export function registerSection(id: string, component: ComponentType<SectionProps>) {
  SECTION_REGISTRY.set(id, component);
}

/**
 * Look up a section component by ID.
 */
export function getSection(id: string): ComponentType<SectionProps> | undefined {
  return SECTION_REGISTRY.get(id);
}

/**
 * Get all registered section IDs (for debugging).
 */
export function getRegisteredSectionIds(): string[] {
  return Array.from(SECTION_REGISTRY.keys());
}
