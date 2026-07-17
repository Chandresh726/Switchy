import { z } from "zod";

import { apiErrorEnvelopeSchema } from "./contracts/common";
import { APP_REQUEST_HEADERS } from "./request-headers";

export class APIClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    requestId?: string
  ) {
    super(message);
    this.name = "APIClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

async function parseErrorResponse(response: Response, fallbackMessage: string): Promise<APIClientError> {
  let payload: z.infer<typeof apiErrorEnvelopeSchema> | null = null;

  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(await response.json());
    payload = parsed.success ? parsed.data : null;
  } catch {
    payload = null;
  }

  return new APIClientError(
    payload?.error?.trim() || fallbackMessage,
    response.status,
    payload?.code,
    payload?.details,
    payload?.requestId ?? response.headers.get("x-request-id") ?? undefined
  );
}

export async function apiRequest<TSchema extends z.ZodType>(
  input: string,
  init: RequestInit,
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await parseErrorResponse(response, fallbackErrorMessage);
  }
  const payload: unknown = await response.json();
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new APIClientError(
      "The server returned an invalid response",
      response.status,
      "invalid_response",
      parsed.error.issues,
      response.headers.get("x-request-id") ?? undefined
    );
  }
  return parsed.data;
}

export async function apiStreamRequest(
  input: string,
  init: RequestInit,
  fallbackErrorMessage: string
): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await parseErrorResponse(response, fallbackErrorMessage);
  }
  return response;
}

export async function apiGet<TSchema extends z.ZodType>(
  input: string,
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  return apiRequest(
    input,
    {
      method: "GET",
    },
    responseSchema,
    fallbackErrorMessage
  );
}

export async function apiPost<TSchema extends z.ZodType>(
  input: string,
  body: Record<string, unknown>,
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  return apiRequest(
    input,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...APP_REQUEST_HEADERS,
      },
      body: JSON.stringify(body),
    },
    responseSchema,
    fallbackErrorMessage
  );
}

export async function apiPatch<TSchema extends z.ZodType>(
  input: string,
  body: Record<string, unknown>,
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  return apiRequest(
    input,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...APP_REQUEST_HEADERS,
      },
      body: JSON.stringify(body),
    },
    responseSchema,
    fallbackErrorMessage
  );
}

export async function apiDelete<TSchema extends z.ZodType>(
  input: string,
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  return apiRequest(
    input,
    {
      method: "DELETE",
      headers: APP_REQUEST_HEADERS,
    },
    responseSchema,
    fallbackErrorMessage
  );
}
