import { db } from "@/lib/db";

import { createArtifactRepository } from "./repository";

export * from "./fingerprints";
export * from "./repository";
export * from "./schemas";

export const artifactRepository = createArtifactRepository(db);
