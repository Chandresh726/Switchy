interface RipplingLocationFixture {
  name: string;
  country: string;
  countryCode: string;
  state: string;
  stateCode: string | null;
  city: string;
  workplaceType: "ON_SITE" | "REMOTE" | "HYBRID";
}

export function createRipplingEntry(
  id: string,
  name: string,
  locations: RipplingLocationFixture[]
) {
  return {
    id,
    name,
    url: `https://ats.rippling.com/rippling/jobs/${id}`,
    department: { name: "Engineering" },
    locations,
    language: "en-US",
  };
}

export function createRipplingAlgoliaPayload(
  entries: ReturnType<typeof createRipplingEntry>[],
  options: { page?: number; nbPages?: number } = {}
) {
  return {
    results: [
      {
        page: options.page ?? 0,
        nbPages: options.nbPages ?? 1,
        nbHits: entries.length,
        hits: entries.map((entry, index) => ({
          objectID: `${entry.id}__${index}`,
          jobId: entry.id,
          name: entry.name,
          url: entry.url,
          department: entry.department,
          departmentName: entry.department.name,
          locationNames: entry.locations.map((location) => location.name),
          locations: entry.locations,
        })),
      },
    ],
  };
}

export function createRipplingDetailPage(
  title: string,
  description: string
): Response {
  return new Response(
    `<html><body><h1>${title}</h1><main><p>${description}</p><p>pay range $120,000 - $180,000 USD per year</p></main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
