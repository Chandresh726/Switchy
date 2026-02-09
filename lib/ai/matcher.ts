import { generateText } from "ai";
import { z } from "zod";
import { inArray, eq } from "drizzle-orm";
import { getModel } from "./client";
import {
  JOB_MATCHING_SYSTEM_PROMPT,
  JOB_MATCHING_USER_PROMPT,
  BULK_JOB_MATCHING_SYSTEM_PROMPT,
  BULK_JOB_MATCHING_USER_PROMPT,
  type JobForMatching,
} from "./prompts";
import { db } from "@/lib/db";
import { jobs, profile, skills, experience, settings } from "@/lib/db/schema";

// Schema for match results
const MatchResultSchema = z.object({
  score: z.number().min(0).max(100),
  cleanDescription: z.string().optional(),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// Schema for bulk match results
const BulkMatchResultSchema = z.array(
  z.object({
    jobId: z.number(),
    score: z.number().min(0).max(100),
    cleanDescription: z.string().optional(),
    reasons: z.array(z.string()),
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
    recommendations: z.array(z.string()),
  })
);

export type MatchResult = z.infer<typeof MatchResultSchema>;
export type BulkMatchResult = z.infer<typeof BulkMatchResultSchema>[number];

// JSON prompt suffix to ensure model returns valid JSON
const JSON_FORMAT_INSTRUCTIONS = `

IMPORTANT: You must respond with ONLY a valid JSON object in the following format, no other text:
{
  "score": <number 0-100>,
  "cleanDescription": "<plain text job description with newlines, NO HTML tags>",
  "reasons": ["reason1", "reason2", ...],
  "matchedSkills": ["skill1", "skill2", ...],
  "missingSkills": ["skill1", "skill2", ...],
  "recommendations": ["recommendation1", "recommendation2", ...]
}`;

function extractJSON(text: string): unknown {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No valid JSON found in response");
}

function extractJSONArray(text: string): unknown {
  // Try to extract JSON array from the response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No valid JSON array found in response");
}

function extractRequirements(description: string | null): string[] {
  if (!description) return [];
  try {
    const matches = description.match(/[-•]\s*(.+)/g);
    if (matches) {
      return matches.map((m) => m.replace(/^[-•]\s*/, "").trim());
    }
  } catch {
    // Ignore parsing errors
  }
  return [];
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Default matcher settings
const DEFAULT_MATCHER_SETTINGS = {
  matcher_model: "gemini-3-flash",
  matcher_bulk_enabled: true,
  matcher_batch_size: 2,
};

interface MatcherSettings {
  model: string;
  bulkEnabled: boolean;
  batchSize: number;
}

/**
 * Fetch matcher settings from database with defaults
 */
async function getMatcherSettings(): Promise<MatcherSettings> {
  const settingKeys = ["matcher_model", "matcher_bulk_enabled", "matcher_batch_size"];
  const dbSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, settingKeys));

  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  return {
    model: settingsMap.get("matcher_model") || DEFAULT_MATCHER_SETTINGS.matcher_model,
    bulkEnabled: (settingsMap.get("matcher_bulk_enabled") ?? "true") === "true",
    batchSize: parseInt(settingsMap.get("matcher_batch_size") || String(DEFAULT_MATCHER_SETTINGS.matcher_batch_size), 10),
  };
}

export async function calculateJobMatch(jobId: number): Promise<MatchResult> {
  // Fetch matcher settings
  const matcherSettings = await getMatcherSettings();
  const aiModel = getModel(matcherSettings.model);

  // Fetch job details
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

  if (!job) {
    throw new Error("Job not found");
  }

  // Fetch user profile
  const profiles = await db.select().from(profile).limit(1);

  if (profiles.length === 0) {
    throw new Error("No profile found. Please create a profile first.");
  }

  const userProfile = profiles[0];

  // Fetch skills and experience
  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  const jobRequirements = extractRequirements(job.description);

  // Generate match using AI with generateText (more compatible with proxies)
  const { text } = await generateText({
    model: aiModel,
    system: JOB_MATCHING_SYSTEM_PROMPT,
    prompt:
      JOB_MATCHING_USER_PROMPT(job.title, job.description || "", jobRequirements, {
        summary: userProfile.summary || undefined,
        skills: userSkills.map((s) => ({
          name: s.name,
          proficiency: s.proficiency,
          category: s.category || undefined,
        })),
        experience: userExperience.map((e) => ({
          title: e.title,
          company: e.company,
          description: e.description || undefined,
        })),
      }) + JSON_FORMAT_INSTRUCTIONS,
  });

  // Parse and validate the JSON response
  const parsed = extractJSON(text);
  const result = MatchResultSchema.parse(parsed);

  // Update job with match results
  await db
    .update(jobs)
    .set({
      matchScore: result.score,
      cleanDescription: result.cleanDescription || null,
      matchReasons: JSON.stringify(result.reasons),
      matchedSkills: JSON.stringify(result.matchedSkills),
      missingSkills: JSON.stringify(result.missingSkills),
      recommendations: JSON.stringify(result.recommendations),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  return result;
}

/**
 * Bulk calculate match scores for multiple jobs in a single AI call.
 * More efficient than calling calculateJobMatch one-by-one.
 * Processes jobs in batches based on configured batch size.
 * Falls back to individual matching if bulk is disabled or for failed jobs.
 */
export async function bulkCalculateJobMatches(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<number, MatchResult | Error>> {
  const results = new Map<number, MatchResult | Error>();

  if (jobIds.length === 0) {
    return results;
  }

  // Fetch matcher settings
  const matcherSettings = await getMatcherSettings();
  const aiModel = getModel(matcherSettings.model);
  const BATCH_SIZE = matcherSettings.batchSize;

  console.log(`[Matcher] Starting with settings: model=${matcherSettings.model}, bulkEnabled=${matcherSettings.bulkEnabled}, batchSize=${BATCH_SIZE}`);

  // If bulk matching is disabled, process jobs individually
  if (!matcherSettings.bulkEnabled) {
    console.log(`[Matcher] Bulk matching disabled, processing ${jobIds.length} jobs individually...`);
    let completed = 0;
    for (const jobId of jobIds) {
      try {
        const result = await calculateJobMatch(jobId);
        results.set(jobId, result);
      } catch (error) {
        console.error(`[Matcher] Individual match failed for job ${jobId}:`, error);
        results.set(jobId, error instanceof Error ? error : new Error(String(error)));
      }
      completed++;
      onProgress?.(completed, jobIds.length);
    }
    return results;
  }

  // Fetch user profile once
  const profiles = await db.select().from(profile).limit(1);

  if (profiles.length === 0) {
    // No profile - return error for all jobs
    const error = new Error("No profile found. Please create a profile first.");
    for (const jobId of jobIds) {
      results.set(jobId, error);
    }
    return results;
  }

  const userProfile = profiles[0];

  // Fetch skills and experience once
  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  const candidateProfile = {
    summary: userProfile.summary || undefined,
    skills: userSkills.map((s) => ({
      name: s.name,
      proficiency: s.proficiency,
      category: s.category || undefined,
    })),
    experience: userExperience.map((e) => ({
      title: e.title,
      company: e.company,
      description: e.description || undefined,
    })),
  };

  // Fetch all jobs at once
  const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const jobsMap = new Map(allJobs.map((j) => [j.id, j]));

  // Process in batches
  const batches = chunkArray(jobIds, BATCH_SIZE);
  let completed = 0;

  for (const batch of batches) {
    try {
      // Prepare jobs for this batch
      const jobsForMatching: JobForMatching[] = batch
        .map((jobId) => {
          const job = jobsMap.get(jobId);
          if (!job) return null;
          return {
            id: job.id,
            title: job.title,
            description: job.description || "",
            requirements: extractRequirements(job.description),
          };
        })
        .filter((j): j is JobForMatching => j !== null);

      if (jobsForMatching.length === 0) {
        completed += batch.length;
        onProgress?.(completed, jobIds.length);
        continue;
      }

      // Single AI call for the batch
      console.log(`[Matcher] Calling AI for batch of ${jobsForMatching.length} jobs (IDs: ${jobsForMatching.map(j => j.id).join(', ')})`);
      const { text } = await generateText({
        model: aiModel,
        system: BULK_JOB_MATCHING_SYSTEM_PROMPT,
        prompt: BULK_JOB_MATCHING_USER_PROMPT(jobsForMatching, candidateProfile),
      });
      console.log(`[Matcher] AI response received for batch`);

      // Parse and validate the response
      const parsed = extractJSONArray(text);
      const batchResults = BulkMatchResultSchema.parse(parsed);

      // Log which jobs were returned vs expected
      const returnedJobIds = new Set(batchResults.map((r) => r.jobId));
      const requestedJobIds = jobsForMatching.map((j) => j.id);
      const missingJobIds = requestedJobIds.filter((id) => !returnedJobIds.has(id));
      if (missingJobIds.length > 0) {
        console.warn(`[Matcher] AI did not return ${missingJobIds.length} jobs: ${missingJobIds.join(', ')}`);
      }

      // Update each job in the database
      for (const result of batchResults) {
        try {
          await db
            .update(jobs)
            .set({
              matchScore: result.score,
              cleanDescription: result.cleanDescription || null,
              matchReasons: JSON.stringify(result.reasons),
              matchedSkills: JSON.stringify(result.matchedSkills),
              missingSkills: JSON.stringify(result.missingSkills),
              recommendations: JSON.stringify(result.recommendations),
              updatedAt: new Date(),
            })
            .where(eq(jobs.id, result.jobId));

          results.set(result.jobId, {
            score: result.score,
            reasons: result.reasons,
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            recommendations: result.recommendations,
          });
        } catch (dbError) {
          results.set(
            result.jobId,
            dbError instanceof Error ? dbError : new Error(String(dbError))
          );
        }
      }

      // Mark any jobs not in the response as errors (will be retried individually)
      for (const jobId of batch) {
        if (!results.has(jobId)) {
          results.set(jobId, new Error("Job not included in AI response"));
        }
      }
    } catch (error) {
      // If batch fails, mark all jobs in batch as errors
      for (const jobId of batch) {
        results.set(jobId, error instanceof Error ? error : new Error(String(error)));
      }
    }

    completed += batch.length;
    onProgress?.(completed, jobIds.length);

    // Add delay between batches to avoid rate limiting
    if (completed < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Retry failed jobs individually
  const failedJobIds = Array.from(results.entries())
    .filter(([, result]) => result instanceof Error)
    .map(([jobId]) => jobId);

  if (failedJobIds.length > 0) {
    console.log(`[Matcher] Retrying ${failedJobIds.length} failed jobs individually...`);
    for (const jobId of failedJobIds) {
      try {
        const result = await calculateJobMatch(jobId);
        results.set(jobId, result);
        console.log(`[Matcher] Individual retry succeeded for job ${jobId}`);
      } catch (error) {
        console.error(`[Matcher] Individual retry failed for job ${jobId}:`, error);
        // Keep the original error in results
      }
    }
  }

  // Log final stats
  const successCount = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
  const errorCount = Array.from(results.values()).filter((r) => r instanceof Error).length;
  console.log(`[Matcher] Completed: ${successCount} successful, ${errorCount} failed out of ${jobIds.length} jobs`);

  return results;
}

/**
 * @deprecated Use bulkCalculateJobMatches instead for better performance.
 * Sequential matching (one job at a time) - kept for backwards compatibility.
 */
export async function batchCalculateJobMatches(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<number, MatchResult | Error>> {
  // Use bulk matching instead
  return bulkCalculateJobMatches(jobIds, onProgress);
}
