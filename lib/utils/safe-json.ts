export function safeJsonParse<T>(
  value: string | null | undefined,
  fallback: T
): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function safeJsonStringArray(
  value: string | null | undefined
): string[] {
  const parsed = safeJsonParse<unknown>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
