import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PeoplePage from "@/app/(dashboard)/people/page";
import ProfilePage from "@/app/(dashboard)/profile/page";
import { CompanyHeader } from "@/components/companies/company-detail/company-header";
import { CompanyStats } from "@/components/companies/company-detail/company-stats";
import { CompanyList } from "@/components/companies/company-list";
import {
  companiesResponseSchema,
  companyOverviewResponseSchema,
} from "@/lib/api/contracts/companies";
import {
  peopleImportSessionsResponseSchema,
  peopleListResponseSchema,
  unmatchedCompaniesResponseSchema,
} from "@/lib/api/contracts/people";
import { profileResponseSchema } from "@/lib/api/contracts/profile";
import { APIClientError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  getCompanies: vi.fn(),
  getEducation: vi.fn(),
  getExperience: vi.fn(),
  getPeople: vi.fn(),
  getPeopleImportSessions: vi.fn(),
  getProfile: vi.fn(),
  getSkills: vi.fn(),
  getUnmatchedCompanies: vi.fn(),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  deleteCompany: vi.fn(),
  deleteCompanyJobs: vi.fn(),
  getCompanies: mocks.getCompanies,
  patchCompany: vi.fn(),
}));

vi.mock("@/lib/api/clients/people", () => ({
  clearPeople: vi.fn(),
  createPerson: vi.fn(),
  getIgnoredUnmatchedCompanies: vi.fn().mockResolvedValue({ companies: [] }),
  getPeople: mocks.getPeople,
  getPeopleImportSessions: mocks.getPeopleImportSessions,
  getUnmatchedCompanies: mocks.getUnmatchedCompanies,
  getUnmatchedCompanyPeople: vi.fn(),
  importPeople: vi.fn(),
  patchPerson: vi.fn(),
  patchUnmatchedCompany: vi.fn(),
  previewPeopleImport: vi.fn(),
  refreshUnmatchedCompanyMappings: vi.fn(),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  createEducation: vi.fn(),
  createExperience: vi.fn(),
  createSkill: vi.fn(),
  deleteEducation: vi.fn(),
  deleteExperience: vi.fn(),
  deleteResume: vi.fn(),
  deleteSkill: vi.fn(),
  downloadResume: vi.fn(),
  getEducation: mocks.getEducation,
  getExperience: mocks.getExperience,
  getProfile: mocks.getProfile,
  getSkills: mocks.getSkills,
  saveProfile: vi.fn(),
  updateEducation: vi.fn(),
  updateExperience: vi.fn(),
  uploadResume: vi.fn(),
}));

const companies = companiesResponseSchema.parse([{
  id: 7,
  name: "Contract Company",
  careersUrl: "https://example.test/careers",
  logoUrl: null,
  notes: null,
  platform: "custom",
  boardToken: null,
  isActive: true,
  lastScrapedAt: null,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
}]);

const overview = companyOverviewResponseSchema.parse({
  company: {
    id: 7,
    name: "Contract Company",
    careersUrl: "https://example.test/careers",
    logoUrl: null,
    notes: null,
    platform: "custom",
    canScrapeJobs: true,
    isActive: true,
    lastScrapedAt: null,
  },
  stats: {
    openJobs: 4,
    highMatchJobs: 2,
    mappedPeople: 3,
    starredPeople: 1,
    statusCounts: { new: 1, viewed: 1, interested: 1, applied: 1, rejected: 0, archived: 0 },
    jobsDiscoveredLast7Days: 2,
    lastJobDiscoveredAt: "2026-07-16T00:00:00.000Z",
  },
  jobs: [],
  topMatches: [],
  people: [],
  activity: { scrapeLogs: [], matchSessions: [] },
});

const people = peopleListResponseSchema.parse({
  people: [{
    id: 12,
    source: "linkedin",
    sourceRecordKey: null,
    fullName: "Contract Person",
    firstName: "Contract",
    profileUrl: "https://linkedin.example/person",
    email: null,
    companyRaw: null,
    position: "Engineer",
    mappedCompanyId: 7,
    isStarred: false,
    isActive: true,
    lastSeenAt: "2026-07-16T00:00:00.000Z",
    connectedOn: null,
    roleTag: null,
    roleTagSource: null,
    notes: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    isRecruiter: false,
    company: { id: 7, name: "Contract Company" },
  }],
  totalCount: 1,
  hasMore: false,
});

