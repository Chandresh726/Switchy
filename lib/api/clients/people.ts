import { z } from "zod";

import {
  manualPersonBodySchema,
  companyAliasDeleteQuerySchema,
  companyAliasMutationResponseSchema,
  companyAliasPatchBodySchema,
  companyAliasesQuerySchema,
  companyAliasesResponseSchema,
  apolloMappingSchema,
  peopleImportModeSchema,
  peopleImportSessionsQuerySchema,
  peopleImportSessionDetailQuerySchema,
  peopleImportSessionDetailResponseSchema,
  peopleImportSessionParamsSchema,
  peopleImportPreviewResponseSchema,
  peopleImportResponseSchema,
  peopleImportSessionsResponseSchema,
  peopleListQuerySchema,
  peopleListResponseSchema,
  peopleDuplicatesQuerySchema,
  peopleDuplicatesResponseSchema,
  peopleSourceSchema,
  peopleClearResponseSchema,
  peopleOperationResponseSchema,
  peopleRefreshMappingsResponseSchema,
  personPatchBodySchema,
  personDetailResponseSchema,
  personIdParamsSchema,
  personMergeBodySchema,
  personMergeResponseSchema,
  personPurgeResponseSchema,
  personResponseSchema,
  personSourceParamsSchema,
  personSplitResponseSchema,
  unmatchedCompaniesQuerySchema,
  unmatchedCompaniesResponseSchema,
  unmatchedCompanyPatchBodySchema,
  unmatchedCompanyPeopleQuerySchema,
  unmatchedCompanyPeopleResponseSchema,
} from "@/lib/api/contracts/people";
import type {
  Person,
  CompanyAliasesResponse,
  PeopleImportResponse,
  PeopleImportSessionDetailResponse,
  PeopleImportSessionsResponse,
  PeopleDuplicatesResponse,
  PeopleResponse,
  PersonDetail,
  UnmatchedCompaniesResponse,
  UnmatchedCompanyPeopleResponse,
} from "@/lib/api/contracts/people";

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
const importSessionPath = (id: string) => serializePathParam(peopleImportSessionParamsSchema, { id });
const sourceRecordPath = (id: number, sourceRecordId: number) => serializePathParam(
  personSourceParamsSchema,
  { id, sourceRecordId },
  "sourceRecordId"
);
export type PeopleQueryInput = Partial<z.output<typeof peopleListQuerySchema>>;
export type PeopleImportSessionsQueryInput = Partial<z.output<typeof peopleImportSessionsQuerySchema>>;
export type PeopleImportSessionDetailQueryInput = Partial<z.output<typeof peopleImportSessionDetailQuerySchema>>;
export type PeopleDuplicatesQueryInput = Partial<z.output<typeof peopleDuplicatesQuerySchema>>;
export type CompanyAliasesQueryInput = Partial<z.output<typeof companyAliasesQuerySchema>>;
export type UnmatchedCompaniesQueryInput = Partial<z.output<typeof unmatchedCompaniesQuerySchema>>;
type UnmatchedCompanyPeopleQuery = z.output<typeof unmatchedCompanyPeopleQuerySchema>;
export type UnmatchedCompanyPeopleQueryInput = Pick<
  UnmatchedCompanyPeopleQuery,
  "companyNormalized"
> & Partial<Omit<UnmatchedCompanyPeopleQuery, "companyNormalized">>;

