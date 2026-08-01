import {
  and,
  count,
  desc,
  eq,
  inArray,
  notExists,
  sql,
  type AnyColumn,
  type GetColumnData,
} from "drizzle-orm";

import { deserializeResumeArtifacts } from "@/lib/ai/resume/repository";
import { db } from "@/lib/db";
import { aiRuns, resumes } from "@/lib/db/schema";
import { loadSqliteParameterChunks } from "@/lib/db/sqlite-utils";

import { getAIRunSummaries } from "./run-summaries";
import type {
  ResumeParseHistoryDetail,
  ResumeParseHistoryEntry,
  ResumeParseHistoryPage,
  ResumeParseHistoryStats,
  ResumeParsedSummary,
} from "./types";

const RESUME_HISTORY_UPLOAD_SELECTION = {
  resumeId: resumes.id,
  fileName: resumes.fileName,
  version: resumes.version,
  isCurrent: resumes.isCurrent,
  storageState: resumes.storageState,
  aiRunId: resumes.aiRunId,
  parserVersion: resumes.parserVersion,
  createdAt: resumes.createdAt,
};

const RESUME_HISTORY_RUN_SELECTION = {
  runId: aiRuns.id,
  status: aiRuns.status,
  metadataJson: aiRuns.metadataJson,
  createdAt: aiRuns.createdAt,
};

const RESUME_HISTORY_ARTIFACT_SELECTION = {
  id: resumes.id,
  parsedData: resumes.parsedData,
  validationWarnings: resumes.validationWarnings,
};

type SelectedRow<TSelection extends Record<string, AnyColumn>> = {
  [Key in keyof TSelection]: GetColumnData<TSelection[Key]>;
};

type ResumeHistoryUploadRow = SelectedRow<
  typeof RESUME_HISTORY_UPLOAD_SELECTION
>;
type ResumeHistoryRunRow = SelectedRow<typeof RESUME_HISTORY_RUN_SELECTION>;
type ResumeHistoryArtifactsRow = SelectedRow<
  typeof RESUME_HISTORY_ARTIFACT_SELECTION
>;

type ResumeHistoryPageRow =
  | { kind: "resume"; sortAt: number; row: ResumeHistoryUploadRow }
  | { kind: "run"; sortAt: number; row: ResumeHistoryRunRow };

interface HydratedResumeHistoryRows {
  entries: ResumeParseHistoryEntry[];
  artifactsById: Map<number, ResumeHistoryArtifactsRow>;
}

/**
 * Reads the file identity that `parseResumeWithProvenance` stashes on the run.
 * Orphaned runs have no resume row to borrow a filename from, so an unreadable
 * blob degrades to nulls rather than dropping the entry from history.
 */
function readRunFileMetadata(metadataJson: string | null): {
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  parserVersion: string | null;
} {
  const empty = {
    fileName: null,
    fileType: null,
    fileSizeBytes: null,
    parserVersion: null,
  };
  if (!metadataJson) return empty;
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const metadata = parsed as Record<string, unknown>;
    return {
      fileName: typeof metadata.fileName === "string" ? metadata.fileName : null,
      fileType: typeof metadata.fileType === "string" ? metadata.fileType : null,
      fileSizeBytes: typeof metadata.fileSizeBytes === "number"
        ? metadata.fileSizeBytes
        : null,
      parserVersion: typeof metadata.parserVersion === "string"
        ? metadata.parserVersion
        : null,
    };
  } catch {
    return empty;
  }
}

function summarizeParsedData(
  record: Pick<typeof resumes.$inferSelect, "parsedData" | "validationWarnings">
): Pick<ResumeParseHistoryEntry, "parsedSummary" | "warnings"> {
  try {
    const { parsedData, warnings } = deserializeResumeArtifacts(record);
    if (parsedData === null) return { parsedSummary: null, warnings };
    const summary: ResumeParsedSummary = {
      skillCount: parsedData.skills.length,
      experienceCount: parsedData.experience?.length ?? 0,
      educationCount: parsedData.education?.length ?? 0,
    };
    return { parsedSummary: summary, warnings };
  } catch {
    // A schema drift in stored JSON should not blank out the whole page.
    return { parsedSummary: null, warnings: [] };
  }
}

