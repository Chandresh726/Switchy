import { z } from "zod";

import { positiveIntegerIdSchema } from "./common";

export const matchCompanyIdsBodySchema = z.object({
  companyIds: z.array(positiveIntegerIdSchema).min(1).max(500),
});
export const numericIdParamsSchema = z.object({ id: positiveIntegerIdSchema });
export const queuedMatchCommandResponseSchema = z.object({
  sessionId: z.string(),
  total: z.number().int().nonnegative(),
}).passthrough();
