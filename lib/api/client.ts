import { z } from "zod";

import { apiErrorEnvelopeSchema } from "./contracts/common";
import { APIClientError } from "./errors";
import { APP_REQUEST_HEADERS } from "./request-headers";

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

function encodePathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function serializePathParam<TSchema extends z.ZodType>(
  schema: TSchema,
  input: z.input<TSchema>,
  key = "id"
): string {
  const parsed = schema.parse(input) as Record<string, unknown>;
  const value = parsed[key];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`Path parameter ${key} must be a string or number`);
  }
  return encodePathSegment(value);
}

export function serializeQuery<TSchema extends z.ZodType>(
  schema: TSchema,
  input: z.input<TSchema>
): string {
  const parsed = schema.parse(input) as Record<string, unknown>;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null || value === "") continue;
    const serialized = Array.isArray(value)
      ? value.join(",")
      : value instanceof Date
        ? value.toISOString()
        : String(value);
    if (serialized) params.set(key, serialized);
  }
  return params.toString();
}

export function appendQuery(input: string, query: string): string {
  return query ? `${input}?${query}` : input;
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

export async function apiRequestAcceptingStatuses<TSchema extends z.ZodType>(
  input: string,
  init: RequestInit,
  responseSchema: TSchema,
  acceptedStatuses: readonly number[],
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  const response = await fetch(input, init);
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw await parseErrorResponse(response, fallbackErrorMessage);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new APIClientError(
      "The server returned an invalid response",
      response.status,
      "invalid_response",
      undefined,
      response.headers.get("x-request-id") ?? undefined
    );
  }

  const parsed = responseSchema.safeParse(payload);
  if (parsed.success) return parsed.data;

  if (!response.ok) {
    const errorPayload = apiErrorEnvelopeSchema.safeParse(payload);
    if (errorPayload.success) {
      throw new APIClientError(
        errorPayload.data.error.trim() || fallbackErrorMessage,
        response.status,
        errorPayload.data.code,
        errorPayload.data.details,
        errorPayload.data.requestId ?? response.headers.get("x-request-id") ?? undefined
      );
    }
  }

  throw new APIClientError(
    "The server returned an invalid response",
    response.status,
    "invalid_response",
    parsed.error.issues,
    response.headers.get("x-request-id") ?? undefined
  );
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

export async function apiJsonMutation<
  TRequestSchema extends z.ZodType,
  TResponseSchema extends z.ZodType,
>(
  input: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  requestSchema: TRequestSchema,
  body: z.input<TRequestSchema>,
  responseSchema: TResponseSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TResponseSchema>> {
  const parsedBody = requestSchema.parse(body);
  return apiRequest(
    input,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...APP_REQUEST_HEADERS,
      },
      body: JSON.stringify(parsedBody),
    },
    responseSchema,
    fallbackErrorMessage
  );
}

export async function apiCommand<TSchema extends z.ZodType>(
  input: string,
  method: "POST" | "DELETE",
  responseSchema: TSchema,
  fallbackErrorMessage: string
): Promise<z.infer<TSchema>> {
  return apiRequest(
    input,
    { method, headers: APP_REQUEST_HEADERS },
    responseSchema,
    fallbackErrorMessage
  );
}

export async function apiFileRequest(
  input: string,
  init: RequestInit,
  fallbackErrorMessage: string
): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await fetch(input, init);
  if (!response.ok) throw await parseErrorResponse(response, fallbackErrorMessage);

  const disposition = response.headers.get("content-disposition");
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quotedName = disposition?.match(/filename="([^"]+)"/i)?.[1];
  let fileName = quotedName ?? null;
  if (encodedName) {
    try {
      fileName = decodeURIComponent(encodedName);
    } catch {
      fileName = null;
    }
  }
  if (fileName) {
    fileName = fileName.replaceAll("\\", "/").split("/").pop()?.trim() || null;
  }
  return { blob: await response.blob(), fileName };
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
