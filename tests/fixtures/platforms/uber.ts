function createUberJob(id: number) {
  return {
    id,
    title: `Role ${id}`,
    description: `Description ${id}`,
    department: "Engineering",
    type: "job",
    programAndPlatform: null,
    location: {
      country: "IN",
      region: "KA",
      city: "Bangalore",
      countryName: "India",
    },
    featured: false,
    level: "Senior",
    creationDate: "2026-01-01T00:00:00.000Z",
    otherLevels: null,
    team: "Platform",
    portalID: 1,
    isPipeline: false,
    statusID: 1,
    statusName: "Open",
    updatedDate: "2026-01-01T00:00:00.000Z",
    uniqueSkills: null,
    timeType: "full-time",
    allLocations: null,
  };
}

export function createUberResponse(
  jobIds: number[],
  total = jobIds.length
): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        total,
        results: jobIds.map(createUberJob),
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
