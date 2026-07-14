import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => {
          if (left === right) return 0;
          return left < right ? -1 : 1;
        })
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function fingerprintAIInput(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
