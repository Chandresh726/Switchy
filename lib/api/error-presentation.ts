import { ZodError } from "zod";

import { APIClientError } from "./errors";

export interface ApiErrorPresentation {
  description: string;
  isNotFound: boolean;
  requestId?: string;
  title: string;
}

export function getApiErrorPresentation(
  error: unknown,
  fallbackMessage = "The request could not be completed"
): ApiErrorPresentation {
  if (error instanceof APIClientError) {
    const isNotFound = error.status === 404;
    const title = isNotFound
      ? "Not found"
      : error.code === "invalid_response"
        ? "Invalid server response"
        : error.status === 409
          ? "Could not save changes"
          : error.status === 400
            ? "Invalid request"
          : error.status >= 500
            ? "Local server error"
            : "Request failed";

    return {
      description: error.message.trim() || fallbackMessage,
      isNotFound,
      requestId: error.requestId,
      title,
    };
  }

  if (error instanceof ZodError) {
    return {
      description: "One or more request values are invalid.",
      isNotFound: false,
      title: "Invalid request",
    };
  }

  if (error instanceof TypeError) {
    return {
      description: "Unable to reach the local Switchy server.",
      isNotFound: false,
      title: "Connection failed",
    };
  }

  return {
    description: error instanceof Error && error.message.trim()
      ? error.message
      : fallbackMessage,
    isNotFound: false,
    title: "Request failed",
  };
}

export function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  const presentation = getApiErrorPresentation(error, fallbackMessage);
  return presentation.requestId
    ? `${presentation.description} (Request ID: ${presentation.requestId})`
    : presentation.description;
}

export function isApiNotFoundError(error: unknown): boolean {
  return error instanceof APIClientError && error.status === 404;
}
