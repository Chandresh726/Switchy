import { NextRequest } from "next/server";

import { ValidationError } from "./error-handler";

const APP_REQUEST_HEADER = "x-switchy-request";

function resolveCallerOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function resolveAppOrigin(request: Request): string {
  if (request instanceof NextRequest) {
    return request.nextUrl.origin;
  }

  return new URL(request.url).origin;
}

export function assertAppRequest(request: Request): void {
  const callerOrigin = resolveCallerOrigin(request);
  const appOrigin = resolveAppOrigin(request);
  const hasAppHeader = request.headers.get(APP_REQUEST_HEADER) === "true";

  if (!hasAppHeader || (callerOrigin !== null && callerOrigin !== appOrigin)) {
    throw new ValidationError("Cross-origin requests are not allowed", "cross_origin_forbidden", 403);
  }
}