async function getResumeParseStats(
  database: typeof db
): Promise<ResumeParseHistoryStats> {
  const parseRuns = and(
    eq(aiRuns.capability, "resume_parse"),
    inArray(aiRuns.status, ["succeeded", "failed", "cancelled", "abandoned"])
  );
  const [uploadRows, runRows] = await Promise.all([
    database.select({
      totalUploads: count(),
      parsedUploads: sql<number>`coalesce(sum(case when ${resumes.aiRunId} is not null then 1 else 0 end), 0)`,
      lastUploadAt: sql<number | null>`max(${resumes.createdAt})`,
    }).from(resumes),
    database.select({
      terminalRuns: count(),
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} <> 'succeeded' then 1 else 0 end), 0)`,
      avgDuration: sql<number>`coalesce(avg(${aiRuns.durationMs}), 0)`,
    }).from(aiRuns).where(parseRuns),
  ]);
  const uploads = uploadRows[0];
  const runs = runRows[0];
  const totalUploads = Number(uploads?.totalUploads ?? 0);
  const parsedUploads = Number(uploads?.parsedUploads ?? 0);
  const terminalRuns = Number(runs?.terminalRuns ?? 0);
  const succeeded = Number(runs?.succeeded ?? 0);
  const lastUploadAt = uploads?.lastUploadAt ?? null;
  return {
    totalUploads,
    uploadOnly: totalUploads - parsedUploads,
    failedParses: Number(runs?.failed ?? 0),
    successRate: terminalRuns === 0
      ? 0
      : Math.round((succeeded / terminalRuns) * 100),
    avgDuration: Math.round(Number(runs?.avgDuration ?? 0)),
    lastUploadAt: lastUploadAt === null
      ? null
      : new Date(lastUploadAt * 1_000).toISOString(),
  };
}

async function hydrateResumeHistoryRows(
  page: readonly ResumeHistoryPageRow[],
  database: typeof db
): Promise<HydratedResumeHistoryRows> {
  // Parsed JSON is only hydrated for the requested rows so long histories stay
  // cheap to list and detail requests remain bounded to one entry.
  const pageResumeIds = page.flatMap((entry) => (
    entry.kind === "resume" ? [entry.row.resumeId] : []
  ));
  const linkedRunIds = page.flatMap((entry) => (
    entry.kind === "resume" && entry.row.aiRunId ? [entry.row.aiRunId] : []
  ));
  const pageRunIds = page.flatMap((entry) => {
    if (entry.kind === "run") return [entry.row.runId];
    return entry.row.aiRunId ? [entry.row.aiRunId] : [];
  });
  const [artifactRows, runMetadataRows, runSummaries] = await Promise.all([
    loadSqliteParameterChunks(pageResumeIds, (idChunk) => database
      .select(RESUME_HISTORY_ARTIFACT_SELECTION)
      .from(resumes)
      .where(inArray(resumes.id, idChunk))),
    loadSqliteParameterChunks(linkedRunIds, (idChunk) => database.select({
      id: aiRuns.id,
      metadataJson: aiRuns.metadataJson,
    }).from(aiRuns).where(inArray(aiRuns.id, idChunk))),
    getAIRunSummaries(pageRunIds, database),
  ]);
  const artifactsById = new Map(artifactRows.map((row) => [row.id, row]));
  const runMetadataById = new Map(runMetadataRows.map((row) => [
    row.id,
    readRunFileMetadata(row.metadataJson),
  ]));

  const entries: ResumeParseHistoryEntry[] = page.map((entry) => {
    if (entry.kind === "run") {
      const { row } = entry;
      const file = readRunFileMetadata(row.metadataJson);
      return {
        id: `run:${row.runId}`,
        source: "run",
        resumeId: null,
        fileName: file.fileName,
        fileType: file.fileType,
        fileSizeBytes: file.fileSizeBytes,
        version: null,
        isCurrent: false,
        storageState: null,
        // A succeeded run with no resume row means the upload was deleted, or
        // persistence failed after the model returned.
        parseState: row.status === "succeeded"
          ? "detached"
          : row.status === "running"
            ? "running"
            : "failed",
        parserVersion: file.parserVersion,
        parsedSummary: null,
        warnings: [],
        aiRunId: row.runId,
        aiRun: runSummaries.get(row.runId) ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    }
    const { row } = entry;
    const artifacts = artifactsById.get(row.resumeId);
    const parsed = artifacts
      ? summarizeParsedData(artifacts)
      : { parsedSummary: null, warnings: [] };
    const file = row.aiRunId ? runMetadataById.get(row.aiRunId) : undefined;
    return {
      id: `resume:${row.resumeId}`,
      source: "resume",
      resumeId: row.resumeId,
      fileName: row.fileName,
      fileType: file?.fileType
        ?? row.fileName.split(".").pop()?.toLowerCase()
        ?? null,
      fileSizeBytes: file?.fileSizeBytes ?? null,
      version: row.version,
      isCurrent: row.isCurrent,
      storageState: row.storageState,
      parseState: row.aiRunId === null ? "upload_only" : "parsed",
      parserVersion: row.parserVersion,
      parsedSummary: parsed.parsedSummary,
      warnings: parsed.warnings,
      aiRunId: row.aiRunId,
      aiRun: row.aiRunId ? runSummaries.get(row.aiRunId) ?? null : null,
      createdAt: row.createdAt?.toISOString() ?? null,
    };
  });

  return { entries, artifactsById };
}

/**
 * Resume parse history spans two sources because a failed parse never reaches
 * the resumes table: successful uploads come from `resumes`, while failed,
 * in-flight, and since-deleted uploads survive only as `resume_parse` runs.
 */
export async function getResumeParseHistory(
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
  database: typeof db = db
): Promise<ResumeParseHistoryPage> {
  const [uploadRows, orphanRunRows, stats] = await Promise.all([
    database.select(RESUME_HISTORY_UPLOAD_SELECTION)
      .from(resumes)
      .orderBy(desc(resumes.version)),
    database.select(RESUME_HISTORY_RUN_SELECTION).from(aiRuns).where(and(
      eq(aiRuns.capability, "resume_parse"),
      notExists(
        database.select({ present: sql`1` })
          .from(resumes)
          .where(eq(resumes.aiRunId, aiRuns.id))
      )
    )).orderBy(desc(aiRuns.createdAt)),
    getResumeParseStats(database),
  ]);

  const merged: ResumeHistoryPageRow[] = [
    ...uploadRows.map((row): ResumeHistoryPageRow => ({
      kind: "resume",
      sortAt: row.createdAt?.getTime() ?? 0,
      row,
    })),
    ...orphanRunRows.map((row): ResumeHistoryPageRow => ({
      kind: "run",
      sortAt: row.createdAt.getTime(),
      row,
    })),
  ].sort((left, right) => right.sortAt - left.sortAt);

  const total = merged.length;
  const page = merged.slice(offset, offset + limit);
  const { entries } = await hydrateResumeHistoryRows(page, database);

  return {
    entries,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
    },
    stats,
  };
}

export async function getResumeParseHistoryDetail(
  id: string,
  database: typeof db = db
): Promise<ResumeParseHistoryDetail | null> {
  const resumeMatch = /^resume:([1-9]\d*)$/.exec(id);
  const runMatch = /^run:(.+)$/.exec(id);
  let pageRow: ResumeHistoryPageRow | null = null;

  if (resumeMatch?.[1]) {
    const row = await database.select(RESUME_HISTORY_UPLOAD_SELECTION)
      .from(resumes)
      .where(eq(resumes.id, Number(resumeMatch[1])))
      .get();
    if (row) {
      pageRow = {
        kind: "resume",
        sortAt: row.createdAt?.getTime() ?? 0,
        row,
      };
    }
  } else if (runMatch?.[1]) {
    const row = await database.select(RESUME_HISTORY_RUN_SELECTION)
      .from(aiRuns)
      .where(and(
        eq(aiRuns.id, runMatch[1]),
        eq(aiRuns.capability, "resume_parse"),
        notExists(
          database.select({ present: sql`1` })
            .from(resumes)
            .where(eq(resumes.aiRunId, aiRuns.id))
        )
      )).get();
    if (row) {
      pageRow = {
        kind: "run",
        sortAt: row.createdAt.getTime(),
        row,
      };
    }
  }

  if (!pageRow) return null;
  const hydrated = await hydrateResumeHistoryRows([pageRow], database);
  const entry = hydrated.entries[0];
  if (!entry) return null;

  if (pageRow.kind === "run") return { entry, parsedData: null };
  const artifacts = hydrated.artifactsById.get(pageRow.row.resumeId);
  if (!artifacts) return null;
  try {
    return {
      entry,
      parsedData: deserializeResumeArtifacts(artifacts).parsedData,
    };
  } catch {
    return { entry, parsedData: null };
  }
}
