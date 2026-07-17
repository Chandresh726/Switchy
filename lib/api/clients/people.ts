import {
  manualPersonBodySchema,
  apolloMappingSchema,
  peopleImportModeSchema,
  peopleImportSessionsQuerySchema,
  peopleImportPreviewResponseSchema,
  peopleImportResponseSchema,
  peopleImportSessionsResponseSchema,
  peopleListQuerySchema,
  peopleListResponseSchema,
  peopleSourceSchema,
  peopleClearResponseSchema,
  peopleOperationResponseSchema,
  peopleRefreshMappingsResponseSchema,
  personPatchBodySchema,
  personIdParamsSchema,
  personResponseSchema,
  unmatchedCompaniesQuerySchema,
  unmatchedCompaniesResponseSchema,
  unmatchedCompanyPatchBodySchema,
  unmatchedCompanyPeopleQuerySchema,
  unmatchedCompanyPeopleResponseSchema,
} from "@/lib/api/contracts/people";
import { z } from "zod";

import { appendQuery, apiCommand, apiGet, apiJsonMutation, apiRequest, serializePathParam, serializeQuery } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const peopleImportFileSchema = z.custom<File>(
  (value) => typeof File !== "undefined" && value instanceof File,
  "file must be an uploaded file"
);

const peopleImportPreviewFormSchema = z.object({
  file: peopleImportFileSchema,
  source: peopleSourceSchema.default("linkedin"),
});

const peopleImportFormSchema = peopleImportPreviewFormSchema.extend({
  importMode: peopleImportModeSchema.default("merge"),
  mapping: z.string().optional(),
}).superRefine(({ source, mapping }, context) => {
  if (source !== "apollo") return;
  try {
    apolloMappingSchema.parse(JSON.parse(mapping ?? ""));
  } catch {
    context.addIssue({
      code: "custom",
      path: ["mapping"],
      message: "Apollo import requires a valid mapping",
    });
  }
});

function peopleImportFormInput(formData: FormData) {
  return {
    file: formData.get("file"),
    source: formData.get("source") ?? undefined,
    importMode: formData.get("importMode") ?? undefined,
    mapping: formData.get("mapping") ?? undefined,
  };
}

const personPath = (id: number) => serializePathParam(personIdParamsSchema, { id });
export type PeopleQueryInput = Partial<z.output<typeof peopleListQuerySchema>>;
export type PeopleImportSessionsQueryInput = Partial<z.output<typeof peopleImportSessionsQuerySchema>>;
export type UnmatchedCompaniesQueryInput = Partial<z.output<typeof unmatchedCompaniesQuerySchema>>;
type UnmatchedCompanyPeopleQuery = z.output<typeof unmatchedCompanyPeopleQuerySchema>;
export type UnmatchedCompanyPeopleQueryInput = Pick<
  UnmatchedCompanyPeopleQuery,
  "companyNormalized"
> & Partial<Omit<UnmatchedCompanyPeopleQuery, "companyNormalized">>;

export const getPeople = (params: PeopleQueryInput = {}) => apiGet(appendQuery("/api/people", serializeQuery(peopleListQuerySchema, params)), peopleListResponseSchema, "Failed to fetch people");
export const createPerson = (body: z.output<typeof manualPersonBodySchema>) => apiJsonMutation("/api/people", "POST", manualPersonBodySchema, body, personResponseSchema, "Failed to create person");
export const patchPerson = (id: number, body: z.output<typeof personPatchBodySchema>) => apiJsonMutation(`/api/people/${personPath(id)}`, "PATCH", personPatchBodySchema, body, personResponseSchema, "Failed to update person");
export const clearPeople = () => apiCommand("/api/maintenance/people/clear", "POST", peopleClearResponseSchema, "Failed to clear people");
export const getPeopleImportSessions = (params: PeopleImportSessionsQueryInput = {}) => apiGet(appendQuery("/api/people/import-sessions", serializeQuery(peopleImportSessionsQuerySchema, params)), peopleImportSessionsResponseSchema, "Failed to fetch import sessions");
export const getUnmatchedCompanies = (params: UnmatchedCompaniesQueryInput = {}, ignored = false) => apiGet(appendQuery(`/api/people/${ignored ? "ignored-" : ""}unmatched-companies`, serializeQuery(unmatchedCompaniesQuerySchema, params)), unmatchedCompaniesResponseSchema, "Failed to load unmatched companies");
export const getUnmatchedCompanyPeople = (params: UnmatchedCompanyPeopleQueryInput) => apiGet(appendQuery("/api/people/unmatched-company-people", serializeQuery(unmatchedCompanyPeopleQuerySchema, params)), unmatchedCompanyPeopleResponseSchema, "Failed to load unmatched people");
export const updateUnmatchedCompany = (body: z.output<typeof unmatchedCompanyPatchBodySchema>) => apiJsonMutation("/api/people/unmatched-companies", "PATCH", unmatchedCompanyPatchBodySchema, body, peopleOperationResponseSchema, "Failed to update unmatched company");
export const refreshUnmatchedCompanyMappings = () => apiJsonMutation("/api/people/unmatched-companies", "PATCH", unmatchedCompanyPatchBodySchema, { action: "refresh" }, peopleRefreshMappingsResponseSchema, "Failed to refresh unmatched company mappings");
export const previewPeopleImport = (formData: FormData) => {
  peopleImportPreviewFormSchema.parse(peopleImportFormInput(formData));
  return apiRequest("/api/people/import/preview", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportPreviewResponseSchema, "Failed to preview people import");
};
export const importPeople = (formData: FormData) => {
  peopleImportFormSchema.parse(peopleImportFormInput(formData));
  return apiRequest("/api/people/import", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportResponseSchema, "Failed to import people");
};
