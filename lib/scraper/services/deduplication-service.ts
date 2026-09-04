import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type {
  ScrapedJob,
  DeduplicationResult,
  BatchDeduplicationResult,
} from "@/lib/scraper/types";

export interface IDeduplicationService {
  deduplicate(job: ScrapedJob, existingJobs: ExistingJob[]): DeduplicationResult;
  batchDeduplicate(jobs: ScrapedJob[], existingJobs: ExistingJob[]): BatchDeduplicationResult;
}

export interface DeduplicationConfig {
  titleSimilarityThreshold: number;
}

const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  titleSimilarityThreshold: 0.9,
};

function hasMeaningfulExternalId(externalId: string | null | undefined): externalId is string {
  return typeof externalId === "string" && externalId.trim().length > 0;
}

function locationsMatch(locA: string | null | undefined, locB: string | null | undefined): boolean {
  if (!locA || !locB) return false;
  const a = locA.toLowerCase().trim();
  const b = locB.toLowerCase().trim();
  if (!a || !b) return false;
  return a === b;
}

function compareTitleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.slice(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.slice(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (a.length + b.length - 2);
}

export class TitleBasedDeduplicationService implements IDeduplicationService {
  constructor(private readonly config: DeduplicationConfig = DEFAULT_DEDUPLICATION_CONFIG) {}

  deduplicate(job: ScrapedJob, existingJobs: ExistingJob[]): DeduplicationResult {
    const exactMatch = hasMeaningfulExternalId(job.externalId)
      ? existingJobs.find((ej) => ej.externalId === job.externalId)
      : undefined;

    if (exactMatch) {
      return {
        isNew: false,
        existingJobId: exactMatch.id,
        similarity: 1,
        matchReason: "externalId",
      };
    }

    const normalizedUrl = job.url?.trim();
    const urlMatch = normalizedUrl
      ? existingJobs.find((ej) => ej.url?.trim() === normalizedUrl)
      : undefined;

    if (urlMatch) {
      return {
        isNew: false,
        existingJobId: urlMatch.id,
        similarity: 1,
        matchReason: "url",
      };
    }

    let highestSimilarity = 0;
    let mostSimilarJob: ExistingJob | null = null;

    for (const ej of existingJobs) {
      const similarity = compareTitleSimilarity(job.title.toLowerCase(), ej.title.toLowerCase());

      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        mostSimilarJob = ej;
      }
    }

    if (
      highestSimilarity > this.config.titleSimilarityThreshold &&
      mostSimilarJob &&
      (!hasMeaningfulExternalId(job.externalId) || !hasMeaningfulExternalId(mostSimilarJob.externalId)) &&
      locationsMatch(job.location, mostSimilarJob.location)
    ) {
      return {
        isNew: false,
        existingJobId: mostSimilarJob.id,
        similarity: highestSimilarity,
        matchReason: "titleSimilarity",
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
          location: job.location ?? null,
          status: "new",
          description: null,
        });
      } else if (result.existingJobId) {
        duplicates.push({
          job,
          existingJobId: result.existingJobId,
          similarity: result.similarity,
          matchReason: result.matchReason ?? "titleSimilarity",
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
