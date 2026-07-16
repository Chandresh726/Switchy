import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError, ValidationError } from "@/lib/api";
import { companyIdParamsSchema, companyPatchBodySchema, companyReplaceBodySchema } from "@/lib/api/contracts/companies";
import { deleteCompany, getCompany, patchCompany, replaceCompany } from "@/lib/application/companies-service";

type RouteContext = { params: Promise<{ id: string }> };

async function parseCompanyId(context: RouteContext) {
  const parsed = companyIdParamsSchema.safeParse(await context.params);
  if (!parsed.success) throw new ValidationError("Invalid company id", "invalid_company_id");
  return parsed.data.id;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const id = await parseCompanyId(context);
    return NextResponse.json(await getCompany(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch company", fallbackCode: "company_fetch_failed" });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const id = await parseCompanyId(context);
    const input = companyReplaceBodySchema.parse(await request.json());
    return NextResponse.json(await replaceCompany(id, input, createApiRequestContext(request)));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update company", fallbackCode: "company_update_failed" });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const id = await parseCompanyId(context);
    const input = companyPatchBodySchema.parse(await request.json());
    return NextResponse.json(await patchCompany(id, input, createApiRequestContext(request)));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update company", fallbackCode: "company_update_failed" });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const id = await parseCompanyId(context);
    return NextResponse.json(await deleteCompany(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete company", fallbackCode: "company_delete_failed" });
  }
}
