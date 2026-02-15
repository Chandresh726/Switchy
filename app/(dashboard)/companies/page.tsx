"use client";

import { Suspense, useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CompanyForm } from "@/components/companies/company-form";
import { CompanyList } from "@/components/companies/company-list";
import { JsonEditor } from "@/components/companies/json-editor";
import { CompanyFilters, type CompanyFilters as CompanyFiltersType } from "@/components/companies/company-filters";
import { List, FileJson, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, usePathname, useRouter } from "next/navigation";

function parseFiltersFromParams(searchParams: URLSearchParams): CompanyFiltersType {
  return {
    search: searchParams.get("search") || "",
    platforms: searchParams.get("platforms")?.split(",").filter(Boolean) || [],
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
  
  const filters = useMemo(() => parseFiltersFromParams(searchParams), [searchParams]);
  const [view, setView] = useState<"list" | "json">("list");
  const [isAdding, setIsAdding] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (searchParams.toString() === "") {
      router.replace(`${pathname}?sortBy=name&sortOrder=asc`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiltersChange = useCallback(
    (newFilters: CompanyFiltersType) => {
      const params = serializeFiltersToParams(newFilters);
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

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const importMutation = useMutation({
    mutationFn: async (companies: unknown[]) => {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companies),
      });
      if (!res.ok) throw new Error("Failed to import companies");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(`Successfully imported ${Array.isArray(data) ? data.length : 1} companies`);
    },
    onError: () => {
      toast.error("Failed to import companies");
    },
  });

  const bulkRefreshMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      const res = await fetch("/api/companies/bulk/refresh-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Failed to refresh jobs");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(data.message || "Jobs refreshed successfully");
    },
    onError: () => {
      toast.error("Failed to refresh jobs");
    },
  });

  const bulkMatchMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      const res = await fetch("/api/companies/bulk/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Failed to match jobs");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      toast.success(data.message || "Matches refreshed successfully");
    },
    onError: () => {
      toast.error("Failed to refresh matches");
    },
  });

  const bulkDeleteJobsMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      const res = await fetch("/api/companies/bulk/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Failed to delete jobs");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(data.message || "Jobs deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete jobs");
    },
  });

  const bulkDeleteCompaniesMutation = useMutation({
    mutationFn: async (companyIds: number[]) => {
      const res = await fetch("/api/companies/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Failed to delete companies");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setSelectedIds([]);
      setSelectionMode(false);
      toast.success(data.message || "Companies deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete companies");
    },
  });

  const bulkToggleActiveMutation = useMutation({
    mutationFn: async ({ companyIds, isActive }: { companyIds: number[]; isActive: boolean }) => {
      const res = await fetch("/api/companies/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds, isActive }),
      });
      if (!res.ok) throw new Error("Failed to update companies");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(data.message || "Companies updated successfully");
    },
    onError: () => {
      toast.error("Failed to update companies");
    },
  });

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
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      const data = await res.json();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const exportData = data.map(({ id, createdAt, updatedAt, ...rest }: { id: number; createdAt: string; updatedAt: string; [key: string]: unknown }) => rest);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "companies.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export companies");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Companies</h1>
          <p className="mt-1 text-zinc-400">
            Track companies and their job openings
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-1">
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

          <div className="h-6 w-px bg-zinc-800 mx-2 hidden sm:block" />

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
          onAddCompany={() => setIsAdding(true)}
          isRefreshing={bulkRefreshMutation.isPending}
          isMatching={bulkMatchMutation.isPending}
          isDeletingJobs={bulkDeleteJobsMutation.isPending}
          isDeletingCompanies={bulkDeleteCompaniesMutation.isPending}
          isTogglingActive={bulkToggleActiveMutation.isPending}
        />
      )}

      {view === "list" && isAdding && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <CompanyForm
            onSuccess={() => setIsAdding(false)}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      {view === "list" ? (
        <CompanyList
          filters={filters}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelection={toggleSelection}
        />
      ) : (
        <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
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
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    }>
      <CompaniesPageContent />
    </Suspense>
  );
}
