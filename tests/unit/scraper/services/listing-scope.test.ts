import { describe, expect, it } from "vitest";

import { prepareListingScope } from "@/lib/scraper/services/listing-scope";
import { canArchiveMissingJobs } from "@/lib/scraper/services/listing-reconciliation";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";

const existing: ExistingJob[] = ["india-one", "india-two", "outside"].map((externalId, id) => ({
  id, externalId, title: "Engineer", url: `https://example.com/${id}`, status: "new", description: null,
}));
function fixture() {
  const values = new Map<string, unknown>();
  return { companyId: 1, scopeKey: "india-engineering", existing, openIds: ["india-one", "india-two"], complete: true,
    now: new Date(), state: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, delete: (key: string) => { values.delete(key); } } };
}

describe("scoped listing reconciliation", () => {
  it("establishes a committed baseline before limiting archival to previously observed members", () => {
    const input = fixture();
    const first = prepareListingScope(input);
    expect(first.canArchive).toBe(false);
    expect(first.candidateExternalIds).toEqual([]);
    // No baseline is published before the caller's database transaction commits.
    expect(prepareListingScope(input).canArchive).toBe(false);
    first.commit();
    const next = prepareListingScope({ ...input, openIds: ["india-one"] });
    expect(next.canArchive).toBe(true);
    expect(next.candidateExternalIds).toEqual(["india-one", "india-two"]);
    expect(next.existing.map((job) => job.externalId)).toEqual(["india-one", "india-two"]);
    expect(canArchiveMissingJobs({ ...input, source: input.scopeKey, existing: next.existing, openIds: ["india-one"] }).allowed).toBe(true);
  });

  it("does not replace membership on partial snapshots or reuse another country/category scope", () => {
    const input = fixture(); prepareListingScope(input).commit();
    prepareListingScope({ ...input, complete: false, openIds: ["india-one"] }).commit();
    expect(prepareListingScope(input).candidateExternalIds).toEqual(["india-one", "india-two"]);
    expect(prepareListingScope({ ...input, scopeKey: "usa-engineering" }).canArchive).toBe(false);
    expect(prepareListingScope({ ...input, scopeKey: "india-sales" }).canArchive).toBe(false);
  });

  it("retains legacy reconciliation for adapters without source scopes", () => {
    const input = fixture();
    expect(prepareListingScope({ ...input, scopeKey: undefined })).toMatchObject({ existing, canArchive: true, candidateExternalIds: undefined });
  });

  it("retains missing members until a second snapshot confirms a large disappearance", () => {
    const input = fixture();
    input.openIds = Array.from({ length: 10 }, (_, index) => `india-${index}`);
    input.existing = input.openIds.map((externalId, id) => ({ ...existing[0], id, externalId }));
    prepareListingScope(input).commit();
    const next = { ...input, openIds: ["india-0"] };
    const scope = prepareListingScope(next);
    const firstConfirmation = canArchiveMissingJobs({ ...next, source: input.scopeKey, existing: scope.existing });
    expect(firstConfirmation.allowed).toBe(false);
    scope.commit(firstConfirmation.allowed);
    const later = { ...next, now: new Date(next.now.getTime() + 60_000) };
    const confirmed = prepareListingScope(later);
    expect(confirmed.candidateExternalIds).toHaveLength(10);
    const secondConfirmation = canArchiveMissingJobs({ ...later, source: input.scopeKey, existing: confirmed.existing });
    expect(secondConfirmation.allowed).toBe(true);
    confirmed.commit(secondConfirmation.allowed);
    expect(prepareListingScope(later).candidateExternalIds).toEqual(["india-0"]);
  });
});
