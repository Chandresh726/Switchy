import {
  companiesResponseSchema,
  companyBulkDeleteResponseSchema,
  companyBulkJobsResponseSchema,
  companyBulkUpdateResponseSchema,
  companyDeleteResponseSchema,
  companyImportResponseSchema,
  companyJobsDeleteResponseSchema,
  companyOverviewResponseSchema,
  companyRefreshResponseSchema,
  companyWriteResponseSchema,
} from "@/lib/api/contracts/companies";
import { queuedMatchCommandResponseSchema } from "@/lib/api/contracts/matching";
import { successSchema } from "@/lib/api/contracts/common";

import { apiDelete, apiGet, apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const jsonMutation = (method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  body: JSON.stringify(body),
});

export const getCompanies = () => apiGet("/api/companies", companiesResponseSchema, "Failed to fetch companies");
export const createCompanies = (body: unknown) => apiRequest("/api/companies/import", jsonMutation("POST", body), companyImportResponseSchema, "Failed to create companies");
export const syncCompanies = (body: unknown) => apiRequest("/api/companies/sync", jsonMutation("PUT", body), successSchema, "Failed to sync companies");
export const updateCompany = (id: number, body: unknown) => apiRequest(`/api/companies/${id}`, jsonMutation("PUT", body), companyWriteResponseSchema, "Failed to update company");
export const patchCompany = (id: number, body: unknown) => apiRequest(`/api/companies/${id}`, jsonMutation("PATCH", body), companyWriteResponseSchema, "Failed to update company");
export const deleteCompany = (id: number) => apiDelete(`/api/companies/${id}`, companyDeleteResponseSchema, "Failed to delete company");
export const getCompanyOverview = (id: number) => apiGet(`/api/companies/${id}/overview`, companyOverviewResponseSchema, "Failed to fetch company overview");
export const refreshCompanyJobs = (companyIds: number[]) => apiRequest("/api/companies/refresh-jobs", jsonMutation("POST", { companyIds }), companyRefreshResponseSchema, "Failed to refresh jobs");
export const matchCompanies = (companyIds: number[]) => apiRequest("/api/companies/match", jsonMutation("POST", { companyIds }), queuedMatchCommandResponseSchema, "Failed to match jobs");
export const deleteCompanyJobs = (id: number) => apiDelete(`/api/companies/${id}/jobs`, companyJobsDeleteResponseSchema, "Failed to delete company jobs");
export const bulkDeleteCompanyJobs = (companyIds: number[]) => apiRequest("/api/companies/bulk/jobs", jsonMutation("DELETE", { companyIds }), companyBulkJobsResponseSchema, "Failed to delete jobs");
export const bulkDeleteCompanies = (companyIds: number[]) => apiRequest("/api/companies/bulk", jsonMutation("DELETE", { companyIds }), companyBulkDeleteResponseSchema, "Failed to delete companies");
export const bulkSetCompaniesActive = (companyIds: number[], isActive: boolean) => apiRequest("/api/companies/bulk", jsonMutation("PATCH", { companyIds, isActive }), companyBulkUpdateResponseSchema, "Failed to update companies");
