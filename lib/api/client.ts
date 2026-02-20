export interface APIClientErrorPayload {
  error?: string;
  code?: string;
  details?: unknown;
}

export class APIClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "APIClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseErrorResponse(response: Response, fallbackMessage: string): Promise<APIClientError> {
  let payload: APIClientErrorPayload | null = null;

  try {
    payload = (await response.json()) as APIClientErrorPayload;
  } catch {
    payload = null;
  }

  return new APIClientError(
    payload?.error?.trim() || fallbackMessage,
    response.status,
    payload?.code,
    payload?.details
  );
}

export async function apiRequest<T>(
  input: string,
  init: RequestInit,
  fallbackErrorMessage: string
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await parseErrorResponse(response, fallbackErrorMessage);
  }
  return response.json() as Promise<T>;
}

export async function apiGet<T>(input: string, fallbackErrorMessage: string): Promise<T> {
  return apiRequest<T>(
    input,
    {
      method: "GET",
    },
    fallbackErrorMessage
  );
}

export async function apiPost<T>(
  input: string,
  body: Record<string, unknown>,
  fallbackErrorMessage: string
): Promise<T> {
  return apiRequest<T>(
    input,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    fallbackErrorMessage
  );
}

export async function apiPatch<T>(
  input: string,
  body: Record<string, unknown>,
  fallbackErrorMessage: string
): Promise<T> {
  return apiRequest<T>(
    input,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    fallbackErrorMessage
  );
}

export async function apiDelete<T>(input: string, fallbackErrorMessage: string): Promise<T> {
  return apiRequest<T>(
    input,
    {
      method: "DELETE",
    },
    fallbackErrorMessage
  );
}
