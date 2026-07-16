import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as databaseSchema from "@/lib/db/schema";
import { resumes } from "@/lib/db/schema";

import {
  ResumeDataSchema,
  ResumeValidationWarningsSchema,
  type ResumeData,
  type ResumeValidationWarning,
} from "./schema";

export interface PersistResumeInput {
  profileId: number;
  fileName: string;
  filePath: string;
  parsedData: ResumeData | null;
  aiRunId: string | null;
  parserVersion: string | null;
  warnings: ResumeValidationWarning[];
  storageState: "staging" | "ready" | "deleting" | "missing";
  stagingPath: string | null;
  isCurrent: boolean;
}

export function serializeResumeArtifacts(input: Pick<
  PersistResumeInput,
  "parsedData" | "warnings"
>): { parsedData: string; validationWarnings: string } {
  const parsedData = input.parsedData === null ? null : ResumeDataSchema.parse(input.parsedData);
  const warnings = ResumeValidationWarningsSchema.parse(input.warnings);
  return {
    parsedData: JSON.stringify(parsedData),
    validationWarnings: JSON.stringify(warnings),
  };
}

export function deserializeResumeArtifacts(record: Pick<
  typeof resumes.$inferSelect,
  "parsedData" | "validationWarnings"
>): { parsedData: ResumeData | null; warnings: ResumeValidationWarning[] } {
  const parsed = JSON.parse(record.parsedData) as unknown;
  const warnings = record.validationWarnings ? JSON.parse(record.validationWarnings) as unknown : [];
  return {
    parsedData: parsed === null ? null : ResumeDataSchema.parse(parsed),
    warnings: ResumeValidationWarningsSchema.parse(warnings),
  };
}

export function persistResumeVersion(
  database: BetterSQLite3Database<typeof databaseSchema>,
  input: PersistResumeInput
): typeof resumes.$inferSelect {
  const serialized = serializeResumeArtifacts(input);
  return database.transaction((tx) => {
    const lastResume = tx.select({ version: resumes.version })
      .from(resumes)
      .where(eq(resumes.profileId, input.profileId))
      .orderBy(desc(resumes.version))
      .get();
    const nextVersion = (lastResume?.version ?? 0) + 1;
    if (input.isCurrent) {
      tx.update(resumes).set({ isCurrent: false })
        .where(eq(resumes.profileId, input.profileId)).run();
    }
    return tx.insert(resumes).values({
      profileId: input.profileId,
      fileName: input.fileName,
      filePath: input.filePath,
      parsedData: serialized.parsedData,
      aiRunId: input.aiRunId,
      parserVersion: input.parserVersion,
      validationWarnings: serialized.validationWarnings,
      version: nextVersion,
      isCurrent: input.isCurrent,
      storageState: input.storageState,
      stagingPath: input.stagingPath,
    }).returning().get();
  }, { behavior: "immediate" });
}
