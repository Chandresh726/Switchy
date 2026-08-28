"use client";

import { useQuery } from "@tanstack/react-query";
import { JobCard } from "./job-card";
import { JobFilters, type JobFilters as Filters } from "./job-filters";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Briefcase, ChevronLeft, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { useSearchParams, useRouter } from "next/navigation";
import { getPageNumbers } from "@/lib/utils/pagination";
import { getCompanies } from "@/lib/api/clients/companies";
import { getJobs, type JobsQueryInput } from "@/lib/api/clients/jobs";
import type { Company } from "@/lib/api/contracts/companies";
import type { JobSummary, JobsResponse } from "@/lib/api/contracts/jobs";
import { JOB_STATUSES, type JobStatus } from "@/lib/jobs/status";
import { queryKeys } from "@/lib/query-keys";

const STORAGE_KEY = "switchy-job-filters";
const STORAGE_VERSION = 2;

const defaultFilters: Filters = {
  search: "",
  status: "",
  companyIds: [],
  locationType: [],
  employmentType: [],
  seniorityLevel: [],
  minScore: "",
  matchBands: "",
  department: "",
  locationSearch: "",
  sortBy: "discoveredAt",
  sortOrder: "desc",
};

function loadFiltersFromStorage(): Filters {
  if (typeof window === "undefined") return defaultFilters;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Filters> & { version?: number };
      const { version, ...storedFilters } = parsed;
      if (version !== STORAGE_VERSION && storedFilters.sortBy === "matchScore") {
        storedFilters.sortBy = defaultFilters.sortBy;
      }
      return { ...defaultFilters, ...storedFilters };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultFilters;
}

function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.some((candidate) => candidate === value);
}

type LocationType = NonNullable<JobsQueryInput["locationType"]>[number];
type MatchBand = NonNullable<JobsQueryInput["matchBands"]>[number];

function isLocationType(value: string): value is LocationType {
  return value === "remote" || value === "hybrid" || value === "onsite";
}

function isMatchBand(value: string): value is MatchBand {
  return value === "high" || value === "good";
}

function parseFiltersFromSearchParams(searchParams: URLSearchParams): Partial<Filters> {
  const filters: Partial<Filters> = {};

  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const companyId = searchParams.get("companyId");
  const companyIds = searchParams.get("companyIds");
  const locationType = searchParams.get("locationType");
  const employmentType = searchParams.get("employmentType");
  const seniorityLevel = searchParams.get("seniorityLevel");
  const minScore = searchParams.get("minScore");
  const matchBands = searchParams.get("matchBands");
  const department = searchParams.get("department");
  const locationSearch = searchParams.get("locationSearch");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");

  if (search) filters.search = search;
  if (status && isJobStatus(status)) {
    filters.status = status;
  }
  // Handle both companyId (legacy) and companyIds (preferred)
  if (companyId) {
    filters.companyIds = [companyId];
  } else if (companyIds) {
    filters.companyIds = companyIds.split(",").filter(Boolean);
  }
  if (locationType) filters.locationType = locationType.split(",").filter(Boolean);
  if (employmentType) filters.employmentType = employmentType.split(",").filter(Boolean);
  if (seniorityLevel) filters.seniorityLevel = seniorityLevel.split(",").filter(Boolean);
  if (minScore) filters.minScore = minScore;
  if (matchBands) filters.matchBands = matchBands;
  if (department) filters.department = department;
  if (locationSearch) filters.locationSearch = locationSearch;
  if (sortBy === "matchScore" || sortBy === "discoveredAt" || sortBy === "postedDate" || sortBy === "companyName" || sortBy === "title") {
    filters.sortBy = sortBy;
  }
  if (sortOrder === "asc" || sortOrder === "desc") filters.sortOrder = sortOrder;

  return filters;
}

function parseTabFromSearchParams(searchParams: URLSearchParams): TabType {
  const tab = searchParams.get("tab");
  return tab === "saved" || tab === "applied" || tab === "archived" ? tab : "all";
}

