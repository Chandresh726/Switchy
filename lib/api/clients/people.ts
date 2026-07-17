import {
  peopleImportPreviewResponseSchema,
  peopleImportResponseSchema,
  peopleImportSessionsResponseSchema,
  peopleListResponseSchema,
  peopleClearResponseSchema,
  peopleOperationResponseSchema,
  peopleRefreshMappingsResponseSchema,
  personResponseSchema,
  unmatchedCompaniesResponseSchema,
  unmatchedCompanyPeopleResponseSchema,
} from "@/lib/api/contracts/people";

import { apiGet, apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const jsonMutation = (method: "POST" | "PATCH" | "DELETE", body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? APP_REQUEST_HEADERS : { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const getPeople = (query = "") => apiGet(`/api/people${query ? `?${query.replace(/^\?/, "")}` : ""}`, peopleListResponseSchema, "Failed to fetch people");
export const createPerson = (body: Record<string, unknown>) => apiRequest("/api/people", jsonMutation("POST", body), personResponseSchema, "Failed to create person");
export const patchPerson = (id: number, body: Record<string, unknown>) => apiRequest(`/api/people/${id}`, jsonMutation("PATCH", body), personResponseSchema, "Failed to update person");
export const clearPeople = () => apiRequest("/api/maintenance/people/clear", jsonMutation("POST"), peopleClearResponseSchema, "Failed to clear people");
export const getPeopleImportSessions = (limit: number, offset = 0) => apiGet(`/api/people/import-sessions?limit=${limit}&offset=${offset}`, peopleImportSessionsResponseSchema, "Failed to fetch import sessions");
export const getUnmatchedCompanies = (query: string, ignored = false) => apiGet(`/api/people/${ignored ? "ignored-" : ""}unmatched-companies?${query}`, unmatchedCompaniesResponseSchema, "Failed to load unmatched companies");
export const getUnmatchedCompanyPeople = (query: string) => apiGet(`/api/people/unmatched-company-people?${query}`, unmatchedCompanyPeopleResponseSchema, "Failed to load unmatched people");
export const updateUnmatchedCompany = (body: Record<string, unknown>) => apiRequest("/api/people/unmatched-companies", jsonMutation("PATCH", body), peopleOperationResponseSchema, "Failed to update unmatched company");
export const refreshUnmatchedCompanyMappings = () => apiRequest("/api/people/unmatched-companies", jsonMutation("PATCH", { action: "refresh" }), peopleRefreshMappingsResponseSchema, "Failed to refresh unmatched company mappings");
export const previewPeopleImport = (formData: FormData) => apiRequest("/api/people/import/preview", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportPreviewResponseSchema, "Failed to preview people import");
export const importPeople = (formData: FormData) => apiRequest("/api/people/import", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportResponseSchema, "Failed to import people");
