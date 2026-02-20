import stringSimilarity from "string-similarity";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { ScrapedJob, DeduplicationResult, BatchDeduplicationResult } from "@/lib/scraper/types";

export interface IDeduplicationService {
  deduplicate(job: ScrapedJob, existingJobs: ExistingJob[]): DeduplicationResult;
  batchDeduplicate(jobs: ScrapedJob[], existingJobs: ExistingJob[]): BatchDeduplicationResult;
}

export interface DeduplicationConfig {
  titleSimilarityThreshold: number;
}

export const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  titleSimilarityThreshold: 0.9,
};

export class TitleBasedDeduplicationService implements IDeduplicationService {
  constructor(private readonly config: DeduplicationConfig = DEFAULT_DEDUPLICATION_CONFIG) {}

  deduplicate(job: ScrapedJob, existingJobs: ExistingJob[]): DeduplicationResult {
    const exactMatch = existingJobs.find((ej) => ej.externalId === job.externalId);

    if (exactMatch) {
      return {
        isNew: false,
        existingJobId: exactMatch.id,
        similarity: 1,
      };
    }

    const urlMatch = existingJobs.find((ej) => ej.url === job.url);

    if (urlMatch) {
      return {
        isNew: false,
        existingJobId: urlMatch.id,
        similarity: 1,
      };
    }

    let highestSimilarity = 0;
    let mostSimilarJob: ExistingJob | null = null;

    for (const ej of existingJobs) {
      const similarity = stringSimilarity.compareTwoStrings(
        job.title.toLowerCase(),
        ej.title.toLowerCase()
      );

      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        mostSimilarJob = ej;
      }
    }

    if (highestSimilarity > this.config.titleSimilarityThreshold && mostSimilarJob) {
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

  batchDeduplicate(jobs: ScrapedJob[], existingJobs: ExistingJob[]): BatchDeduplicationResult {
    const newJobs: ScrapedJob[] = [];
    const duplicates: BatchDeduplicationResult["duplicates"] = [];
    const comparisonJobs: ExistingJob[] = [...existingJobs];
    let transientId = -1;

    for (const job of jobs) {
      const result = this.deduplicate(job, comparisonJobs);

      if (result.isNew) {
        newJobs.push(job);
        comparisonJobs.push({
          id: transientId--,
          externalId: job.externalId,
          title: job.title,
          url: job.url,
        });
      } else if (result.existingJobId) {
        duplicates.push({
          job,
          existingJobId: result.existingJobId,
          similarity: result.similarity,
        });
      }
    }

    return { newJobs, duplicates };
  }
}

export function createDeduplicationService(
  config?: Partial<DeduplicationConfig>
): IDeduplicationService {
  return new TitleBasedDeduplicationService({ ...DEFAULT_DEDUPLICATION_CONFIG, ...config });
}
