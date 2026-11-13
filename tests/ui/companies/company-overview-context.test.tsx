import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import CompanyLayout from "@/app/(dashboard)/companies/[id]/layout";
import JobsPage from "@/app/(dashboard)/companies/[id]/jobs/page";
import NotesPage from "@/app/(dashboard)/companies/[id]/notes/page";
import PeoplePage from "@/app/(dashboard)/companies/[id]/people/page";
import ActivityPage from "@/app/(dashboard)/companies/[id]/activity/page";
import { companyOverviewResponseSchema } from "@/lib/api/contracts/companies";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({ getCompanyOverview: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
  usePathname: () => "/companies/7/jobs",
}));
vi.mock("@/lib/hooks/use-match-session", () => ({ useMatchSession: vi.fn() }));
vi.mock("@/lib/api/clients/companies", () => ({
  getCompanyOverview: mocks.getCompanyOverview,
  matchCompanies: vi.fn(),
  refreshCompanyJobs: vi.fn(),
}));
vi.mock("@/components/companies/company-detail/company-layout-client", () => ({
  CompanyLayoutClient: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/companies/company-detail", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/companies/company-detail")
  >()),
  CompanyHeader: () => null,
  CompanyStats: () => null,
  CompanyActions: () => null,
  CompanyJobsTab: ({ company }: { company: { name: string } }) => (
    <p>{company.name}</p>
  ),
  CompanyNotesTab: ({
    companyId,
    note,
  }: {
    companyId: number;
    note: string;
  }) => (
    <p>
      {companyId}: {note}
    </p>
  ),
  CompanyPeopleTab: ({ people }: { people: unknown[] }) => (
    <p>{people.length} people</p>
  ),
  CompanyActivityTab: ({
    activity,
  }: {
    activity: { scrapeLogs: unknown[] };
  }) => <p>{activity.scrapeLogs.length} scrapes</p>,
}));

it("shares the layout overview with every tab and propagates cache updates", async () => {
  const overview = companyOverviewResponseSchema.parse({
    company: {
      id: 7,
      name: "Example",
      careersUrl: "https://example.test",
      logoUrl: null,
      notes: "Original note",
      platform: "custom",
      canScrapeJobs: false,
      isActive: true,
      lastScrapedAt: null,
    },
    stats: {
      openJobs: 0,
      highMatchJobs: 0,
      mappedPeople: 0,
      starredPeople: 0,
      statusCounts: {
        new: 0,
        viewed: 0,
        interested: 0,
        applied: 0,
        rejected: 0,
        archived: 0,
      },
      jobsDiscoveredLast7Days: 0,
      lastJobDiscoveredAt: null,
    },
    jobs: [],
    topMatches: [],
    people: [],
    activity: { scrapeLogs: [], matchSessions: [] },
  });
  mocks.getCompanyOverview.mockResolvedValue(overview);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CompanyLayout>
        <JobsPage />
        <NotesPage />
        <PeoplePage />
        <ActivityPage />
      </CompanyLayout>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Example")).toBeTruthy();
  expect(screen.getByText("7: Original note")).toBeTruthy();
  expect(screen.getByText("0 people")).toBeTruthy();
  expect(screen.getByText("0 scrapes")).toBeTruthy();
  expect(mocks.getCompanyOverview).toHaveBeenCalledExactlyOnceWith(7);
  await act(async () => {
    client.setQueryData(queryKeys.companies.overview(7), {
      ...overview,
      company: { ...overview.company, name: "Updated", notes: "Saved note" },
    });
  });
  expect(await screen.findByText("Updated")).toBeTruthy();
  expect(screen.getByText("7: Saved note")).toBeTruthy();
  expect(mocks.getCompanyOverview).toHaveBeenCalledTimes(1);
});
