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

export const successSchema = z.object({ success: z.boolean() });
