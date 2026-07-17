export function normalizeCareersUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    const pathname = parsed.pathname.replace(/\/+$/gu, "") || "/";
    return `${hostname}${pathname}`;
  } catch {
    const normalized = trimmed
      .toLowerCase()
      .replace(/^https?:\/\//u, "")
      .replace(/^www\./u, "")
      .split(/[?#]/u)[0];
    if (!normalized) return "";
    return normalized.replace(/\/+$/gu, "") || "/";
  }
}
