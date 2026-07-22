import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyAliasDeleteQuerySchema, companyAliasPatchBodySchema, personIdParamsSchema } from "@/lib/api/contracts/people";
import { deleteCompanyAlias, remapCompanyAlias } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    const input = companyAliasPatchBodySchema.parse(await request.json());
    return NextResponse.json(await remapCompanyAlias(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to remap company alias", fallbackCode: "company_alias_remap_failed" });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    const query = companyAliasDeleteQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await deleteCompanyAlias(id, query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete company alias", fallbackCode: "company_alias_delete_failed" });
  }
}
