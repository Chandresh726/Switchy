"use client";

import { useEffect, useCallback } from "react";

type KeyHandler = (event: KeyboardEvent) => void;

interface UseKeyboardShortcutOptions {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  handler: KeyHandler;
  enabled?: boolean;
}

export function useKeyboardShortcut({
  key,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
  handler,
  enabled = true,
}: UseKeyboardShortcutOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Check if target is an input or textarea
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      const isMatch =
        event.key.toLowerCase() === key.toLowerCase() &&
        event.ctrlKey === ctrlKey &&
        event.metaKey === metaKey &&
        event.shiftKey === shiftKey &&
        event.altKey === altKey;

      if (isMatch) {
        event.preventDefault();
        handler(event);
      }
    },
    [key, ctrlKey, metaKey, shiftKey, altKey, handler, enabled]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Common keyboard shortcuts hook
export function useGlobalShortcuts() {
  useKeyboardShortcut({
    key: "/",
    handler: () => {
      const searchInput = document.querySelector<HTMLInputElement>(
        '[placeholder*="Search"]'
      );
      if (searchInput) {
        searchInput.focus();
      }
    },
  });

  useKeyboardShortcut({
    key: "Escape",
    handler: () => {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement) {
        activeElement.blur();
      }
    },
  });
}
