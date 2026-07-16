import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error-handler";
import { isAllowedLocalRequestHost } from "@/lib/api/local-host";
import { createApiRequestContext } from "@/lib/api/request-context";

export function proxy(request: NextRequest): NextResponse {
  const context = createApiRequestContext(request);
  if (!isAllowedLocalRequestHost(request)) {
    return apiErrorResponse(
      {
        error: "Switchy is available only on this device",
        code: "local_host_forbidden",
      },
      403,
      { context }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", context.requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", context.requestId);
  return response;
}

export const config = {
  matcher: "/:path*",
};
