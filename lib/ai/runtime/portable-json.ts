import { AIError } from "@/lib/ai/shared/errors";

const JSON_FENCE_PATTERN = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/iu;

function stripOptionalJsonFence(value: string): string {
  const fenced = value.match(JSON_FENCE_PATTERN);
  return (fenced?.[1] ?? value).trim();
}

/**
 * Parse exactly one JSON value. The model may wrap it in one JSON code fence,
 * but prose or a second value is rejected so malformed output cannot be
 * mistaken for a successful structured generation.
 */
export function parsePortableJson(value: string): unknown {
  const normalized = stripOptionalJsonFence(value);
  if (!normalized) {
    throw new AIError({
      type: "no_object",
      message: "The AI provider returned an empty structured response",
      retryable: true,
    });
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch (cause) {
    throw new AIError({
      type: "json_parse",
      message: "The AI provider returned malformed structured JSON",
      cause: cause instanceof Error ? cause : undefined,
      retryable: true,
    });
  }
}

export function buildPortableStructuredInstructions(
  instructions: string,
  jsonSchema: Record<string, unknown>,
  attempt: number
): string {
  const retryInstruction = attempt > 1
    ? "A previous response was invalid. Return a corrected JSON value that follows the schema exactly."
    : "";

  return `${instructions}

STRUCTURED RESPONSE CONTRACT:
- Return exactly one JSON value matching the JSON Schema below.
- Do not include commentary, explanations, markdown, or multiple JSON values.
- A single \`\`\`json code fence is tolerated but unnecessary.
- Use only facts supported by the supplied data. Use null, empty arrays, or an explicit unknown status when evidence is absent.
${retryInstruction}

JSON SCHEMA:
${JSON.stringify(jsonSchema)}`;
}
