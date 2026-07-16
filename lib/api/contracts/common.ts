import { z } from "zod";

export interface ApiRequestContext {
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: string;
  code: string;
  details?: unknown;
  requestId: string;
}

export const apiErrorEnvelopeSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
  details: z.unknown().optional(),
  requestId: z.string().min(1),
});

export const positiveIntegerIdSchema = z.coerce.number().int().positive();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const successSchema = z.object({ success: z.boolean() });

export const stringRecordSchema = z.record(z.string(), z.string());
