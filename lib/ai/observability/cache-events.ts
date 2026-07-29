import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { aiCacheEvents } from "@/lib/db/schema";

import type { AICapability } from "../runtime";

interface RecordAICacheHitInput {
  capability: AICapability;
  subject: {
    type: "job";
    id: string;
  };
  artifact: {
    type: "job_analysis" | "match_result";
    id: string;
  };
  sourceRunId?: string | null;
  sessionId?: string;
}

type AICacheEventWriter = Pick<typeof db, "insert">;

interface InsertAICacheHitOptions {
  createdAt?: Date;
  id?: string;
}

export function insertAICacheHit(
  input: RecordAICacheHitInput,
  database: AICacheEventWriter = db,
  options: InsertAICacheHitOptions = {}
): string {
  const id = options.id ?? randomUUID();
  database.insert(aiCacheEvents).values({
    id,
    capability: input.capability,
    subjectType: input.subject.type,
    subjectId: input.subject.id,
    sourceRunId: input.sourceRunId ?? null,
    artifactType: input.artifact.type,
    artifactId: input.artifact.id,
    sessionId: input.sessionId,
    createdAt: options.createdAt ?? new Date(),
  }).run();
  return id;
}

export async function recordAICacheHit(
  input: RecordAICacheHitInput,
  database: typeof db = db
): Promise<string> {
  return insertAICacheHit(input, database);
}
