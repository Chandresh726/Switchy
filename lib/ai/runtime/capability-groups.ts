import type { AICapability } from "./types";

/**
 * Buckets every AI capability into the product area that owns it, so usage
 * reporting can be scoped to one history page without each caller
 * re-enumerating capability names.
 */
const AI_CAPABILITY_GROUPS = {
  matching: ["job_analysis", "match_adjudication", "match_evaluation"],
  writing: [
    "writing_cover_letter",
    "writing_referral",
    "writing_recruiter_follow_up",
  ],
  profile: ["resume_parse"],
} as const satisfies Record<string, readonly AICapability[]>;

export type AICapabilityGroup = keyof typeof AI_CAPABILITY_GROUPS;

export const AI_CAPABILITY_GROUP_NAMES = Object.keys(
  AI_CAPABILITY_GROUPS
) as AICapabilityGroup[];

export function capabilitiesInGroup(
  group: AICapabilityGroup
): readonly AICapability[] {
  return AI_CAPABILITY_GROUPS[group];
}
