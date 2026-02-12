"use client";

import { useQuery } from "@tanstack/react-query";
import { JobCard } from "./job-card";
import { JobFilters } from "./job-filters";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Briefcase, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearchParams, useRouter } from "next/navigation";

const STORAGE_KEY = "switchy-job-filters";

interface Filters {
  search: string;
  status: string;
  companyIds: string[];
  locationType: string[];
  employmentType: string[];
  minScore: string;
  department: string;
  locationSearch: string;
  sortBy: string;
  sortOrder: string;
}

const defaultFilters: Filters = {
  search: "",
  status: "",
  companyIds: [],
  locationType: [],
  employmentType: [],
  minScore: "",
  department: "",
  locationSearch: "",
  sortBy: "matchScore",
  sortOrder: "desc",
};

function loadFiltersFromStorage(): Filters {
  if (typeof window === "undefined") return defaultFilters;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultFilters, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultFilters;
}

function parseFiltersFromSearchParams(searchParams: URLSearchParams): Filters {
  const filters: Filters = { ...defaultFilters };
  
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const companyId = searchParams.get("companyId");
  const companyIds = searchParams.get("companyIds");
  const locationType = searchParams.get("locationType");
  const employmentType = searchParams.get("employmentType");
  const minScore = searchParams.get("minScore");
  const department = searchParams.get("department");
  const locationSearch = searchParams.get("locationSearch");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  
  if (search) filters.search = search;
  if (status) filters.status = status;
  // Handle both companyId (legacy) and companyIds (preferred)
  if (companyId) {
    filters.companyIds = [companyId];
  } else if (companyIds) {
    filters.companyIds = companyIds.split(",").filter(Boolean);
  }
  if (locationType) filters.locationType = locationType.split(",").filter(Boolean);
  if (employmentType) filters.employmentType = employmentType.split(",").filter(Boolean);
  if (minScore) filters.minScore = minScore;
  if (department) filters.department = department;
  if (locationSearch) filters.locationSearch = locationSearch;
  if (sortBy) filters.sortBy = sortBy;
  if (sortOrder) filters.sortOrder = sortOrder;
  
  return filters;
}

function parseTabFromSearchParams(searchParams: URLSearchParams): TabType {
  const tab = searchParams.get("tab");
  return tab === "saved" || tab === "applied" ? tab : "all";
}

function buildQueryString(filters: Filters, tab: TabType): string {
  const params = new URLSearchParams();
  
  if (tab !== "all") params.set("tab", tab);
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  // Only use companyIds, not companyId
  if (filters.companyIds.length > 0) params.set("companyIds", filters.companyIds.join(","));
  if (filters.locationType.length > 0) params.set("locationType", filters.locationType.join(","));
  if (filters.employmentType.length > 0) params.set("employmentType", filters.employmentType.join(","));
  if (filters.minScore) params.set("minScore", filters.minScore);
  if (filters.department) params.set("department", filters.department);
  if (filters.locationSearch) params.set("locationSearch", filters.locationSearch);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
  
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

interface Job {
  id: number;
  title: string;
  url: string;
  location: string | null;
  locationType: string | null;
  department: string | null;
  salary: string | null;
  employmentType: string | null;
  status: string;
  matchScore: number | null;
  postedDate: string | null;
  discoveredAt: string;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
    platform: string | null;
  };
}

interface Company {
  id: number;
  name: string;
}

