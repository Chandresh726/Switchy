"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

interface UseThemeReturn {
  theme: Theme;
  toggleTheme: () => void;
}

function getSystemPreference(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Module-level shared store so all useTheme() instances stay in sync
const listeners = new Set<() => void>();
let currentTheme: Theme = "dark";
let initialized = false;

function initStore() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const stored = localStorage.getItem("theme");
  currentTheme = (stored === "light" || stored === "dark") ? stored : getSystemPreference();

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", (e) => {
    const stored = localStorage.getItem("theme");
    if (!stored) {
      setThemeInternal(e.matches ? "dark" : "light");
    }
  });
}

function setThemeInternal(theme: Theme) {
  currentTheme = theme;
  localStorage.setItem("theme", theme);
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  initStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  initStore();
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "dark";
}

// Hydration detection
const emptySubscribe = () => () => {};

function useHydration() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function useTheme(): UseThemeReturn {
  const isHydrated = useHydration();
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    setThemeInternal(currentTheme === "dark" ? "light" : "dark");
  }, []);

  return {
    theme: isHydrated ? theme : "dark",
    toggleTheme,
  };
}
