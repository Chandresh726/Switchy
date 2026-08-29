"use client";

import { Suspense, useState, useRef, useCallback, useMemo, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { List, FileJson, Download, Upload, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CompanyFilters, type CompanyFilters as CompanyFiltersType } from "@/components/companies/company-filters";
import { CompanyForm } from "@/components/companies/company-form";
import { CompanyQuickAdd } from "@/components/companies/company-quick-add";
import { CompanyList } from "@/components/companies/company-list";
import { JsonEditor } from "@/components/companies/json-editor";
import {
  bulkDeleteCompanies,
  bulkDeleteCompanyJobs,
  bulkSetCompaniesActive,
  createCompanies,
  getCompanies,
  matchCompanies,
  refreshCompanyJobs,
} from "@/lib/api/clients/companies";
import { CUSTOM_SCRAPER_PLATFORMS } from "@/lib/constants";
import { companyImportBodySchema } from "@/lib/api/contracts/companies";
import type { Company } from "@/lib/api/contracts/companies";
import {
  getDefaultAddCompanyTab,
  type AddCompanyTab,
} from "@/lib/companies/preset-companies";
import { usePresetCompanies } from "@/lib/hooks/use-preset-companies";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { useMatchSession } from "@/lib/hooks/use-match-session";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

const CUSTOM_PLATFORM_SET = new Set<string>(["custom", ...CUSTOM_SCRAPER_PLATFORMS]);

function normalizePlatformFilters(platforms: string[]): string[] {
  const normalized = new Set<string>();
  for (const platform of platforms) {
    if (CUSTOM_PLATFORM_SET.has(platform)) {
      normalized.add("custom");
    } else {
      normalized.add(platform);
    }
  }
  return Array.from(normalized);
}

function parseFiltersFromParams(searchParams: URLSearchParams): CompanyFiltersType {
  return {
    search: searchParams.get("search") || "",
    platforms: normalizePlatformFilters(
      searchParams.get("platforms")?.split(",").filter(Boolean) || []
    ),
    status: searchParams.get("status")?.split(",").filter(Boolean) || [],
    sortBy: (searchParams.get("sortBy") as CompanyFiltersType["sortBy"]) || "name",
    sortOrder: (searchParams.get("sortOrder") as CompanyFiltersType["sortOrder"]) || "asc",
  };
}

function serializeFiltersToParams(filters: CompanyFiltersType): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.platforms.length > 0) params.set("platforms", filters.platforms.join(","));
  if (filters.status.length > 0) params.set("status", filters.status.join(","));
  params.set("sortBy", filters.sortBy);
  params.set("sortOrder", filters.sortOrder);
  return params;
}

function CompaniesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const searchParamsString = searchParams.toString();
  const filters = useMemo(
    () => parseFiltersFromParams(new URLSearchParams(searchParamsString)),
    [searchParamsString]
  );
  const [view, setView] = useState<"list" | "json">("list");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedAddPanelTab, setSelectedAddPanelTab] = useState<AddCompanyTab | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [matchSessionId, setMatchSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  useMatchSession(matchSessionId, { onSettled: () => setMatchSessionId(null) });

  useEffect(() => {
    if (searchParams.toString() === "") {
      router.replace(`${pathname}?sortBy=name&sortOrder=asc`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiltersChange = useCallback(
    (newFilters: CompanyFiltersType) => {
      const normalized = {
        ...newFilters,
        platforms: normalizePlatformFilters(newFilters.platforms),
      };
      const params = serializeFiltersToParams(normalized);
      const paramString = params.toString();
      router.replace(`${pathname}${paramString ? `?${paramString}` : ""}`);
    },
    [router, pathname]
  );

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds([]);
      }
      return !prev;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const scrollToPageTop = useCallback(() => {
    const scrollToTop = (behavior: ScrollBehavior) => {
      const mainContent = document.getElementById("main-content");
      if (mainContent) {
        mainContent.scrollTo({ top: 0, behavior });
        return;
      }

      window.scrollTo({ top: 0, behavior });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToTop("smooth");
      });
    });

    window.setTimeout(() => {
      scrollToTop("auto");
    }, 320);
  }, []);

  const openEditCompanyPanel = useCallback((company: Company) => {
    setEditingCompany(company);
    setSelectedAddPanelTab("manual");
    setIsAdding(true);
    scrollToPageTop();
  }, [scrollToPageTop]);

  const closeAddPanel = useCallback(() => {
    setIsAdding(false);
    setEditingCompany(null);
    setSelectedAddPanelTab(null);
  }, []);

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const companiesQuery = useQuery<Company[]>({
    queryKey: queryKeys.companies.list(),
    queryFn: async () => {
      return getCompanies();
    },
  });
  const companies = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);
  const presetCompaniesQuery = usePresetCompanies();
  const defaultAddPanelTab = useMemo(
    () => getDefaultAddCompanyTab(presetCompaniesQuery.data, companies),
    [presetCompaniesQuery.data, companies]
  );
  const addPanelTab = selectedAddPanelTab ?? defaultAddPanelTab;

  const openAddCompanyPanel = useCallback(() => {
    setEditingCompany(null);
    setSelectedAddPanelTab(null);
    setIsAdding(true);
  }, []);

  const filteredAndSortedCompanies = useMemo(() => {
    let result = [...companies];

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(searchLower)
      );
    }

    if (filters.platforms.length > 0) {
      const wantsCustom = filters.platforms.includes("custom");
      const platformSet = new Set(filters.platforms);
      result = result.filter((c) =>
        c.platform &&
        (platformSet.has(c.platform) || (wantsCustom && CUSTOM_PLATFORM_SET.has(c.platform)))
      );
    }

    if (filters.status.length > 0) {
      const wantActive = filters.status.includes("active");
      const wantPaused = filters.status.includes("paused");
      result = result.filter((c) => {
        if (c.isActive && wantActive) return true;
        if (!c.isActive && wantPaused) return true;
        return false;
      });
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (filters.sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "lastScrapedAt":
          const aScraped = a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0;
          const bScraped = b.lastScrapedAt ? new Date(b.lastScrapedAt).getTime() : 0;
          comparison = bScraped - aScraped;
          break;
        case "createdAt":
        default:
          comparison = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
      }
      return filters.sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [companies, filters]);

  const allActiveFilteredIds = useMemo(
    () => filteredAndSortedCompanies.filter((c) => c.isActive).map((c) => c.id),
    [filteredAndSortedCompanies]
  );

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(allActiveFilteredIds);
    if (!selectionMode) {
      setSelectionMode(true);
    }
  }, [allActiveFilteredIds, selectionMode]);

  const importMutation = useMutation({
    mutationFn: async (companies: unknown[]) => {
      return createCompanies(companyImportBodySchema.parse(companies));
    },
    onSuccess: (data) => {
      void cacheOwnership.companyMutation(queryClient, { affectsMappings: true });
      toast.success(`Successfully imported ${Array.isArray(data) ? data.length : 1} companies`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to import companies"));
    },
  });

  const bulkRefreshMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      return refreshCompanyJobs(companyIds);
    },
    onSuccess: (data) => {
      void cacheOwnership.companyMutation(queryClient, { affectsScrapeHistory: true });
      toast.success(data.message || "Jobs refreshed successfully");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to refresh jobs"));
    },
  });

  const bulkMatchMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      return matchCompanies(companyIds);
    },
    onSuccess: (data: { sessionId: string; total: number }) => {
      setMatchSessionId(data.sessionId || null);
      toast.success(`Queued ${data.total} jobs for matching`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to refresh matches"));
    },
  });

  const bulkDeleteJobsMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      return bulkDeleteCompanyJobs(companyIds);
    },
    onSuccess: (data) => {
      void cacheOwnership.companyMutation(queryClient, { affectsJobRecords: true });
      toast.success(data.message || "Jobs deleted successfully");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to delete jobs"));
    },
  });

  const bulkDeleteCompaniesMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      return bulkDeleteCompanies(companyIds);
    },
    onSuccess: (data) => {
      void cacheOwnership.companyMutation(queryClient, {
        affectsMappings: true,
        affectsJobRecords: true,
      });
      setSelectedIds([]);
      setSelectionMode(false);
      toast.success(data.message || "Companies deleted successfully");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to delete companies"));
    },
  });

  const bulkToggleActiveMutation = useMutation({
    mutationFn: async ({ companyIds, isActive }: { companyIds: number[]; isActive: boolean }) => {
      return bulkSetCompaniesActive(companyIds, isActive);
    },
    onSuccess: (data) => {
      void cacheOwnership.companyMutation(queryClient);
      toast.success(data.message || "Companies updated successfully");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to update companies"));
    },
  });

  const refreshSelectedCompany = bulkRefreshMutation.mutate;
  const matchSelectedCompany = bulkMatchMutation.mutate;
  const handleRefreshCompanyJobs = useCallback(
    (companyId: number) => refreshSelectedCompany([companyId]),
    [refreshSelectedCompany]
  );
  const handleRefreshCompanyMatches = useCallback(
    (companyId: number) => matchSelectedCompany([companyId]),
    [matchSelectedCompany]
  );

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        if (!Array.isArray(data)) {
          toast.error("Invalid file format: Root must be an array");
          return;
        }
        importMutation.mutate(data);
      } catch {
        toast.error("Invalid JSON file");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleExport = async () => {
    try {
      const data = await getCompanies();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const exportData = data.map(({ id, createdAt, updatedAt, ...rest }) => rest);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "companies.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to export companies"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Companies</h1>
          <p className="mt-1 text-muted-foreground">
            Track companies and their job openings
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-card p-1">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("list")}
              className="h-7 px-2"
            >
              <List className="mr-2 h-4 w-4" />
              List
            </Button>
            <Button
              variant={view === "json" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("json")}
              className="h-7 px-2"
            >
              <FileJson className="mr-2 h-4 w-4" />
              JSON
            </Button>
          </div>

          <div className="h-6 w-px bg-muted mx-2 hidden sm:block" />

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".json"
            onChange={handleFileUpload}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Import
          </Button>

          <Button variant="outline" size="sm" onClick={handleExport}>
            <Upload className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {view === "list" && (
        <CompanyFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelectionMode={toggleSelectionMode}
          onClearSelection={clearSelection}
          onSelectAll={selectAllFiltered}
          onBulkRefreshJobs={() => bulkRefreshMutation.mutate(selectedIds)}
          onBulkRefreshMatches={() => bulkMatchMutation.mutate(selectedIds)}
          onBulkDeleteJobs={() => bulkDeleteJobsMutation.mutate(selectedIds)}
          onBulkDeleteCompanies={() => bulkDeleteCompaniesMutation.mutate(selectedIds)}
          onBulkToggleActive={() => {
            bulkToggleActiveMutation.mutate({
              companyIds: selectedIds,
              isActive: true,
            });
          }}
          onAddCompany={openAddCompanyPanel}
          isRefreshing={bulkRefreshMutation.isPending}
          isMatching={bulkMatchMutation.isPending || Boolean(matchSessionId)}
          isDeletingJobs={bulkDeleteJobsMutation.isPending}
          isDeletingCompanies={bulkDeleteCompaniesMutation.isPending}
          isTogglingActive={bulkToggleActiveMutation.isPending}
        />
      )}

      {view === "list" && isAdding && (
        <div className="rounded-xl border border-border bg-card/70 p-4 sm:p-6">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              type="single"
              value={addPanelTab}
              onValueChange={(value) => {
                if (value !== "quick" && value !== "manual") return;
                if (value === "quick") setEditingCompany(null);
                setSelectedAddPanelTab(value);
              }}
              size="sm"
              spacing={1}
              aria-label="Company add method"
              className="rounded-md border border-border bg-card p-1"
            >
              <ToggleGroupItem
                value="quick"
                className="rounded-sm px-3 data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
              >
                Quick Add
              </ToggleGroupItem>
              <ToggleGroupItem
                value="manual"
                className="rounded-sm px-3 data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
              >
                Custom Company
              </ToggleGroupItem>
            </ToggleGroup>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-end sm:self-auto"
              onClick={closeAddPanel}
            >
              <X className="mr-1.5 h-4 w-4" />
              Close
            </Button>
          </div>

          <Separator className="mb-5" />

          {addPanelTab === "quick" ? (
            <CompanyQuickAdd existingCompanies={companies} />
          ) : (
            <CompanyForm
              company={editingCompany ?? undefined}
              onSuccess={closeAddPanel}
            />
          )}
        </div>
      )}

      {view === "list" ? (
        companiesQuery.isError ? (
          <ApiErrorState
            error={companiesQuery.error}
            fallbackMessage="Companies could not be loaded."
            onRetry={() => void companiesQuery.refetch()}
          />
        ) : (
          <CompanyList
            companies={filteredAndSortedCompanies}
            isLoading={companiesQuery.isLoading}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
            onEditCompany={openEditCompanyPanel}
            onRefreshJobs={handleRefreshCompanyJobs}
            onRefreshMatches={handleRefreshCompanyMatches}
            isRefreshing={bulkRefreshMutation.isPending}
            isMatching={bulkMatchMutation.isPending || Boolean(matchSessionId)}
          />
        )
      ) : (
        <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-xl border border-border bg-background">
          <JsonEditor onSuccess={() => {}} />
        </div>
      )}
    </div>
  );
}

export default function CompaniesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <CompaniesPageContent />
    </Suspense>
  );
}
