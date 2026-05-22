export const SIDEBAR_COLLAPSED_COOKIE = "switchy-sidebar-collapsed";
export const SIDEBAR_STORAGE_KEY = "switchy-sidebar-collapsed";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isSidebarCollapsedCookieValue(value: string | undefined): boolean {
  return value === "true";
}
