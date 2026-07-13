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

export function createRipplingListingsResponse(
  entries: ReturnType<typeof createRipplingEntry>[]
): Response {
  return new Response(
    JSON.stringify({
      pageProps: {
        jobs: {
          items: entries,
          page: 0,
          pageSize: 1000,
          totalItems: entries.length,
          totalPages: 1,
        },
      },
      __N_SSG: true,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function createRipplingBuildIdPage(buildId: string): Response {
  return new Response(
    `<html><body><script src="/_next/static/${buildId}/_buildManifest.js" defer=""></script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
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
