"use client";

import Link from "next/link";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteCompany,
  deleteCompanyJobs,
  patchCompany,
} from "@/lib/api/clients/companies";
import type {
  Company,
  CompanyOverviewResponse,
} from "@/lib/api/contracts/companies";
import { formatCompanyUrl } from "@/lib/companies/display";
import { isCompanyScrapeSupported } from "@/lib/companies/scrape-support";
import { PLATFORM_COLORS } from "@/lib/constants";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface CompanyListProps {
  companies: Company[];
  isLoading: boolean;
  selectionMode: boolean;
  selectedIds: number[];
  onToggleSelection: (id: number) => void;
  onEditCompany: (company: Company) => void;
  onRefreshJobs: (companyId: number) => void;
  onRefreshMatches: (companyId: number) => void;
  isRefreshing: boolean;
  isMatching: boolean;
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
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-emerald-500" : "bg-muted"
        }`}
    >
      <span
        className={`pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0 transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"
          }`}
      />
    </button>
  );
}

interface CompanyCardProps {
  company: Company;
  isSelected: boolean;
  isTogglePending: boolean;
  selectionMode: boolean;
  onToggleSelection: (id: number) => void;
  onEditCompany: (company: Company) => void;
  onRefreshJobs: (companyId: number) => void;
  onRefreshMatches: (companyId: number) => void;
  onDeleteCompany: (companyId: number) => void;
  onDeleteJobs: (companyId: number) => void;
  onToggleActive: (companyId: number, isActive: boolean) => void;
  isRefreshing: boolean;
  isMatching: boolean;
}

const CompanyCard = memo(function CompanyCard({
  company,
  isSelected,
  isTogglePending,
  selectionMode,
  onToggleSelection,
  onEditCompany,
  onRefreshJobs,
  onRefreshMatches,
  onDeleteCompany,
  onDeleteJobs,
  onToggleActive,
  isRefreshing,
  isMatching,
}: CompanyCardProps) {
  const suppressCloseAutoFocusRef = useRef(false);
  const canScrapeJobs = isCompanyScrapeSupported(company.careersUrl, company.platform);

  return (
    <div
      onClick={() => {
        if (selectionMode) onToggleSelection(company.id);
      }}
      className={`group relative rounded-lg border bg-card/70 p-4 transition-all ${selectionMode
          ? isSelected
            ? "border-emerald-500 ring-1 ring-emerald-500/50 bg-emerald-500/5"
            : "border-border hover:border-emerald-500/50 cursor-pointer"
          : "border-border hover:border-border"
        } ${!company.isActive && !isSelected ? "opacity-60 grayscale" : ""}`}
    >
      {isSelected ? (
        <div className="absolute right-2 top-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </div>
      ) : null}

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt={company.name}
              className="h-10 w-10 rounded bg-muted object-contain p-1"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-lg font-medium text-muted-foreground">
              {company.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <Link
              href={`/companies/${company.id}/jobs`}
              className="font-medium text-foreground transition-colors hover:text-emerald-400"
              title={`View company details for ${company.name}`}
              onClick={(event) => {
                if (selectionMode) event.preventDefault();
              }}
            >
              {company.name}
            </Link>
          </div>
        </div>

        {!selectionMode ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              onCloseAutoFocus={(event) => {
                if (suppressCloseAutoFocusRef.current) {
                  event.preventDefault();
                  suppressCloseAutoFocusRef.current = false;
                }
              }}
            >
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onRefreshJobs(company.id);
                }}
                disabled={isRefreshing || !canScrapeJobs}
                className="cursor-pointer"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                <span className="truncate">Refresh Jobs</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onRefreshMatches(company.id);
                }}
                disabled={isMatching}
                className="cursor-pointer text-purple-400 focus:text-purple-400"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                <span className="truncate">Refresh Matching</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteJobs(company.id);
                }}
                className="cursor-pointer text-orange-400 focus:text-orange-400"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span className="truncate">Delete All Jobs</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  suppressCloseAutoFocusRef.current = true;
                  onEditCompany(company);
                }}
                className="cursor-pointer"
              >
                <Pencil className="mr-2 h-4 w-4" />
                <span className="truncate">Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteCompany(company.id);
                }}
                className="cursor-pointer text-red-400 focus:text-red-400"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span className="truncate">Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {company.platform ? (
            <Badge
              variant="outline"
              className={PLATFORM_COLORS[company.platform] || PLATFORM_COLORS.custom}
            >
              {company.platform}
            </Badge>
          ) : null}
        </div>

        <a
          href={company.careersUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {formatCompanyUrl(company.careersUrl)}
        </a>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={company.isActive}
            onChange={(isActive) => onToggleActive(company.id, isActive)}
            disabled={isTogglePending}
            ariaLabel={`${company.name} active status`}
          />
          <span className={company.isActive ? "text-emerald-400" : "text-muted-foreground"}>
            {company.isActive ? "Active" : "Paused"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {company.lastScrapedAt ? (
            <span>{`Scraped ${getRelativeTime(company.lastScrapedAt)}`}</span>
          ) : canScrapeJobs ? (
            <span>Never scraped</span>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-300"
            >
              Scraping unavailable
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
});

export function CompanyList({
  companies,
  isLoading,
  selectionMode,
  selectedIds,
  onToggleSelection,
  onEditCompany,
  onRefreshJobs,
  onRefreshMatches,
  isRefreshing,
  isMatching,
}: CompanyListProps) {
  const queryClient = useQueryClient();
  const [deleteJobsCompanyId, setDeleteJobsCompanyId] = useState<number | null>(null);
  const [pendingToggleIds, setPendingToggleIds] = useState<Set<number>>(() => new Set());
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return deleteCompany(id);
    },
    onSuccess: (_result, id) => {
      void cacheOwnership.companyMutation(queryClient, {
        companyId: id,
        affectsMappings: true,
        affectsJobRecords: true,
      });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete company")),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return patchCompany(id, { isActive });
    },
    onMutate: async ({ id, isActive }) => {
      const listKey = queryKeys.companies.list();
      const overviewKey = queryKeys.companies.overview(id);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: overviewKey }),
      ]);

      const previousCompany = queryClient
        .getQueryData<Company[]>(listKey)
        ?.find((company) => company.id === id);
      const previousOverview = queryClient.getQueryData<CompanyOverviewResponse>(overviewKey);

      queryClient.setQueryData<Company[]>(listKey, (current) =>
        current?.map((company) =>
          company.id === id ? { ...company, isActive } : company
        )
      );
      queryClient.setQueryData<CompanyOverviewResponse>(overviewKey, (current) =>
        current
          ? {
              ...current,
              company: { ...current.company, isActive },
            }
          : current
      );
      setPendingToggleIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

      return { previousCompany, previousOverview };
    },
    onSuccess: (updatedCompany) => {
      queryClient.setQueryData<Company[]>(queryKeys.companies.list(), (current) =>
        current?.map((company) =>
          company.id === updatedCompany.id ? updatedCompany : company
        )
      );
      queryClient.setQueryData<CompanyOverviewResponse>(
        queryKeys.companies.overview(updatedCompany.id),
        (current) =>
          current
            ? {
                ...current,
                company: {
                  ...current.company,
                  isActive: updatedCompany.isActive,
                },
              }
            : current
      );
    },
    onError: (error, variables, context) => {
      const previousCompany = context?.previousCompany;
      if (previousCompany) {
        queryClient.setQueryData<Company[]>(queryKeys.companies.list(), (current) =>
          current?.map((company) =>
            company.id === variables.id ? previousCompany : company
          )
        );
      }
      if (context?.previousOverview) {
        queryClient.setQueryData(
          queryKeys.companies.overview(variables.id),
          context.previousOverview
        );
      }
      toast.error(getApiErrorMessage(error, "Failed to update company"));
    },
    onSettled: (_data, _error, variables) => {
      setPendingToggleIds((current) => {
        const next = new Set(current);
        next.delete(variables.id);
        return next;
      });
    },
  });

  const deleteJobsMutation = useMutation({
    mutationFn: async (id: number) => {
      return deleteCompanyJobs(id);
    },
    onSuccess: (_result, id) => {
      void cacheOwnership.companyMutation(queryClient, {
        companyId: id,
        affectsJobRecords: true,
      });
      setDeleteJobsCompanyId(null);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete company jobs")),
  });

  const deleteCompanyMutation = deleteMutation.mutate;
  const toggleActiveCompanyMutation = toggleActiveMutation.mutate;
  const deleteCompanyById = useCallback(
    (companyId: number) => deleteCompanyMutation(companyId),
    [deleteCompanyMutation]
  );
  const openDeleteJobsDialog = useCallback(
    (companyId: number) => setDeleteJobsCompanyId(companyId),
    []
  );
  const toggleCompanyActive = useCallback(
    (companyId: number, isActive: boolean) => {
      toggleActiveCompanyMutation({ id: companyId, isActive });
    },
    [toggleActiveCompanyMutation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
        <Building2 className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium text-foreground">No companies yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Add companies to start tracking job openings
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => (
          <CompanyCard
            key={company.id}
            company={company}
            isSelected={selectedIdSet.has(company.id)}
            isTogglePending={pendingToggleIds.has(company.id)}
            selectionMode={selectionMode}
            onToggleSelection={onToggleSelection}
            onEditCompany={onEditCompany}
            onRefreshJobs={onRefreshJobs}
            onRefreshMatches={onRefreshMatches}
            onDeleteCompany={deleteCompanyById}
            onDeleteJobs={openDeleteJobsDialog}
            onToggleActive={toggleCompanyActive}
            isRefreshing={isRefreshing}
            isMatching={isMatching}
          />
        ))}
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
