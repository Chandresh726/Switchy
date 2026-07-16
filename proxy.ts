import { NextRequest, NextResponse } from "next/server";

import { isAllowedLocalRequestHost } from "@/lib/api/local-host";

export function proxy(request: NextRequest): NextResponse {
  if (!isAllowedLocalRequestHost(request)) {
    return NextResponse.json(
      { error: "Switchy is available only on this device" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
