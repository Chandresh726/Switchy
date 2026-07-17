import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { manualPersonBodySchema, peopleListQuerySchema } from "@/lib/api/contracts/people";
import { createPerson, listPeople } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = peopleListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listPeople(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch people", fallbackCode: "people_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = manualPersonBodySchema.parse(await request.json());
    return NextResponse.json(await createPerson(input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create person", fallbackCode: "person_create_failed" });
  }
}
