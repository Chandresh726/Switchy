import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error-handler";
import { isAllowedLocalRequestHost } from "@/lib/api/local-host";
import { isUpdateMaintenance } from "@/lib/runtime/update-maintenance";
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

  if (isUpdateMaintenance() && request.nextUrl.pathname.startsWith("/api/")
    && !request.nextUrl.pathname.startsWith("/api/health/")
    && !request.nextUrl.pathname.startsWith("/api/lifecycle")) {
    return NextResponse.json({ error: "Switchy is updating. Please wait.", code: "update_in_progress" },
      { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", context.requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", context.requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
