import { db } from "@/lib/db";

import { createAIRunRepository } from "./run-repository";

export const aiRunRepository = createAIRunRepository(db);
