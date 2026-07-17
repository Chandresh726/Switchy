import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getJobs } from "@/lib/api/clients/jobs";
import { queryKeys } from "@/lib/query-keys";

const InvalidJobQuery = () => {
  const params = { companyIds: [Number.NaN] };
  const query = useQuery({
    queryKey: queryKeys.jobs.list(params),
    queryFn: () => getJobs(params),
    retry: false,
  });

  return <div>{query.isError ? "Invalid filter" : "Loading"}</div>;
};

describe("invalid job query integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports invalid external filters through React Query without rendering crashes or requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <InvalidJobQuery />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Invalid filter")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
