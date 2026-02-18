import { z } from "zod";

export const MatchReasonSchema = z.object({
  type: z.enum(["skill_match", "experience_match", "education_match", "location_match", "other"]),
  description: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export type MatchReason = z.infer<typeof MatchReasonSchema>;

export const SkillMatchSchema = z.object({
  name: z.string(),
  category: z.string().optional(),
  matchLevel: z.enum(["exact", "partial", "related"]).optional(),
});

export type SkillMatch = z.infer<typeof SkillMatchSchema>;

export const RecommendationSchema = z.object({
  type: z.enum(["strength", "improvement", "highlight", "warning"]),
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

export const MatchReasonsArraySchema = z.array(MatchReasonSchema);
export const SkillsArraySchema = z.array(SkillMatchSchema);
export const RecommendationsArraySchema = z.array(RecommendationSchema);

export function parseMatchReasons(json: string | null): MatchReason[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return MatchReasonsArraySchema.parse(parsed);
  } catch {
    return [];
  }
}

export function parseMatchedSkills(json: string | null): SkillMatch[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return SkillsArraySchema.parse(parsed);
  } catch {
    return [];
  }
}

export function parseMissingSkills(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function parseRecommendations(json: string | null): Recommendation[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return RecommendationsArraySchema.parse(parsed);
  } catch {
    return [];
  }
}

export function serializeMatchReasons(reasons: MatchReason[]): string {
  return JSON.stringify(reasons);
}

export function serializeSkills(skills: SkillMatch[]): string {
  return JSON.stringify(skills);
}

export function serializeStringArray(items: string[]): string {
  return JSON.stringify(items);
}

export function serializeRecommendations(recommendations: Recommendation[]): string {
  return JSON.stringify(recommendations);
}
