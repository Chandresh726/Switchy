"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CompanyForm } from "./company-form";
import type { CompanyFilters } from "./company-filters";
import {
  Building2,
  ExternalLink,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState, useMemo } from "react";
import Link from "next/link";

interface Company {
  id: number;
  name: string;
  careersUrl: string;
  logoUrl: string | null;
  platform: string | null;
  boardToken: string | null;
  isActive: boolean;
  lastScrapedAt: string | null;
  createdAt: string;
}

interface CompanyListProps {
  filters: CompanyFilters;
  selectionMode: boolean;
  selectedIds: number[];
  onToggleSelection: (id: number) => void;
}

const PLATFORM_COLORS: Record<string, string> = {
  greenhouse: "bg-green-500/10 text-green-400 border-green-500/20",
  lever: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  ashby: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  workday: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  custom: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

function truncateUrl(url: string, maxLength: number = 30): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    if (display.length > maxLength) {
      return display.substring(0, maxLength - 3) + "...";
    }
    return display;
  } catch {
    return url.length > maxLength ? url.substring(0, maxLength - 3) + "..." : url;
  }
}

function getRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "Just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-emerald-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function CompanyList({
  filters,
  selectionMode,
  selectedIds,
  onToggleSelection,
}: CompanyListProps) {
  const queryClient = useQueryClient();
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deleteJobsCompanyId, setDeleteJobsCompanyId] = useState<number | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/companies/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete company");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/jobs/refresh?companyId=${id}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to refresh jobs");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update company");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const deleteJobsMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/companies/${id}/jobs`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete jobs");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setDeleteJobsCompanyId(null);
    },
  });

  const matchJobsMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/companies/${id}/match`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to match jobs");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
    },
  });

  const filteredAndSortedCompanies = useMemo(() => {
    let result = [...companies];

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(searchLower)
      );
    }

    if (filters.platforms.length > 0) {
      result = result.filter((c) =>
        c.platform && filters.platforms.includes(c.platform)
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

  const handleCardClick = (company: Company) => {
    if (selectionMode) {
      onToggleSelection(company.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
        <Building2 className="h-12 w-12 text-zinc-600" />
        <h3 className="mt-4 text-lg font-medium text-white">No companies yet</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Add companies to start tracking job openings
        </p>
      </div>
    );
  }

  if (filteredAndSortedCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
        <Building2 className="h-12 w-12 text-zinc-600" />
        <h3 className="mt-4 text-lg font-medium text-white">No matching companies</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Try adjusting your filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {editingCompany && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <CompanyForm
            company={editingCompany}
            onSuccess={() => setEditingCompany(null)}
            onCancel={() => setEditingCompany(null)}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredAndSortedCompanies.map((company) => {
          const isSelected = selectedIds.includes(company.id);
          
          return (
            <div
              key={company.id}
              onClick={() => handleCardClick(company)}
              className={`group relative rounded-lg border bg-zinc-900/50 p-4 transition-all ${
                selectionMode
                  ? isSelected
                    ? "border-emerald-500 ring-1 ring-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-700 hover:border-emerald-500/50 cursor-pointer"
                  : "border-zinc-800 hover:border-zinc-700"
              } ${!company.isActive && !isSelected ? "opacity-60 grayscale" : ""}`}
            >
              {isSelected && (
                <div className="absolute right-2 top-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
              )}

              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {company.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={company.logoUrl}
                      alt={company.name}
                      className="h-10 w-10 rounded bg-zinc-800 object-contain p-1"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-800 text-lg font-medium text-zinc-400">
                      {company.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <Link
                      href={`/jobs?companyIds=${company.id}`}
                      className="font-medium text-white hover:text-emerald-400 transition-colors"
                      title={`View jobs at ${company.name}`}
                      onClick={(e) => selectionMode && e.preventDefault()}
                    >
                      {company.name}
                    </Link>
                  </div>
                </div>

              {!selectionMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshMutation.mutate(company.id);
                      }}
                      disabled={refreshMutation.isPending}
                      className="cursor-pointer"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      <span className="truncate">Refresh Jobs</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        matchJobsMutation.mutate(company.id);
                      }}
                      disabled={matchJobsMutation.isPending}
                      className="text-purple-400 focus:text-purple-400 cursor-pointer"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      <span className="truncate">Refresh Matching</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteJobsCompanyId(company.id);
                      }}
                      className="text-orange-400 focus:text-orange-400 cursor-pointer"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span className="truncate">Delete All Jobs</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCompany(company);
                      }}
                      className="cursor-pointer"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      <span className="truncate">Edit</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(company.id);
                      }}
                      className="text-red-400 focus:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span className="truncate">Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {company.platform && (
                    <Badge
                      variant="outline"
                      className={PLATFORM_COLORS[company.platform] || PLATFORM_COLORS.custom}
                    >
                      {company.platform}
                    </Badge>
                  )}
                </div>

                <a
                  href={company.careersUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  {truncateUrl(company.careersUrl)}
                </a>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                <div className="flex items-center gap-2">
                  <ToggleSwitch
                    checked={company.isActive}
                    onChange={(isActive) =>
                      toggleActiveMutation.mutate({ id: company.id, isActive })
                    }
                    disabled={toggleActiveMutation.isPending}
                  />
                  <span className={company.isActive ? "text-emerald-400" : "text-zinc-500"}>
                    {company.isActive ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    {company.lastScrapedAt
                      ? `Scraped ${getRelativeTime(company.lastScrapedAt)}`
                      : "Never scraped"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={deleteJobsCompanyId !== null} onOpenChange={(open) => !open && setDeleteJobsCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all jobs for this company? This will remove all
              scraped job postings but keep the company. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => deleteJobsCompanyId && deleteJobsMutation.mutate(deleteJobsCompanyId)}
            >
              Delete All Jobs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
