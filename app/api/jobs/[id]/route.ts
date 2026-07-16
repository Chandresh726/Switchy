import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import {
  jobIdParamsSchema,
  jobResourceUpdateBodySchema,
} from "@/lib/api/contracts/jobs";
import { deleteJob, getJob, updateJob } from "@/lib/application/jobs-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = jobIdParamsSchema.parse(await params);
    return NextResponse.json(await getJob(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch job", fallbackCode: "job_fetch_failed" });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = jobIdParamsSchema.parse(await params);
    const input = jobResourceUpdateBodySchema.parse(await request.json());
    return NextResponse.json(await updateJob(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update job", fallbackCode: "job_update_failed" });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = jobIdParamsSchema.parse(await params);
    return NextResponse.json(await deleteJob(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete job", fallbackCode: "job_delete_failed" });
  }
}
