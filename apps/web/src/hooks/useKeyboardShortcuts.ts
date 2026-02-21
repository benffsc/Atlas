"use client";

/**
 * useKeyboardShortcuts - Global keyboard shortcut system
 *
 * Provides keyboard shortcuts for common actions.
 * Shortcuts are disabled when user is typing in an input/textarea.
 *
 * Usage:
 *   useKeyboardShortcuts({
 *     "cmd+k": () => openSearch(),
 *     "escape": () => closeModal(),
 *   });
 */

import { useEffect, useCallback, useRef } from "react";

type KeyHandler = () => void;

interface ShortcutConfig {
  [key: string]: KeyHandler;
}

/**
 * Parse a shortcut string into a normalized form
 * "cmd+k" -> { key: "k", meta: true, ctrl: false, alt: false, shift: false }
 * "ctrl+shift+s" -> { key: "s", meta: false, ctrl: true, alt: false, shift: true }
 */
function parseShortcut(shortcut: string) {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1];

  return {
    key,
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt") || parts.includes("option"),
    shift: parts.includes("shift"),
  };
}

/**
 * Check if the current event target is an input element
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  // Check for contenteditable
  if (target.getAttribute("contenteditable") === "true") {
    return true;
  }

  return false;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutConfig,
  options: { enableInInputs?: boolean } = {}
) {
  const { enableInInputs = false } = options;
  const shortcutsRef = useRef(shortcuts);

  // Update ref when shortcuts change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Skip if typing in an input (unless enableInInputs is true)
    if (!enableInInputs && isInputElement(event.target)) {
      // Exception: Escape key always works
      if (event.key !== "Escape") {
        return;
      }
    }

    const currentShortcuts = shortcutsRef.current;

    for (const [shortcut, handler] of Object.entries(currentShortcuts)) {
      const parsed = parseShortcut(shortcut);

      const keyMatch = event.key.toLowerCase() === parsed.key;
      const metaMatch = event.metaKey === parsed.meta;
      const ctrlMatch = event.ctrlKey === parsed.ctrl;
      const altMatch = event.altKey === parsed.alt;
      const shiftMatch = event.shiftKey === parsed.shift;

      if (keyMatch && metaMatch && ctrlMatch && altMatch && shiftMatch) {
        event.preventDefault();
        handler();
        return;
      }
    }
  }, [enableInInputs]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Common shortcuts for reference
export const COMMON_SHORTCUTS = {
  // Navigation
  SEARCH: "cmd+k",
  HOME: "cmd+h",
  BACK: "escape",

  // Actions
  SAVE: "cmd+s",
  NEW: "cmd+n",
  REFRESH: "cmd+r",

  // Selection
  SELECT_ALL: "cmd+a",
  DESELECT: "escape",

  // View
  TOGGLE_SIDEBAR: "cmd+b",
  TOGGLE_FULLSCREEN: "cmd+shift+f",
} as const;

/**
 * useGlobalShortcuts - Pre-configured global shortcuts
 *
 * Provides common navigation shortcuts. Call at app root level.
 */
export function useGlobalShortcuts(handlers: {
  onSearch?: () => void;
  onEscape?: () => void;
  onSave?: () => void;
  onNew?: () => void;
}) {
  const shortcuts: ShortcutConfig = {};

  if (handlers.onSearch) shortcuts[COMMON_SHORTCUTS.SEARCH] = handlers.onSearch;
  if (handlers.onEscape) shortcuts[COMMON_SHORTCUTS.BACK] = handlers.onEscape;
  if (handlers.onSave) shortcuts[COMMON_SHORTCUTS.SAVE] = handlers.onSave;
  if (handlers.onNew) shortcuts[COMMON_SHORTCUTS.NEW] = handlers.onNew;

  useKeyboardShortcuts(shortcuts);
}

/**
 * Display a keyboard shortcut in a human-readable format
 * "cmd+k" -> "⌘K" (on Mac) or "Ctrl+K" (on Windows)
 */
export function formatShortcut(shortcut: string): string {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const parts = shortcut.split("+");
  const formatted = parts.map((part) => {
    switch (part.toLowerCase()) {
      case "cmd":
      case "meta":
        return isMac ? "⌘" : "Ctrl";
      case "ctrl":
        return isMac ? "⌃" : "Ctrl";
      case "alt":
      case "option":
        return isMac ? "⌥" : "Alt";
      case "shift":
        return isMac ? "⇧" : "Shift";
      default:
        return part.toUpperCase();
    }
  });

  return isMac ? formatted.join("") : formatted.join("+");
}
