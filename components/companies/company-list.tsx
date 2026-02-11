"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CompanyForm } from "./company-form";
import {
  Building2,
  ExternalLink,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Sparkles,
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
import { useState } from "react";

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

const PLATFORM_COLORS: Record<string, string> = {
  greenhouse: "bg-green-500/10 text-green-400 border-green-500/20",
  lever: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  ashby: "bg-purple-500/10 text-purple-400 border-purple-500/20",
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
      onClick={() => onChange(!checked)}
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

export function CompanyList() {
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

  return (
    <div className="space-y-4">
      {/* Edit Form */}
      {editingCompany && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <CompanyForm
            company={editingCompany}
            onSuccess={() => setEditingCompany(null)}
            onCancel={() => setEditingCompany(null)}
          />
        </div>
      )}

      {/* Company Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => (
          <div
            key={company.id}
            className={`group rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700 ${
              !company.isActive ? "opacity-60 grayscale" : ""
            }`}
          >
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
                  <h3 className="font-medium text-white">{company.name}</h3>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => refreshMutation.mutate(company.id)}
                    disabled={refreshMutation.isPending}
                    className="cursor-pointer"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    <span className="truncate">Refresh Jobs</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => matchJobsMutation.mutate(company.id)}
                    disabled={matchJobsMutation.isPending}
                    className="text-purple-400 focus:text-purple-400 cursor-pointer"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span className="truncate">Refresh Matching</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteJobsCompanyId(company.id)}
                    className="text-orange-400 focus:text-orange-400 cursor-pointer"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span className="truncate">Delete All Jobs</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setEditingCompany(company)}
                    className="cursor-pointer"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    <span className="truncate">Edit</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => deleteMutation.mutate(company.id)}
                    className="text-red-400 focus:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span className="truncate">Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        ))}
      </div>

      {/* Delete Jobs Confirmation Dialog */}
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