export const getPeople = (params: PeopleQueryInput = {}): Promise<PeopleResponse> => apiGet(appendQuery("/api/people", serializeQuery(peopleListQuerySchema, params)), peopleListResponseSchema, "Failed to fetch people");
export const createPerson = (body: z.output<typeof manualPersonBodySchema>): Promise<Person> => apiJsonMutation("/api/people", "POST", manualPersonBodySchema, body, personResponseSchema, "Failed to create person");
export const patchPerson = (id: number, body: z.output<typeof personPatchBodySchema>) => apiJsonMutation(`/api/people/${personPath(id)}`, "PATCH", personPatchBodySchema, body, personResponseSchema, "Failed to update person");
export const getPersonDetail = (id: number): Promise<PersonDetail> => apiGet(`/api/people/${personPath(id)}`, personDetailResponseSchema, "Failed to fetch person");
export const archivePerson = (id: number) => apiCommand(`/api/people/${personPath(id)}`, "DELETE", personDetailResponseSchema, "Failed to archive person");
export const restorePerson = (id: number) => apiCommand(`/api/people/${personPath(id)}/restore`, "POST", personDetailResponseSchema, "Failed to restore person");
export const purgePerson = (id: number) => apiCommand(`/api/people/${personPath(id)}/purge`, "DELETE", personPurgeResponseSchema, "Failed to purge person");
export const getPeopleDuplicates = (params: PeopleDuplicatesQueryInput = {}): Promise<PeopleDuplicatesResponse> => apiGet(appendQuery("/api/people/duplicates", serializeQuery(peopleDuplicatesQuerySchema, params)), peopleDuplicatesResponseSchema, "Failed to fetch duplicate people");
export const mergePeople = (id: number, body: z.output<typeof personMergeBodySchema>) => apiJsonMutation(`/api/people/${personPath(id)}/merge`, "POST", personMergeBodySchema, body, personMergeResponseSchema, "Failed to merge people");
export const splitPersonSource = (id: number, sourceRecordId: number) => apiCommand(`/api/people/${personPath(id)}/sources/${sourceRecordPath(id, sourceRecordId)}/split`, "POST", personSplitResponseSchema, "Failed to split person source");
export const clearPeople = () => apiCommand("/api/maintenance/people/clear", "POST", peopleClearResponseSchema, "Failed to clear people");
export const getPeopleImportSessions = (params: PeopleImportSessionsQueryInput = {}): Promise<PeopleImportSessionsResponse> => apiGet(appendQuery("/api/people/import-sessions", serializeQuery(peopleImportSessionsQuerySchema, params)), peopleImportSessionsResponseSchema, "Failed to fetch import sessions");
export const getPeopleImportSession = (id: string, params: PeopleImportSessionDetailQueryInput = {}): Promise<PeopleImportSessionDetailResponse> => apiGet(appendQuery(`/api/people/import-sessions/${importSessionPath(id)}`, serializeQuery(peopleImportSessionDetailQuerySchema, params)), peopleImportSessionDetailResponseSchema, "Failed to fetch people import session");
export const getCompanyAliases = (params: CompanyAliasesQueryInput = {}): Promise<CompanyAliasesResponse> => apiGet(appendQuery("/api/people/company-aliases", serializeQuery(companyAliasesQuerySchema, params)), companyAliasesResponseSchema, "Failed to fetch company aliases");
export const remapCompanyAlias = (id: number, body: z.output<typeof companyAliasPatchBodySchema>) => apiJsonMutation(`/api/people/company-aliases/${personPath(id)}`, "PATCH", companyAliasPatchBodySchema, body, companyAliasMutationResponseSchema, "Failed to remap company alias");
export const deleteCompanyAlias = (id: number, existingPeople: z.output<typeof companyAliasDeleteQuerySchema>["existingPeople"]) => apiCommand(appendQuery(`/api/people/company-aliases/${personPath(id)}`, serializeQuery(companyAliasDeleteQuerySchema, { existingPeople })), "DELETE", companyAliasMutationResponseSchema, "Failed to delete company alias");
export const getUnmatchedCompanies = (params: UnmatchedCompaniesQueryInput = {}, ignored = false): Promise<UnmatchedCompaniesResponse> => apiGet(appendQuery(`/api/people/${ignored ? "ignored-" : ""}unmatched-companies`, serializeQuery(unmatchedCompaniesQuerySchema, params)), unmatchedCompaniesResponseSchema, "Failed to load unmatched companies");
export const getUnmatchedCompanyPeople = (params: UnmatchedCompanyPeopleQueryInput): Promise<UnmatchedCompanyPeopleResponse> => apiGet(appendQuery("/api/people/unmatched-company-people", serializeQuery(unmatchedCompanyPeopleQuerySchema, params)), unmatchedCompanyPeopleResponseSchema, "Failed to load unmatched people");
export const updateUnmatchedCompany = (body: z.output<typeof unmatchedCompanyPatchBodySchema>) => apiJsonMutation("/api/people/unmatched-companies", "PATCH", unmatchedCompanyPatchBodySchema, body, peopleOperationResponseSchema, "Failed to update unmatched company");
export const refreshUnmatchedCompanyMappings = () => apiJsonMutation("/api/people/unmatched-companies", "PATCH", unmatchedCompanyPatchBodySchema, { action: "refresh" }, peopleRefreshMappingsResponseSchema, "Failed to refresh unmatched company mappings");
export const previewPeopleImport = (formData: FormData) => {
  peopleImportPreviewFormSchema.parse(peopleImportFormInput(formData));
  return apiRequest("/api/people/import/preview", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportPreviewResponseSchema, "Failed to preview people import");
};
export const importPeople = (formData: FormData): Promise<PeopleImportResponse> => {
  peopleImportFormSchema.parse(peopleImportFormInput(formData));
  return apiRequest("/api/people/import", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, peopleImportResponseSchema, "Failed to import people");
};
