export type ExpectedType = "object" | "array" | "any";

export function extractJSON(text: string, expectedType: ExpectedType = "any"): unknown {
  // Strategy 1: Try markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (matchesExpectedType(parsed, expectedType)) {
        return parsed;
      }
    } catch {
      // Continue to other methods
    }
  }

  // Strategy 2 & 3: Find balanced JSON based on expected type
  if (expectedType === "array") {
    const arrayMatches = findBalancedJSON(text, "[", "]");
    for (const match of arrayMatches) {
      try {
        const parsed = JSON.parse(match);
        if (matchesExpectedType(parsed, "array")) {
          return parsed;
        }
      } catch {
        try {
          const cleaned = cleanJSONString(match);
          const parsed = JSON.parse(cleaned);
          if (matchesExpectedType(parsed, "array")) {
            return parsed;
          }
        } catch {
          // Continue
        }
      }
    }
  } else if (expectedType === "object") {
    const objectMatches = findBalancedJSON(text, "{", "}");
    for (const match of objectMatches) {
      try {
        const parsed = JSON.parse(match);
        if (matchesExpectedType(parsed, "object")) {
          return parsed;
        }
      } catch {
        try {
          const cleaned = cleanJSONString(match);
          const parsed = JSON.parse(cleaned);
          if (matchesExpectedType(parsed, "object")) {
            return parsed;
          }
        } catch {
          // Continue
        }
      }
    }
  } else {
    // "any" - try both, objects first (most common for single responses)
    const objectMatches = findBalancedJSON(text, "{", "}");
    for (const match of objectMatches) {
      try {
        return JSON.parse(match);
      } catch {
        try {
          const cleaned = cleanJSONString(match);
          return JSON.parse(cleaned);
        } catch {
          // Continue
        }
      }
    }
    const arrayMatches = findBalancedJSON(text, "[", "]");
    for (const match of arrayMatches) {
      try {
        return JSON.parse(match);
      } catch {
        try {
          const cleaned = cleanJSONString(match);
          return JSON.parse(cleaned);
        } catch {
          // Continue
        }
      }
    }
  }

  // Strategy 4: Try parsing the entire text
  try {
    const parsed = JSON.parse(text);
    if (matchesExpectedType(parsed, expectedType)) {
      return parsed;
    }
  } catch {
    // Last resort: try cleaning and parsing
    try {
      const cleaned = cleanJSONString(text);
      const parsed = JSON.parse(cleaned);
      if (matchesExpectedType(parsed, expectedType)) {
        return parsed;
      }
    } catch {
      // Continue to error
    }
  }

  // Provide helpful error message
  const preview = text.length > 100 ? text.substring(0, 100) + "..." : text;
  const typeHint = expectedType !== "any" ? ` Expected ${expectedType}.` : "";
  throw new Error(`Could not extract valid JSON${typeHint} Preview: ${preview}`);
}

function matchesExpectedType(value: unknown, expectedType: ExpectedType): boolean {
  if (expectedType === "any") return true;
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return true;
}

export function findBalancedJSON(text: string, openChar: string, closeChar: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === openChar) {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0 && startIndex !== -1) {
        results.push(text.substring(startIndex, i + 1));
        startIndex = -1;
      }
    }
  }

  return results;
}

export function cleanJSONString(str: string): string {
  return str
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
    .trim();
}
