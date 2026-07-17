import { randomUUID } from "node:crypto";

import type { ApiRequestContext } from "./contracts/common";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createApiRequestContext(request?: Request): ApiRequestContext {
  const candidate = request?.headers.get("x-request-id")?.trim();
  return {
    requestId:
      candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID(),
  };
}

export function withRequestIdHeader(
  headers: HeadersInit | undefined,
  context: ApiRequestContext
): Headers {
  const result = new Headers(headers);
  result.set("x-request-id", context.requestId);
  return result;
}
