export function createEightfoldSearchResponse(
  positionIds: number[],
  advertisedCount = positionIds.length
): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      data: {
        count: advertisedCount,
        positions: positionIds.map((id) => ({
          id,
          name: `Role ${id}`,
          locations: ["Bangalore"],
          postedTs: 1735603200,
          positionUrl: `/careers/job/${id}`,
        })),
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function createEightfoldDetailResponse(
  positionId: number,
  description = `Description ${positionId}`
): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      data: {
        id: positionId,
        name: `Role ${positionId}`,
        locations: ["Bangalore"],
        jobDescription: description,
        publicUrl: `https://apply.careers.microsoft.com/careers/job/${positionId}`,
        workLocationOption: "onsite",
        efcustomTextTimeType: ["full-time"],
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
