"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  X,
  RefreshCw,
  Sparkles,
  Trash2,
  CheckCircle2,
  Plus,
  Loader2,
  ToggleRight,
  MoreHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface CompanyFilters {
  search: string;
  platforms: string[];
  status: string[];
  sortBy: "name" | "lastScrapedAt" | "createdAt";
  sortOrder: "asc" | "desc";
}

interface CompanyFiltersProps {
  filters: CompanyFilters;
  onFiltersChange: (filters: CompanyFilters) => void;
  selectionMode: boolean;
  selectedIds: number[];
  onToggleSelectionMode: () => void;
  onClearSelection: () => void;
  onBulkRefreshJobs: () => void;
  onBulkRefreshMatches: () => void;
  onBulkDeleteJobs: () => void;
  onBulkDeleteCompanies: () => void;
  onBulkToggleActive: () => void;
  onAddCompany: () => void;
  isRefreshing: boolean;
  isMatching: boolean;
  isDeletingJobs: boolean;
  isDeletingCompanies: boolean;
  isTogglingActive: boolean;
}

const PLATFORM_OPTIONS = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "lastScrapedAt", label: "Last Scraped" },
  { value: "createdAt", label: "Date Added" },
];

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400">
      {label}
      <button
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-emerald-500/30"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TogglePill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        selected
          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

export function CompanyFilters({
  filters,
  onFiltersChange,
  selectionMode,
  selectedIds,
  onToggleSelectionMode,
  onClearSelection,
  onBulkRefreshJobs,
  onBulkRefreshMatches,
  onBulkDeleteJobs,
  onBulkDeleteCompanies,
  onBulkToggleActive,
  onAddCompany,
  isRefreshing,
  isMatching,
  isDeletingJobs,
  isDeletingCompanies,
  isTogglingActive,
}: CompanyFiltersProps) {
  const [showDeleteJobsDialog, setShowDeleteJobsDialog] = useState(false);
  const [showDeleteCompaniesDialog, setShowDeleteCompaniesDialog] = useState(false);

  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];

    filters.platforms.forEach((p) => {
      const label = PLATFORM_OPTIONS.find((o) => o.value === p)?.label || p;
      chips.push({
        key: `platform-${p}`,
        label,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            platforms: filters.platforms.filter((x) => x !== p),
          }),
      });
    });

    filters.status.forEach((s) => {
      const label = STATUS_OPTIONS.find((o) => o.value === s)?.label || s;
      chips.push({
        key: `status-${s}`,
        label,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            status: filters.status.filter((x) => x !== s),
          }),
      });
    });

    return chips;
  }, [filters, onFiltersChange]);

  const hasActiveFilters = activeFilters.length > 0;
  const hasSelection = selectedIds.length > 0;
  const isAnyLoading = isRefreshing || isMatching || isDeletingJobs || isDeletingCompanies || isTogglingActive;

  const clearAllFilters = () => {
    onFiltersChange({
      ...filters,
      platforms: [],
      status: [],
    });
  };

  const togglePlatform = (value: string) => {
    const current = filters.platforms;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, platforms: updated });
  };

  const toggleStatus = (value: string) => {
    const current = filters.status;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, status: updated });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search companies..."
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            className="pl-9"
          />
        </div>
        <Button size="sm" onClick={onAddCompany} className="h-8">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Company
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PLATFORM_OPTIONS.map((opt) => (
          <TogglePill
            key={opt.value}
            selected={filters.platforms.includes(opt.value)}
            onClick={() => togglePlatform(opt.value)}
          >
            {opt.label}
          </TogglePill>
        ))}

        <div className="h-5 w-px bg-zinc-700" />

        {STATUS_OPTIONS.map((opt) => (
          <TogglePill
            key={opt.value}
            selected={filters.status.includes(opt.value)}
            onClick={() => toggleStatus(opt.value)}
          >
            {opt.label}
          </TogglePill>
        ))}

        <div className="h-5 w-px bg-zinc-700" />

        <select
          value={filters.sortBy}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              sortBy: e.target.value as CompanyFilters["sortBy"],
            })
          }
          className="h-7 rounded-full border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            onFiltersChange({
              ...filters,
              sortOrder: filters.sortOrder === "desc" ? "asc" : "desc",
            })
          }
          className="rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          title={filters.sortOrder === "desc" ? "Descending" : "Ascending"}
        >
          {filters.sortOrder === "desc" ? "↓" : "↑"}
        </button>

        <div className="flex-1" />

        {selectionMode && hasSelection && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isAnyLoading} className="h-7 text-xs">
                {isAnyLoading ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <MoreHorizontal className="mr-1.5 h-3 w-3" />
                )}
                Options
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={onBulkRefreshJobs}
                disabled={isRefreshing}
                className="cursor-pointer"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Jobs
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onBulkRefreshMatches}
                disabled={isMatching}
                className="cursor-pointer"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Refresh Matches
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onBulkToggleActive}
                disabled={isTogglingActive}
                className="cursor-pointer"
              >
                <ToggleRight className="mr-2 h-4 w-4" />
                Toggle Active
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteJobsDialog(true)}
                className="text-orange-400 focus:text-orange-400 cursor-pointer"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete All Jobs
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowDeleteCompaniesDialog(true)}
                className="text-red-400 focus:text-red-400 cursor-pointer"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Companies
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {selectionMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleSelectionMode}
            className="h-7 text-xs"
          >
            <CheckCircle2 className="mr-1.5 h-3 w-3" />
            Done
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleSelectionMode}
            className="h-7 text-xs"
          >
            <CheckCircle2 className="mr-1.5 h-3 w-3" />
            Select Multiple
          </Button>
        )}
      </div>

      {(hasActiveFilters || (selectionMode && hasSelection)) && (
        <div className="flex flex-wrap items-center gap-2">
          {hasActiveFilters && (
            <>
              {activeFilters.map((chip) => (
                <FilterChip
                  key={chip.key}
                  label={chip.label}
                  onRemove={chip.onRemove}
                />
              ))}
              <button
                onClick={clearAllFilters}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Clear all
              </button>
            </>
          )}
          {selectionMode && hasSelection && (
            <span className="text-xs text-zinc-400">
              {hasActiveFilters && "• "}
              {selectedIds.length} selected
              <button
                onClick={onClearSelection}
                className="ml-2 text-emerald-400 hover:text-emerald-300"
              >
                Clear selection
              </button>
            </span>
          )}
        </div>
      )}

      <AlertDialog open={showDeleteJobsDialog} onOpenChange={setShowDeleteJobsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all jobs for {selectedIds.length} selected
              {selectedIds.length === 1 ? " company" : " companies"}? This will remove all
              scraped job postings but keep the companies. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                setShowDeleteJobsDialog(false);
                onBulkDeleteJobs();
              }}
            >
              Delete All Jobs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteCompaniesDialog} onOpenChange={setShowDeleteCompaniesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Companies</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.length} selected
              {selectedIds.length === 1 ? " company" : " companies"} and all their jobs?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                setShowDeleteCompaniesDialog(false);
                onBulkDeleteCompanies();
              }}
            >
              Delete Companies
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
