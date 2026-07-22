import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/api";

const services = vi.hoisted(() => ({
  archivePerson: vi.fn(),
  deleteCompanyAlias: vi.fn(),
  listCompanyAliases: vi.fn(),
  getPeopleImportSession: vi.fn(),
  getPersonDetail: vi.fn(),
  listPeopleDuplicates: vi.fn(),
  mergePeople: vi.fn(),
  purgePerson: vi.fn(),
  remapCompanyAlias: vi.fn(),
  restorePerson: vi.fn(),
  splitPersonSource: vi.fn(),
}));

vi.mock("@/lib/application/people-service", () => services);

import * as aliasRoute from "@/app/api/people/company-aliases/[id]/route";
import { GET as listAliases } from "@/app/api/people/company-aliases/route";
import { GET as listDuplicates } from "@/app/api/people/duplicates/route";
import { GET as getImportSession } from "@/app/api/people/import-sessions/[id]/route";
import * as personRoute from "@/app/api/people/[id]/route";
import { POST as mergePerson } from "@/app/api/people/[id]/merge/route";
import { DELETE as purgePerson } from "@/app/api/people/[id]/purge/route";
import { POST as restorePerson } from "@/app/api/people/[id]/restore/route";
import { POST as splitSource } from "@/app/api/people/[id]/sources/[sourceRecordId]/split/route";

function request(path: string, method = "GET", body?: unknown, marked = true) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      origin: "http://localhost",
      ...(marked ? { "x-switchy-request": "true" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const personContext = { params: Promise.resolve({ id: "7" }) };

describe("people management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const service of Object.values(services)) service.mockResolvedValue({ success: true });
  });

  it("delegates lifecycle, duplicate, provenance, and import-session routes", async () => {
    await personRoute.GET(request("/api/people/7"), personContext);
    await personRoute.DELETE(request("/api/people/7", "DELETE"), personContext);
    await restorePerson(request("/api/people/7/restore", "POST"), personContext);
    await purgePerson(request("/api/people/7/purge", "DELETE"), personContext);
    await listDuplicates(request("/api/people/duplicates?limit=5&offset=10"));
    await mergePerson(request("/api/people/7/merge", "POST", { duplicatePersonId: 8 }), personContext);
    await splitSource(request("/api/people/7/sources/9/split", "POST"), {
      params: Promise.resolve({ id: "7", sourceRecordId: "9" }),
    });
    await getImportSession(request("/api/people/import-sessions/session-1?issueLimit=5&issueOffset=2"), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(services.getPersonDetail).toHaveBeenCalledWith(7);
    expect(services.archivePerson).toHaveBeenCalledWith(7);
    expect(services.restorePerson).toHaveBeenCalledWith(7);
    expect(services.purgePerson).toHaveBeenCalledWith(7);
    expect(services.listPeopleDuplicates).toHaveBeenCalledWith({ limit: 5, offset: 10 });
    expect(services.mergePeople).toHaveBeenCalledWith(7, { duplicatePersonId: 8 });
    expect(services.splitPersonSource).toHaveBeenCalledWith(7, 9);
    expect(services.getPeopleImportSession).toHaveBeenCalledWith("session-1", { issueLimit: 5, issueOffset: 2 });
  });

  it("delegates explicit company-alias policies", async () => {
    await listAliases(request("/api/people/company-aliases?limit=20&offset=4"));
    await aliasRoute.PATCH(request("/api/people/company-aliases/3", "PATCH", {
      mappedCompanyId: 8,
      updateExistingPeople: true,
    }), { params: Promise.resolve({ id: "3" }) });
    await aliasRoute.DELETE(request("/api/people/company-aliases/3?existingPeople=unmap", "DELETE"), {
      params: Promise.resolve({ id: "3" }),
    });

    expect(services.listCompanyAliases).toHaveBeenCalledWith({ limit: 20, offset: 4 });
    expect(services.remapCompanyAlias).toHaveBeenCalledWith(3, {
      mappedCompanyId: 8,
      updateExistingPeople: true,
    });
    expect(services.deleteCompanyAlias).toHaveBeenCalledWith(3, { existingPeople: "unmap" });
  });

  it("returns stable 400, 404, and 409 envelopes", async () => {
    const malformed = await mergePerson(
      request("/api/people/7/merge", "POST", { duplicatePersonId: 0 }),
      personContext
    );
    expect(malformed.status).toBe(400);
    expect(services.mergePeople).not.toHaveBeenCalled();

    services.getPersonDetail.mockRejectedValueOnce(new NotFoundError("Person not found", "person_not_found"));
    const missing = await personRoute.GET(request("/api/people/99"), {
      params: Promise.resolve({ id: "99" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "person_not_found" });

    services.mergePeople.mockRejectedValueOnce(
      new ConflictError("Source identity conflict", "person_merge_conflict")
    );
    const conflict = await mergePerson(
      request("/api/people/7/merge", "POST", { duplicatePersonId: 8 }),
      personContext
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "person_merge_conflict" });
  });

  it("requires request-integrity headers for every mutation", async () => {
    const response = await restorePerson(
      request("/api/people/7/restore", "POST", undefined, false),
      personContext
    );
    expect(response.status).toBe(403);
    expect(services.restorePerson).not.toHaveBeenCalled();
  });
});
