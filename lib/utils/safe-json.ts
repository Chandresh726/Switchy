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