function buildQueryString(filters: Filters, tab: TabType, scrapeSessionId?: string): string {
  const params = new URLSearchParams();
  if (scrapeSessionId) params.set("scrapeSessionId", scrapeSessionId);
  
  if (tab !== "all") params.set("tab", tab);
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  // Only use companyIds, not companyId
  if (filters.companyIds.length > 0) params.set("companyIds", filters.companyIds.join(","));
  if (filters.locationType.length > 0) params.set("locationType", filters.locationType.join(","));
  if (filters.employmentType.length > 0) params.set("employmentType", filters.employmentType.join(","));
  if (filters.seniorityLevel.length > 0) params.set("seniorityLevel", filters.seniorityLevel.join(","));
  if (filters.minScore) params.set("minScore", filters.minScore);
  if (filters.matchBands) params.set("matchBands", filters.matchBands);
  if (filters.department) params.set("department", filters.department);
  if (filters.locationSearch) params.set("locationSearch", filters.locationSearch);
  if (filters.sortBy && filters.sortBy !== defaultFilters.sortBy) {
    params.set("sortBy", filters.sortBy);
  }
  if (filters.sortOrder && filters.sortOrder !== defaultFilters.sortOrder) {
    params.set("sortOrder", filters.sortOrder);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

type TabType = "all" | "saved" | "applied" | "archived";

export function JobList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedLocationSearch, setDebouncedLocationSearch] = useState("");
  const [debouncedDepartment, setDebouncedDepartment] = useState("");
  const scrapeSessionId = searchParams.get("scrapeSessionId") ?? undefined;

  // Ref to track if initialization has occurred (prevents re-parsing on URL changes)
  const hasInitializedRef = useRef(false);

  // Pagination state
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Load filters from URL params and localStorage on mount
  useEffect(() => {
    // Prevent re-parsing on subsequent URL changes after initial load
    if (hasInitializedRef.current) return;

    const urlFilters = parseFiltersFromSearchParams(searchParams);
    const urlTab = parseTabFromSearchParams(searchParams);
    const hasUrlFilters = searchParams.toString().length > 0;
    const storageFilters = hasUrlFilters ? defaultFilters : loadFiltersFromStorage();

    // URL-linked views should be reproducible and not inherit saved local filters.
    const finalFilters = { ...defaultFilters, ...storageFilters, ...urlFilters };
    const finalTab = urlTab;
    
    // Defer state updates to avoid React rendering conflicts
    setTimeout(() => {
      setFilters(finalFilters);
      setActiveTab(finalTab);
      setDebouncedSearch(finalFilters.search);
      setDebouncedLocationSearch(finalFilters.locationSearch);
      setDebouncedDepartment(finalFilters.department);
      setIsInitialized(true);
      setIsInitialLoad(false);
      hasInitializedRef.current = true;
    }, 0);
  }, [searchParams]);

  // Save filters to localStorage and sync to URL when they change
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, ...filters })
      );
    }
  }, [filters, isInitialized]);
  
  // Debounced URL update to avoid history spam
  const updateUrl = useCallback((newFilters: Filters, newTab: TabType) => {
    const queryString = buildQueryString(newFilters, newTab, scrapeSessionId);
    const currentUrl = `/jobs${queryString}`;
    
    // Only update if the URL is different from current
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== currentUrl) {
      router.replace(currentUrl, { scroll: false });
    }
  }, [router, scrapeSessionId]);
  
  // Debounced URL sync
  useEffect(() => {
    if (isInitialized && !isInitialLoad) {
      const timer = setTimeout(() => {
        updateUrl(filters, activeTab);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [filters, activeTab, isInitialized, isInitialLoad, updateUrl]);

  // Handle filter changes and reset pagination
  const handleFiltersChange = (newFilters: Filters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setCurrentPage(1);
    // Immediate URL update for tab changes (no debounce), but not during initial load
    if (isInitialized && !isInitialLoad) {
      updateUrl(filters, tab);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  // Debounce text inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLocationSearch(filters.locationSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.locationSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDepartment(filters.department);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.department]);

  // Fetch companies for filter dropdown
  const companiesQuery = useQuery<Company[]>({
    queryKey: queryKeys.companies.list(),
    queryFn: async () => {
      return getCompanies();
    },
  });
  const companies = companiesQuery.data ?? [];

  // Determine effective status filter based on active tab
  const effectiveStatus =
    activeTab === "applied" ? "applied" :
    activeTab === "saved" ? "interested" :
    activeTab === "archived" ? "archived" :
    filters.status;

  // Build query params
  const queryParams = useMemo<JobsQueryInput>(() => {
    return {
      search: debouncedSearch || undefined,
      scrapeSessionId,
      status: effectiveStatus || undefined,
      excludeStatus: !effectiveStatus && activeTab === "all" ? ["archived" as const] : undefined,
      companyIds: filters.companyIds.length > 0
        ? filters.companyIds.map((id) => Number(id))
        : undefined,
      locationType: filters.locationType.length > 0
        ? filters.locationType.filter(isLocationType)
        : undefined,
      employmentType: filters.employmentType.length > 0 ? filters.employmentType.join(",") : undefined,
      seniorityLevel: filters.seniorityLevel.length > 0 ? filters.seniorityLevel.join(",") : undefined,
      minScore: filters.minScore ? Number(filters.minScore) : undefined,
      matchBands: filters.matchBands
        ? filters.matchBands.split(",").filter(isMatchBand)
        : undefined,
      department: debouncedDepartment || undefined,
      locationSearch: debouncedLocationSearch || undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    };
  }, [
    debouncedSearch,
    scrapeSessionId,
    effectiveStatus,
    activeTab,
    filters.companyIds,
    filters.locationType,
    filters.employmentType,
    filters.seniorityLevel,
    filters.minScore,
    filters.matchBands,
    debouncedDepartment,
    debouncedLocationSearch,
    filters.sortBy,
    filters.sortOrder,
    pageSize,
    currentPage,
  ]);

  // Fetch jobs
  const { data, error, isError, isLoading, isFetching, refetch } = useQuery<JobsResponse>({
    queryKey: queryKeys.jobs.list(queryParams),
    queryFn: async () => {
      return getJobs(queryParams);
    },
  });

  // Fetch applied count for tab badge
  const appliedCountQuery = useQuery({
    queryKey: queryKeys.jobs.list({ status: "applied", limit: 1 }),
    queryFn: async () => {
      return getJobs({ status: "applied", limit: 1 });
    },
  });

  // Fetch saved count for tab badge
  const savedCountQuery = useQuery({
    queryKey: queryKeys.jobs.list({ status: "interested", limit: 1 }),
    queryFn: async () => {
      return getJobs({ status: "interested", limit: 1 });
    },
  });

  // Fetch archived count for tab badge
  const archivedCountQuery = useQuery({
    queryKey: queryKeys.jobs.list({ status: "archived", limit: 1 }),
    queryFn: async () => {
      return getJobs({ status: "archived", limit: 1 });
    },
  });

  const appliedData = appliedCountQuery.data;
  const savedData = savedCountQuery.data;
  const archivedData = archivedCountQuery.data;
  const jobs: JobSummary[] = data?.jobs || [];
  const totalCount = data?.totalCount || 0;
  const appliedCount = appliedData?.totalCount || 0;
  const savedCount = savedData?.totalCount || 0;
  const archivedCount = archivedData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const pageNumbers = getPageNumbers(currentPage, totalPages);

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-border">
        <button
          onClick={() => handleTabChange("all")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "all"
              ? "border-b-2 border-emerald-500 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All Jobs
        </button>
        <button
          onClick={() => handleTabChange("saved")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "saved"
              ? "border-b-2 border-emerald-500 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Saved
          {savedCount > 0 && (
            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
              {savedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange("applied")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "applied"
              ? "border-b-2 border-emerald-500 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Applied
          {appliedCount > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
              {appliedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange("archived")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "archived"
              ? "border-b-2 border-emerald-500 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Archived
          {archivedCount > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {archivedCount}
            </span>
          )}
        </button>
      </div>

      {appliedCountQuery.isError || savedCountQuery.isError || archivedCountQuery.isError ? (
        <div className="mb-4">
          <ApiErrorState
            error={appliedCountQuery.error ?? savedCountQuery.error ?? archivedCountQuery.error}
            fallbackMessage="One or more job counts could not be loaded."
            onRetry={() => {
              void appliedCountQuery.refetch();
              void savedCountQuery.refetch();
              void archivedCountQuery.refetch();
            }}
          />
        </div>
      ) : null}

      {companiesQuery.isError ? (
        <div className="mb-4">
          <ApiErrorState
            error={companiesQuery.error}
            fallbackMessage="Company filters could not be loaded."
            onRetry={() => void companiesQuery.refetch()}
          />
        </div>
      ) : null}

      {/* Filters - hide status filter when on Applied/Saved tab */}
      <JobFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        companies={companies}
        hideStatusFilter={activeTab !== "all"}
        totalCount={totalCount}
        isFetching={isFetching}
      />

      {scrapeSessionId && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
          <Sparkles className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs">
            Showing jobs matched in one automatic scrape.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              router.replace(`/jobs${buildQueryString(filters, activeTab)}`, { scroll: false });
            }}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            Show all jobs
          </Button>
        </div>
      )}

      {/* Job List and Pagination - scrollable together */}
      <div className="mt-4 space-y-2.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <ApiErrorState
            error={error}
            fallbackMessage="Jobs could not be loaded."
            onRetry={() => void refetch()}
          />
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
            <Briefcase className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium text-foreground">
              {activeTab === "applied"
                ? "No applied jobs yet"
                : activeTab === "archived"
                ? "No archived jobs"
                : activeTab === "saved"
                ? "No saved jobs yet"
                : "No jobs found"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeTab === "applied"
                ? "Jobs you apply to will appear here"
                : activeTab === "archived"
                ? "Closed jobs archived by scraper or manually archived jobs will appear here"
                : activeTab === "saved"
                ? "Click Save on a job to add it here"
                : filters.search || filters.status || filters.companyIds.length > 0 || filters.locationType.length > 0
                ? "Try adjusting your filters"
                : "Add companies and refresh jobs from Settings"}
            </p>
          </div>
        ) : (
          <>
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
              />
            ))}

            {/* Pagination - inside scrollable area */}
            {totalCount > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3">
                {/* Items per page */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
                    className="h-8 rounded border border-border bg-card px-2 text-sm text-foreground"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                {/* Page info */}
                <span className="text-sm text-muted-foreground">
                  {startIndex + 1}-{endIndex} of {totalCount}
                </span>

                {/* Page navigation */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handlePrevPage}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {pageNumbers.map((page, idx) =>
                    page === "ellipsis" ? (
                      <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                        ...
                      </span>
                    ) : (
                      <Button
                        key={page}
                        variant={currentPage === page ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setCurrentPage(page)}
                        className="min-w-[32px]"
                      >
                        {page}
                      </Button>
                    )
                  )}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
