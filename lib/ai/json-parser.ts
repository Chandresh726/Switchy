
/**
 * Improved JSON extraction from text response
 * Tries multiple strategies to find valid JSON
 */
export function extractJSON(text: string): unknown {
  // Strategy 1: Try markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to other methods
    }
  }

  // Strategy 2: Find balanced JSON objects
  const objectMatches = findBalancedJSON(text, "{", "}");
  for (const match of objectMatches) {
    try {
      return JSON.parse(match);
    } catch {
      // Try cleaning common issues
      try {
        const cleaned = cleanJSONString(match);
        return JSON.parse(cleaned);
      } catch {
        // Continue to next match
      }
    }
  }

  // Strategy 3: Find balanced JSON arrays
  const arrayMatches = findBalancedJSON(text, "[", "]");
  for (const match of arrayMatches) {
    try {
      return JSON.parse(match);
    } catch {
      try {
        const cleaned = cleanJSONString(match);
        return JSON.parse(cleaned);
      } catch {
        // Continue to next match
      }
    }
  }

  // Strategy 4: Try parsing the entire text
  try {
    return JSON.parse(text);
  } catch {
    // Last resort: try cleaning and parsing
    try {
      const cleaned = cleanJSONString(text);
      return JSON.parse(cleaned);
    } catch {
      // Provide helpful error message
      const preview = text.length > 100 ? text.substring(0, 100) + "..." : text;
      throw new Error(`Could not extract valid JSON from response. Preview: ${preview}`);
    }
  }
}

/**
 * Find balanced JSON structures in text
 */
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

/**
 * Clean common JSON issues
 */
export function cleanJSONString(str: string): string {
  return str
    .replace(/[\u0000-\u001F\u007F]/g, " ") // Remove control characters
    .replace(/,\s*([\]}])/g, "$1") // Remove trailing commas
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Quote unquoted keys
    .trim();
}
