import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { extractJSON } from "../json-parser";

/**
 * Setting to control whether to use generateObject or skip straight to generateText
 * Set to false if your model/proxy doesn't support structured output
 */
export const USE_GENERATE_OBJECT = false;

/**
 * JSON prompt suffix for generateText fallback
 * Instructs the model to return only valid JSON
 */
export const JSON_PROMPT_SUFFIX = `

CRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no explanations, no text before or after.

The JSON object MUST have this exact structure:
{
  "score": <number 0-100>,
  "reasons": ["reason1", "reason2", ...],
  "matchedSkills": ["skill1", "skill2", ...],
  "missingSkills": ["skill1", "skill2", ...],
  "recommendations": ["recommendation1", ...]
}`;

/**
 * Options for generating structured output
 */
export interface GenerationOptions<T extends z.ZodType> {
  /** The AI model to use */
  model: LanguageModel;
  /** The Zod schema for validation */
  schema: T;
  /** System prompt */
  system: string;
  /** User prompt */
  prompt: string;
  /** Additional provider-specific options (e.g., reasoningEffort) */
  providerOptions?: Record<string, unknown>;
  /** Context identifier for logging */
  context?: string;
}

/**
 * Result of a generation operation
 */
export interface GenerationResult<T> {
  data: T;
  method: "generateObject" | "generateText";
  raw?: string;
}

/**
 * Generate structured output from AI with automatic fallback
 *
 * Strategy:
 * 1. If USE_GENERATE_OBJECT is false, use generateText directly
 * 2. Otherwise, try generateObject first
 * 3. If NoObjectGeneratedError, fall back to generateText
 * 4. Parse and validate the result
 *
 * @throws Error if generation or parsing fails
 */
export async function generateStructured<T extends z.ZodType>(
  options: GenerationOptions<T>
): Promise<GenerationResult<z.infer<T>>> {
  const { model, schema, system, prompt, providerOptions, context } = options;

  // If generateObject is disabled, use generateText directly
  if (!USE_GENERATE_OBJECT) {
    return generateWithText(model, schema, system, prompt, providerOptions, context);
  }

  // Try generateObject first
  try {
    const result = await generateWithObject(
      model,
      schema,
      system,
      prompt,
      providerOptions
    );
    return result;
  } catch (error) {
    const errorName = (error as Error).name || "";
    const errorMessage = (error as Error).message || "";

    // Check if this is a NoObjectGeneratedError - fallback to generateText
    if (
      errorName.includes("NoObjectGeneratedError") ||
      errorMessage.includes("no object generated")
    ) {
      console.log(
        `[Generation] generateObject failed${context ? ` for ${context}` : ""}, falling back to generateText`
      );
      return generateWithText(model, schema, system, prompt, providerOptions, context);
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Generate using generateObject
 */
async function generateWithObject<T extends z.ZodType>(
  model: LanguageModel,
  schema: T,
  system: string,
  prompt: string,
  providerOptions?: Record<string, unknown>
): Promise<GenerationResult<z.infer<T>>> {
  const { object } = await generateObject({
    model,
    schema,
    system,
    prompt,
    ...providerOptions,
  });

  return {
    data: object as z.infer<T>,
    method: "generateObject",
  };
}

/**
 * Generate using generateText + manual JSON extraction
 */
async function generateWithText<T extends z.ZodType>(
  model: LanguageModel,
  schema: T,
  system: string,
  prompt: string,
  providerOptions?: Record<string, unknown>,
  context?: string
): Promise<GenerationResult<z.infer<T>>> {
  const { text } = await generateText({
    model,
    system: system + JSON_PROMPT_SUFFIX,
    prompt: prompt + "\n\nRespond with ONLY JSON object:",
    ...providerOptions,
  });

  try {
    const parsed = extractJSON(text);
    const validated = schema.parse(parsed);

    return {
      data: validated,
      method: "generateText",
      raw: text,
    };
  } catch (parseError) {
    console.error(
      `[Generation] JSON extraction failed${context ? ` for ${context}` : ""}:`,
      (parseError as Error).message
    );
    console.error(
      `[Generation] Raw response preview:`,
      text.substring(0, 300)
    );
    throw parseError;
  }
}

/**
 * Generate text without structured output
 * Simple wrapper around generateText for consistency
 */
export async function generateSimpleText(
  model: LanguageModel,
  system: string,
  prompt: string,
  providerOptions?: Record<string, unknown>
): Promise<{ text: string }> {
  return generateText({
    model,
    system,
    prompt,
    ...providerOptions,
  });
}