type TabType = "all" | "saved" | "applied";

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

  // Pagination state
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Load filters from URL params and localStorage on mount
  useEffect(() => {
    const urlFilters = parseFiltersFromSearchParams(searchParams);
    const urlTab = parseTabFromSearchParams(searchParams);
    const storageFilters = loadFiltersFromStorage();
    
    // Priority: URL params > localStorage > defaults
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
    }, 0);
  }, [searchParams]);

  // Save filters to localStorage and sync to URL when they change
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    }
  }, [filters, isInitialized]);
  
  // Debounced URL update to avoid history spam
  const updateUrl = useCallback((newFilters: Filters, newTab: TabType) => {
    const queryString = buildQueryString(newFilters, newTab);
    const currentUrl = `/jobs${queryString}`;
    
    // Only update if the URL is different from current
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== currentUrl) {
      router.replace(currentUrl, { scroll: false });
    }
  }, [router]);
  
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
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  // Determine effective status filter based on active tab
  const effectiveStatus =
    activeTab === "applied" ? "applied" :
    activeTab === "saved" ? "interested" :
    filters.status;

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (effectiveStatus) params.set("status", effectiveStatus);
    if (filters.companyIds && filters.companyIds.length > 0) {
      params.set("companyIds", filters.companyIds.join(","));
    }
    if (filters.locationType.length > 0) {
      params.set("locationType", filters.locationType.join(","));
    }
    if (filters.employmentType.length > 0) {
      params.set("employmentType", filters.employmentType.join(","));
    }
    if (filters.minScore) params.set("minScore", filters.minScore);
    if (debouncedDepartment) params.set("department", debouncedDepartment);
    if (debouncedLocationSearch) params.set("locationSearch", debouncedLocationSearch);
    if (filters.sortBy) params.set("sortBy", filters.sortBy);
    if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);

    // Pagination params
    params.set("limit", pageSize.toString());
    params.set("offset", ((currentPage - 1) * pageSize).toString());

    return params.toString();
  }, [
    debouncedSearch,
    effectiveStatus,
    filters.companyIds,
    filters.locationType,
    filters.employmentType,
    filters.minScore,
    debouncedDepartment,
    debouncedLocationSearch,
    filters.sortBy,
    filters.sortOrder,
    pageSize,
    currentPage,
  ]);

  // Fetch jobs
  const { data, isLoading, isFetching } = useQuery<{
    jobs: Job[];
    totalCount: number;
    hasMore: boolean;
  }>({
    queryKey: ["jobs", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  // Fetch applied count for tab badge
  const { data: appliedData } = useQuery<{ totalCount: number }>({
    queryKey: ["jobs", "applied-count"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?status=applied&limit=1");
      if (!res.ok) throw new Error("Failed to fetch applied count");
      return res.json();
    },
  });

  // Fetch saved count for tab badge
  const { data: savedData } = useQuery<{ totalCount: number }>({
    queryKey: ["jobs", "saved-count"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?status=interested&limit=1");
      if (!res.ok) throw new Error("Failed to fetch saved count");
      return res.json();
    },
  });

  const jobs: Job[] = data?.jobs || [];
  const totalCount = data?.totalCount || 0;
  const appliedCount = appliedData?.totalCount || 0;
  const savedCount = savedData?.totalCount || 0;
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

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("ellipsis");

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) pages.push(i);

      if (currentPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-zinc-800">
        <button
          onClick={() => handleTabChange("all")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "all"
              ? "border-b-2 border-emerald-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          All Jobs
        </button>
        <button
          onClick={() => handleTabChange("saved")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "saved"
              ? "border-b-2 border-emerald-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
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
              ? "border-b-2 border-emerald-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Applied
          {appliedCount > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
              {appliedCount}
            </span>
          )}
        </button>
      </div>

      {/* Header with count */}
      <div className="flex items-center gap-2 pb-4">
        <span className="text-sm text-zinc-400">
          {totalCount} {totalCount === 1 ? "job" : "jobs"}
        </span>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
      </div>

      {/* Filters - hide status filter when on Applied/Saved tab */}
      <JobFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        companies={companies}
        hideStatusFilter={activeTab !== "all"}
      />

      {/* Job List and Pagination - scrollable together */}
      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
            <Briefcase className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium text-white">
              {activeTab === "applied"
                ? "No applied jobs yet"
                : activeTab === "saved"
                ? "No saved jobs yet"
                : "No jobs found"}
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              {activeTab === "applied"
                ? "Jobs you apply to will appear here"
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
              <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 pt-3">
                {/* Items per page */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Show:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
                    className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                {/* Page info */}
                <span className="text-sm text-zinc-400">
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

                  {getPageNumbers().map((page, idx) =>
                    page === "ellipsis" ? (
                      <span key={`ellipsis-${idx}`} className="px-2 text-zinc-500">
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
