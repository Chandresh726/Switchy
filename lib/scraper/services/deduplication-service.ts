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

class JobIdentityIndex {
  readonly externalIds = new Map<string, ExistingJob>();
  readonly urls = new Map<string, ExistingJob>();
  readonly locations = new Map<string, ExistingJob[]>();
  readonly missingIdLocations = new Map<string, ExistingJob[]>();

  constructor(jobs: ExistingJob[]) { for (const job of jobs) this.add(job); }

  add(job: ExistingJob): void {
    if (hasMeaningfulExternalId(job.externalId) && !this.externalIds.has(job.externalId)) this.externalIds.set(job.externalId, job);
    const url = job.url?.trim();
    if (url && !this.urls.has(url)) this.urls.set(url, job);
    const location = job.location?.trim().toLowerCase();
    if (!location) return;
    const bucket = this.locations.get(location) ?? [];
    bucket.push(job);
    this.locations.set(location, bucket);
    if (!hasMeaningfulExternalId(job.externalId)) {
      const bucket = this.missingIdLocations.get(location) ?? [];
      bucket.push(job);
      this.missingIdLocations.set(location, bucket);
    }
  }
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
    return this.findMatch(job, new JobIdentityIndex(existingJobs));
  }

  private findMatch(job: ScrapedJob, index: JobIdentityIndex): DeduplicationResult {
    const exactMatch = hasMeaningfulExternalId(job.externalId) ? index.externalIds.get(job.externalId) : undefined;

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
      ? index.urls.get(normalizedUrl)
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

    const location = job.location?.trim().toLowerCase() ?? "";
    const candidates = hasMeaningfulExternalId(job.externalId) ? index.missingIdLocations.get(location) : index.locations.get(location);
    for (const ej of candidates ?? []) {
      const similarity = compareTitleSimilarity(job.title.toLowerCase(), ej.title.toLowerCase());

      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        mostSimilarJob = ej;
      }
    }

    if (
      highestSimilarity > this.config.titleSimilarityThreshold &&
      mostSimilarJob &&
      (!hasMeaningfulExternalId(job.externalId) || !hasMeaningfulExternalId(mostSimilarJob.externalId))
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
    const index = new JobIdentityIndex(existingJobs);
    let transientId = -1;

    for (const job of jobs) {
      const result = this.findMatch(job, index);

      if (result.isNew) {
        newJobs.push(job);
        index.add({
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
