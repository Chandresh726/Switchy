import {
  companyBulkActiveBodySchema,
  companiesResponseSchema,
  companyIdsBodySchema,
  companyImportBodySchema,
  companyIdParamsSchema,
  companyBulkDeleteResponseSchema,
  companyBulkJobsResponseSchema,
  companyBulkUpdateResponseSchema,
  companyDeleteResponseSchema,
  companyImportResponseSchema,
  companyJobsDeleteResponseSchema,
  companyOverviewResponseSchema,
  companyRefreshResponseSchema,
  companyPatchBodySchema,
  companyReplaceBodySchema,
  companySyncBodySchema,
  companyWriteResponseSchema,
} from "@/lib/api/contracts/companies";
import type {
  CompaniesResponse,
  CompanyOverviewResponse,
} from "@/lib/api/contracts/companies";
import { queuedMatchCommandResponseSchema } from "@/lib/api/contracts/matching";
import { successSchema } from "@/lib/api/contracts/common";
import type { z } from "zod";

import { apiCommand, apiGet, apiJsonMutation, serializePathParam } from "../client";

const companyPath = (id: number) => serializePathParam(companyIdParamsSchema, { id });

export const getCompanies = (): Promise<CompaniesResponse> => apiGet("/api/companies", companiesResponseSchema, "Failed to fetch companies");
export const createCompanies = (body: z.input<typeof companyImportBodySchema>) => apiJsonMutation("/api/companies/import", "POST", companyImportBodySchema, body, companyImportResponseSchema, "Failed to create companies");
export const syncCompanies = (body: z.input<typeof companySyncBodySchema>) => apiJsonMutation("/api/companies/sync", "PUT", companySyncBodySchema, body, successSchema, "Failed to sync companies");
export const updateCompany = (id: number, body: z.input<typeof companyReplaceBodySchema>) => apiJsonMutation(`/api/companies/${companyPath(id)}`, "PUT", companyReplaceBodySchema, body, companyWriteResponseSchema, "Failed to update company");
export const patchCompany = (id: number, body: z.input<typeof companyPatchBodySchema>) => apiJsonMutation(`/api/companies/${companyPath(id)}`, "PATCH", companyPatchBodySchema, body, companyWriteResponseSchema, "Failed to update company");
export const deleteCompany = (id: number) => apiCommand(`/api/companies/${companyPath(id)}`, "DELETE", companyDeleteResponseSchema, "Failed to delete company");
export const getCompanyOverview = (id: number): Promise<CompanyOverviewResponse> => apiGet(`/api/companies/${companyPath(id)}/overview`, companyOverviewResponseSchema, "Failed to fetch company overview");
export const refreshCompanyJobs = (companyIds: number[]) => apiJsonMutation("/api/companies/refresh-jobs", "POST", companyIdsBodySchema, { companyIds }, companyRefreshResponseSchema, "Failed to refresh jobs");
export const matchCompanies = (companyIds: number[]) => apiJsonMutation("/api/companies/match", "POST", companyIdsBodySchema, { companyIds }, queuedMatchCommandResponseSchema, "Failed to match jobs");
export const deleteCompanyJobs = (id: number) => apiCommand(`/api/companies/${companyPath(id)}/jobs`, "DELETE", companyJobsDeleteResponseSchema, "Failed to delete company jobs");
export const bulkDeleteCompanyJobs = (companyIds: number[]) => apiJsonMutation("/api/companies/bulk/jobs", "DELETE", companyIdsBodySchema, { companyIds }, companyBulkJobsResponseSchema, "Failed to delete jobs");
export const bulkDeleteCompanies = (companyIds: number[]) => apiJsonMutation("/api/companies/bulk", "DELETE", companyIdsBodySchema, { companyIds }, companyBulkDeleteResponseSchema, "Failed to delete companies");
export const bulkSetCompaniesActive = (companyIds: number[], isActive: boolean) => apiJsonMutation("/api/companies/bulk", "PATCH", companyBulkActiveBodySchema, { companyIds, isActive }, companyBulkUpdateResponseSchema, "Failed to update companies");
