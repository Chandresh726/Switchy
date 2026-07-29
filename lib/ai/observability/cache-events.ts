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

export async function recordAICacheHit(
  input: RecordAICacheHitInput,
  database: typeof db = db
): Promise<string> {
  const id = randomUUID();
  await database.insert(aiCacheEvents).values({
    id,
    capability: input.capability,
    subjectType: input.subject.type,
    subjectId: input.subject.id,
    sourceRunId: input.sourceRunId ?? null,
    artifactType: input.artifact.type,
    artifactId: input.artifact.id,
    sessionId: input.sessionId,
    createdAt: new Date(),
  });
  return id;
}
