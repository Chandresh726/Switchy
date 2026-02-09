import stringSimilarity from "string-similarity";
import { Job } from "@/lib/db/schema";

interface DeduplicationResult {
  isNew: boolean;
  existingJobId?: number;
  similarity: number;
}

export function deduplicateJob(
  newJob: { externalId: string; title: string; url: string },
  existingJobs: Pick<Job, "id" | "externalId" | "title" | "url">[]
): DeduplicationResult {
  // First, check for exact external ID match
  const exactMatch = existingJobs.find(
    (job) => job.externalId === newJob.externalId
  );

  if (exactMatch) {
    return {
      isNew: false,
      existingJobId: exactMatch.id,
      similarity: 1,
    };
  }

  // Check for URL match
  const urlMatch = existingJobs.find((job) => job.url === newJob.url);

  if (urlMatch) {
    return {
      isNew: false,
      existingJobId: urlMatch.id,
      similarity: 1,
    };
  }

  // Check for title similarity (for cases where external ID might change)
  let highestSimilarity = 0;
  let mostSimilarJob: (typeof existingJobs)[0] | null = null;

  for (const job of existingJobs) {
    const similarity = stringSimilarity.compareTwoStrings(
      newJob.title.toLowerCase(),
      job.title.toLowerCase()
    );

    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      mostSimilarJob = job;
    }
  }

  // If very high similarity (>0.9), consider it a duplicate
  if (highestSimilarity > 0.9 && mostSimilarJob) {
    return {
      isNew: false,
      existingJobId: mostSimilarJob.id,
      similarity: highestSimilarity,
    };
  }

  return {
    isNew: true,
    similarity: highestSimilarity,
  };
}

export function batchDeduplicateJobs(
  newJobs: { externalId: string; title: string; url: string }[],
  existingJobs: Pick<Job, "id" | "externalId" | "title" | "url">[]
): {
  newJobs: typeof newJobs;
  duplicates: { job: (typeof newJobs)[0]; existingJobId: number }[];
} {
  const results = {
    newJobs: [] as typeof newJobs,
    duplicates: [] as { job: (typeof newJobs)[0]; existingJobId: number }[],
  };

  for (const job of newJobs) {
    const result = deduplicateJob(job, existingJobs);

    if (result.isNew) {
      results.newJobs.push(job);
    } else if (result.existingJobId) {
      results.duplicates.push({
        job,
        existingJobId: result.existingJobId,
      });
    }
  }

  return results;
}
