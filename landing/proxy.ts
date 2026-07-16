import { NextResponse } from "next/server";

// This workspace-local entry prevents Next from treating the backend app's
// root proxy as part of the static landing build.
export function proxy() {
  return NextResponse.next();
}
