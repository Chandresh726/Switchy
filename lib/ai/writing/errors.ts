import { AIError } from "@/lib/ai/shared/errors";

const INTERNAL_QUALITY_GATE_MESSAGE =
  "Generated output failed the capability quality gate";
const COMPATIBLE_QUALITY_ERROR_MESSAGE =
  "Generated content quality was too low. Please try again.";

export function preserveWritingGenerationError(error: unknown): unknown {
  if (
    error instanceof AIError &&
    error.type === "generation_failed" &&
    error.message === INTERNAL_QUALITY_GATE_MESSAGE
  ) {
    return new AIError({
      type: "quality_gate",
      message: COMPATIBLE_QUALITY_ERROR_MESSAGE,
      retryable: false,
    });
  }
  return error;
}
