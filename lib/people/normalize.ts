const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "co",
  "company",
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCompanyName(value: string | null | undefined): string | null {
  if (!value) return null;

  let normalized = collapseWhitespace(value.toLowerCase());
  normalized = normalized.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ");
  normalized = collapseWhitespace(normalized);

  if (!normalized) return null;

  const words = normalized.split(" ");
  while (words.length > 0 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }

  const output = collapseWhitespace(words.join(" "));
  return output || null;
}

export function normalizeLinkedInProfileUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (!host.includes("linkedin.com")) return null;

    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path || path === "/") return null;

    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

export function parseConnectedOn(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed);
  }

  const normalized = trimmed.replace(/-/g, "/");
  const fallback = Date.parse(normalized);
  if (!Number.isNaN(fallback)) {
    return new Date(fallback);
  }

  return null;
}

export function isLinkedInProfileUrl(value: string): boolean {
  return normalizeLinkedInProfileUrl(value) !== null;
}
