import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { peopleListQuerySchema } from "@/lib/api/contracts/people";
import {
  companies,
  companyAliases,
  people,
  peopleImportIssues,
  peopleImportSessions,
  personSourceRecords,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-people-management-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

function personValues(identityKey: string, source: "linkedin" | "apollo", name: string) {
  const profileUrl = `https://linkedin.com/in/${name.toLowerCase().replaceAll(" ", "-")}`;
  return {
    identityKey,
    source,
    sourceRecordKey: identityKey.replace(`${source}:`, ""),
    firstName: name.split(" ")[0],
    lastName: name.split(" ").slice(1).join(" "),
    fullName: name,
    profileUrl,
    profileUrlNormalized: profileUrl,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    lastSeenAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

describe("people management infrastructure", () => {
  it("backfills source records idempotently without merging exact duplicates", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const first = database.insert(people).values(personValues("linkedin:first", "linkedin", "Same Person")).returning().get();
    const second = database.insert(people).values({
      ...personValues("apollo:second", "apollo", "Same Person"),
      profileUrl: first.profileUrl,
      profileUrlNormalized: first.profileUrlNormalized,
      email: first.email,
    }).returning().get();
    const { backfillPersonSourceRecords } = await import("@/lib/people/source-records");

    expect(backfillPersonSourceRecords()).toEqual({ inserted: 2 });
    expect(backfillPersonSourceRecords()).toEqual({ inserted: 0 });
    expect(database.select().from(people).all().map((person) => person.id)).toEqual([first.id, second.id]);
    expect(database.select().from(personSourceRecords).all().map((source) => source.personId)).toEqual([first.id, second.id]);
  });

  it("records duplicate rows, preserves archives, deactivates by source, and records failed imports", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const { importPeopleCsv } = await import("@/lib/people/sync/import");
    const duplicateCsv = [
      "First Name,Last Name,Profile URL,Company,Position,Connected On",
      "Ada,Lovelace,https://linkedin.com/in/ada,Acme,Engineer,2024-01-01",
      "Ada,Lovelace,https://linkedin.com/in/ada,Acme,Engineer,2024-01-01",
    ].join("\n");
    const firstImport = await importPeopleCsv({ source: "linkedin", content: duplicateCsv, fileName: "connections.csv" });
    expect(firstImport).toMatchObject({ insertedRows: 1, duplicateRows: 1 });
    const imported = database.select().from(people).get()!;
    database.update(people).set({ archivedAt: new Date("2026-07-21T00:00:00.000Z") }).run();

    const refreshCsv = duplicateCsv.replaceAll("Engineer", "Programmer").split("\n").slice(0, 2).join("\n");
    await importPeopleCsv({ source: "linkedin", content: refreshCsv, fileName: "refresh.csv" });
    expect(database.select().from(people).where(eq(people.id, imported.id)).get()).toMatchObject({
      archivedAt: new Date("2026-07-21T00:00:00.000Z"),
      position: "Programmer",
      isActive: true,
    });

    const replacementCsv = [
      "First Name,Last Name,Profile URL,Company,Position,Connected On",
      "Grace,Hopper,https://linkedin.com/in/grace,Acme,Engineer,2024-02-01",
    ].join("\n");
    await importPeopleCsv({ source: "linkedin", content: replacementCsv, fileName: "replace.csv", importMode: "replace" });
    expect(database.select().from(people).where(eq(people.id, imported.id)).get()?.isActive).toBe(false);
    expect(database.select().from(personSourceRecords).where(eq(personSourceRecords.personId, imported.id)).get()?.isActive).toBe(false);

    await expect(importPeopleCsv({ source: "apollo", content: "Name\nBroken", fileName: "apollo.csv" })).rejects.toThrow("mapping");
    expect(database.select().from(peopleImportSessions).all().at(-1)).toMatchObject({ status: "failed", source: "apollo" });
    expect(database.select().from(peopleImportIssues).all()).toHaveLength(1);
  });

  it("does not backfill unrelated legacy people when an import transaction fails", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const legacy = database.insert(people).values(
      personValues("linkedin:legacy", "linkedin", "Legacy Person")
    ).returning().get();
    const conflict = database.insert(people).values({
      ...personValues("linkedin:https://linkedin.com/in/conflict", "linkedin", "Conflict Person"),
      sourceRecordKey: "old-conflict-key",
      profileUrl: "https://linkedin.com/in/conflict",
      profileUrlNormalized: "https://linkedin.com/in/conflict",
    }).returning().get();
    database.insert(personSourceRecords).values({
      personId: conflict.id,
      source: "linkedin",
      sourceRecordKey: "old-conflict-key",
      stableIdentityKey: "linkedin:https://linkedin.com/in/conflict",
      identityKind: "linkedin_url",
      firstName: conflict.firstName,
      lastName: conflict.lastName,
      fullName: conflict.fullName,
      profileUrl: conflict.profileUrl,
      profileUrlNormalized: conflict.profileUrlNormalized,
      email: conflict.email,
      emailNormalized: conflict.email,
      companyRaw: null,
      companyNormalized: null,
      position: null,
      isActive: true,
      firstSeenAt: conflict.createdAt!,
      lastSeenAt: conflict.lastSeenAt,
    }).run();
    const { importPeopleCsv } = await import("@/lib/people/sync/import");

    await expect(importPeopleCsv({
      source: "linkedin",
      fileName: "conflict.csv",
      content: [
        "First Name,Last Name,Profile URL,Company,Position,Connected On",
        "Conflict,Person,https://linkedin.com/in/conflict,Acme,Engineer,2024-01-01",
      ].join("\n"),
    })).rejects.toThrow();

    expect(database.select().from(personSourceRecords)
      .where(eq(personSourceRecords.personId, legacy.id)).all()).toHaveLength(0);
    expect(database.select().from(peopleImportSessions).get()).toMatchObject({ status: "failed" });
  });

  it("diagnoses legacy row-based LinkedIn identities without reassigning them", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    database.insert(people).values({
      ...personValues("linkedin:ada lovelace|acme|2024-01-01|row:2", "linkedin", "Ada Lovelace"),
      sourceRecordKey: "ada lovelace|acme|2024-01-01|row:2",
      profileUrl: "",
      profileUrlNormalized: "",
      email: null,
      companyRaw: "Acme",
      companyNormalized: "acme",
      connectedOn: new Date("2024-01-01T00:00:00.000Z"),
    }).run();
    const { backfillPersonSourceRecords } = await import("@/lib/people/source-records");
    const { importPeopleCsv } = await import("@/lib/people/sync/import");
    backfillPersonSourceRecords();

    const result = await importPeopleCsv({
      source: "linkedin",
      fileName: "legacy.csv",
      content: [
        "First Name,Last Name,Profile URL,Company,Position,Connected On",
        "Ada,Lovelace,,Acme,Engineer,2024-01-01",
      ].join("\n"),
    });

    expect(result.insertedRows).toBe(1);
    expect(database.select().from(people).all()).toHaveLength(2);
    expect(database.select().from(peopleImportIssues).get()).toMatchObject({
      kind: "ambiguous_identity",
      sourceRecordKey: "ada lovelace|acme|2024-01-01",
    });
  });

  it("discovers duplicates and supports merge, split, archive, restore, and purge", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const normalizedCompany = database.insert(companies).values({
      name: "Acme, Inc.",
      careersUrl: "https://acme.example/jobs",
    }).returning().get();
    const linkedIn = database.insert(people).values(personValues("linkedin:shared", "linkedin", "Shared Person")).returning().get();
    const apollo = database.insert(people).values({
      ...personValues("apollo:shared", "apollo", "Shared Person"),
      profileUrl: linkedIn.profileUrl,
      profileUrlNormalized: linkedIn.profileUrlNormalized,
      email: linkedIn.email,
      companyRaw: "Acme, Inc.",
      companyNormalized: "acme",
      isStarred: true,
      notes: "Apollo note",
    }).returning().get();
    database.insert(peopleImportSessions).values({ id: "history", fileName: "past.csv", source: "linkedin", status: "completed" }).run();
    const service = await import("@/lib/application/people-service");

    const duplicates = await service.listPeopleDuplicates({ limit: 25, offset: 0 });
    expect(duplicates.totalCount).toBeGreaterThan(0);
    expect(duplicates.groups.find((group) => group.identityKind === "linkedin_url")).toMatchObject({
      identityValue: linkedIn.profileUrlNormalized,
      matchReasons: ["exact_linkedin_url"],
    });
    expect(duplicates.groups.find((group) => group.identityKind === "email")).toMatchObject({
      identityValue: linkedIn.email,
      matchReasons: ["exact_email"],
    });
    const merged = await service.mergePeople(linkedIn.id, { duplicatePersonId: apollo.id });
    expect(merged.person.sources).toHaveLength(2);
    expect(merged.person).toMatchObject({ id: linkedIn.id, isStarred: true, notes: "Apollo note" });
    expect(database.select().from(people).all()).toHaveLength(1);

    const apolloSource = merged.person.sources.find((source) => source.source === "apollo")!;
    const split = await service.splitPersonSource(linkedIn.id, apolloSource.id);
    expect(split.person.sources).toHaveLength(1);
    expect(split.createdPerson.sources).toHaveLength(1);
    expect(split.createdPerson.mappedCompanyId).toBe(normalizedCompany.id);
    expect(database.select().from(people).all()).toHaveLength(2);
    await expect(service.splitPersonSource(split.createdPerson.id, split.createdPerson.sources[0].id))
      .rejects.toMatchObject({ code: "person_source_split_conflict" });
    await expect(service.getPersonDetail(999_999)).rejects.toMatchObject({ code: "person_not_found" });

    const archived = await service.archivePerson(linkedIn.id);
    await expect(service.archivePerson(linkedIn.id)).resolves.toMatchObject({ archivedAt: archived.archivedAt });
    const listed = await service.listPeople(peopleListQuerySchema.parse({ active: "all" }));
    expect(listed.people.map((person) => person.id)).not.toContain(linkedIn.id);
    await expect(service.restorePerson(linkedIn.id)).resolves.toMatchObject({ archivedAt: null });
    await expect(service.purgePerson(linkedIn.id)).resolves.toEqual({ deletedId: linkedIn.id });
    expect(database.select().from(peopleImportSessions).where(eq(peopleImportSessions.id, "history")).get()).toBeTruthy();
  });

  it("updates a merged manual source through its surviving canonical owner", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const target = database.insert(people).values(
      personValues("linkedin:target", "linkedin", "Target Person")
    ).returning().get();
    const { createManualPerson } = await import("@/lib/people/sync/import");
    const manual = await createManualPerson({
      fullName: "Manual Person",
      email: "manual@example.com",
      position: "Recruiter",
    });
    const service = await import("@/lib/application/people-service");
    await service.mergePeople(target.id, { duplicatePersonId: manual.id });

    const recreated = await createManualPerson({
      fullName: "Updated Manual Source",
      email: "manual@example.com",
      position: "Director",
    });

    expect(recreated).toMatchObject({ id: target.id, fullName: "Target Person", source: "linkedin" });
    expect(database.select().from(people).all()).toHaveLength(1);
    expect(database.select().from(personSourceRecords).where(and(
      eq(personSourceRecords.source, "manual"),
      eq(personSourceRecords.sourceRecordKey, "email:manual@example.com")
    )).get()).toMatchObject({
      personId: target.id,
      fullName: "Updated Manual Source",
      position: "Director",
    });
  });

  it("lists, remaps, and removes company aliases with explicit person behavior", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const firstCompany = database.insert(companies).values({ name: "First", careersUrl: "https://first.example/jobs" }).returning().get();
    const secondCompany = database.insert(companies).values({ name: "Second", careersUrl: "https://second.example/jobs" }).returning().get();
    const alias = database.insert(companyAliases).values({ companyNormalized: "acme", mappedCompanyId: firstCompany.id }).returning().get();
    database.insert(people).values({
      ...personValues("linkedin:alias", "linkedin", "Alias Person"),
      companyRaw: "Acme",
      companyNormalized: "acme",
      mappedCompanyId: firstCompany.id,
    }).run();
    const service = await import("@/lib/application/people-service");

    await expect(service.listCompanyAliases({ limit: 20, offset: 0 })).resolves.toMatchObject({
      totalCount: 1,
      aliases: [{ id: alias.id, affectedPeopleCount: 1 }],
    });
    await expect(service.remapCompanyAlias(alias.id, { mappedCompanyId: secondCompany.id, updateExistingPeople: true }))
      .resolves.toMatchObject({ updatedPeopleCount: 1, alias: { mappedCompanyId: secondCompany.id } });
    await expect(service.deleteCompanyAlias(alias.id, { existingPeople: "unmap" }))
      .resolves.toEqual({ alias: null, updatedPeopleCount: 1 });
    expect(database.select().from(people).get()?.mappedCompanyId).toBeNull();
  });
});