const profile = profileResponseSchema.parse({
  id: 1,
  name: "Contract Profile",
  email: null,
  phone: null,
  location: null,
  preferredCountry: null,
  preferredCity: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  resumePath: null,
  summary: null,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: null,
  skills: [{ id: 2, profileId: 1, name: "TypeScript", category: null }],
  experience: [{
    id: 3,
    profileId: 1,
    company: "Contract Company",
    title: "Engineer",
    location: null,
    startDate: "2025-01",
    endDate: null,
    description: null,
    highlights: null,
  }],
  education: [{
    id: 4,
    profileId: 1,
    institution: "Contract University",
    degree: "BS",
    field: null,
    startDate: null,
    endDate: null,
    gpa: null,
    honors: null,
  }],
  resumes: [{
    id: 5,
    profileId: 1,
    fileName: "resume.pdf",
    filePath: "uploads/resume.pdf",
    parsedData: "{}",
    aiRunId: null,
    parserVersion: null,
    validationWarnings: null,
    version: 1,
    isCurrent: true,
    storageState: "ready",
    createdAt: "2026-07-16T00:00:00.000Z",
  }],
});

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("contract-shaped frontend resources", () => {
  beforeEach(() => {
    mocks.getCompanies.mockResolvedValue(companies);
    mocks.getPeople.mockResolvedValue(people);
    mocks.getPeopleImportSessions.mockResolvedValue(peopleImportSessionsResponseSchema.parse({
      sessions: [],
      pagination: { total: 0, limit: 5, offset: 0, hasMore: false },
    }));
    mocks.getUnmatchedCompanies.mockResolvedValue(unmatchedCompaniesResponseSchema.parse({
      summary: { unmatchedCompanyCount: 0, unmatchedPeopleCount: 0, ignoredCompanyCount: 0 },
      groups: [],
      totalCount: 0,
      hasMore: false,
    }));
    mocks.getProfile.mockResolvedValue(profile);
    mocks.getSkills.mockResolvedValue(profile?.skills ?? []);
    mocks.getExperience.mockResolvedValue(profile?.experience ?? []);
    mocks.getEducation.mockResolvedValue(profile?.education ?? []);
  });

  it("rejects non-ISO timestamps in company and people responses", () => {
    expect(companiesResponseSchema.safeParse([{
      ...companies[0],
      createdAt: "2026-07-16",
    }]).success).toBe(false);
    expect(companyOverviewResponseSchema.safeParse({
      ...overview,
      stats: { ...overview.stats, lastJobDiscoveredAt: "July 16, 2026" },
    }).success).toBe(false);
    expect(peopleListResponseSchema.safeParse({
      ...people,
      people: [{ ...people.people[0], connectedOn: "06/01/2026" }],
    }).success).toBe(false);
  });

  it("renders canonical company list and overview resources", () => {
    renderWithClient(
      <>
        <CompanyHeader company={overview.company} />
        <CompanyStats stats={overview.stats} />
        <CompanyList
          companies={companies}
          isLoading={false}
          selectionMode={false}
          selectedIds={[]}
          onToggleSelection={vi.fn()}
          onEditCompany={vi.fn()}
          onRefreshJobs={vi.fn()}
          onRefreshMatches={vi.fn()}
          isRefreshing={false}
          isMatching={false}
        />
      </>
    );

    expect(screen.getAllByText("Contract Company").length).toBeGreaterThan(0);
    expect(screen.getByText("Open Jobs")).toBeTruthy();
    expect(screen.getByText("Good+ Matches")).toBeTruthy();
  });

  it("renders a canonical people response without inventing missing values", async () => {
    renderWithClient(<PeoplePage />);

    expect(await screen.findByText("Contract Person")).toBeTruthy();
    expect(screen.getByText("Engineer")).toBeTruthy();
    expect(screen.getAllByText("Mapped")).toHaveLength(2);
    expect(screen.getByText("LinkedIn")).toBeTruthy();
  });

  it("renders the complete canonical profile and child resources", async () => {
    renderWithClient(<ProfilePage />);

    expect(await screen.findByDisplayValue("Contract Profile")).toBeTruthy();
    expect(await screen.findByText("TypeScript")).toBeTruthy();
    expect(await screen.findByText("Contract Company")).toBeTruthy();
    expect(await screen.findByText("Contract University")).toBeTruthy();
    expect(screen.getByText("resume.pdf")).toBeTruthy();
  });

  it("does not present a failed people query as an empty people collection", async () => {
    mocks.getPeople.mockRejectedValueOnce(
      new APIClientError("People unavailable", 500, "internal_error", undefined, "req-people")
    );

    renderWithClient(<PeoplePage />);

    expect(await screen.findByText("People unavailable")).toBeTruthy();
    expect(screen.getByText("Request ID: req-people")).toBeTruthy();
    expect(screen.queryByText("No people found")).toBeNull();
  });

  it("does not render empty profile editors after profile initialization fails", async () => {
    mocks.getProfile.mockRejectedValueOnce(
      new APIClientError("Profile unavailable", 500, "internal_error", undefined, "req-profile")
    );

    renderWithClient(<ProfilePage />);

    expect(await screen.findByText("Profile unavailable")).toBeTruthy();
    expect(screen.getByText("Request ID: req-profile")).toBeTruthy();
    expect(screen.queryByText("Basic Information")).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
  });
});
