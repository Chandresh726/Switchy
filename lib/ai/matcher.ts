/**
 * @deprecated This file is kept for backward compatibility.
 * Please import from `lib/ai/matcher/` submodules instead:
 * - `lib/ai/matcher/types` - Type definitions
 * - `lib/ai/matcher/settings` - Settings management
 * - `lib/ai/matcher/single` - Single job matching
 * - `lib/ai/matcher/bulk` - Bulk job matching
 * - `lib/ai/matcher/tracking` - Session tracking
 * - `lib/ai/matcher/generation` - AI generation utilities
 * - `lib/ai/matcher/utils` - Utility functions
 * - `lib/ai/matcher/errors` - Error handling
 */

// Re-export everything from the new modular structure
export * from "./matcher/index";

// Additional exports for backward compatibility
export { modelSupportsReasoningEffortSync as modelSupportsReasoningEffort } from "./client";
