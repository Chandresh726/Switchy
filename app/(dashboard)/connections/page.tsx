"use client";

import { useRef, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Linkedin,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { UnmatchedConnectionsModal } from "@/components/companies/unmatched-connections-modal";
import { ImportConnectionsModal } from "@/components/connections/import-connections-modal";
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
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TogglePill } from "@/components/ui/toggle-pill";
import { canOpenLinkedInProfile } from "@/lib/connections/message";
import type {
  ConnectionQueryResponse,
  ImportSession,
  ImportSummary,
} from "@/lib/connections/types";
import { companyKeys, connectionKeys } from "@/lib/query-keys";
import { formatDateTime } from "@/lib/utils/format";

type MappingScope = "mapped" | "all" | "unmapped";
type ActivityScope = "active" | "inactive" | "all";

interface Company {
  id: number;
  name: string;
}

interface EmailCellProps {
  connectionId: number;
  email: string | null;
  onSave: (id: number, email: string | null) => void;
  onCopy: (email: string) => void;
}

interface RefreshMappingsResponse {
  mappedConnectionCount: number;
  mappedCompanyCount: number;
}

function EmailCell({ connectionId, email, onSave, onCopy }: EmailCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email || "");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(email || "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancel = () => {
    setDraft(email || "");
    setEditing(false);
  };

  const save = () => {
    const next = draft.trim() || null;
    onSave(connectionId, next);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <div className="flex w-56 items-center rounded-md border border-ring bg-background">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter email"
          className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 items-center border-l border-border">
          <button onClick={save} title="Save" className="flex h-7 w-7 items-center justify-center text-emerald-400 transition-colors hover:bg-accent hover:text-emerald-300">
            <Save className="h-3.5 w-3.5" />
          </button>
          <button onClick={cancel} title="Cancel" className="flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-56 items-center rounded-md border border-border bg-background/50">
      <span className={`min-w-0 flex-1 truncate px-2.5 py-1.5 text-xs ${email ? "text-foreground" : "text-muted-foreground/40"}`}>
        {email || "N/A"}
      </span>
      <div className="flex shrink-0 items-center border-l border-border opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={startEdit} title="Edit email" className="flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        {email && (
          <button onClick={() => onCopy(email)} title="Copy email" className="flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [mappingScope, setMappingScope] = useState<MappingScope>("mapped");
  const [activityScope, setActivityScope] = useState<ActivityScope>("active");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [isUnmatchedModalOpen, setIsUnmatchedModalOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: companyKeys.list(),
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  const { data: sessions = [] } = useQuery<ImportSession[]>({
    queryKey: connectionKeys.importSessions(),
    queryFn: async () => {
      const res = await fetch("/api/connections/import-sessions?limit=5");
      if (!res.ok) throw new Error("Failed to fetch import sessions");
      return res.json();
    },
  });

  const connectionsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (companyId) params.set("companyId", companyId);
    if (showStarredOnly) params.set("starred", "true");

    if (activityScope === "all") {
      params.set("active", "all");
    } else if (activityScope === "active") {
      params.set("active", "true");
    } else {
      params.set("active", "false");
    }

    if (mappingScope === "mapped") {
      params.set("unmatched", "false");
    } else if (mappingScope === "unmapped") {
      params.set("unmatched", "true");
    }

    params.set("limit", pageSize.toString());
    params.set("offset", ((currentPage - 1) * pageSize).toString());
    params.set("sortBy", "lastSeenAt");
    params.set("sortOrder", "desc");
    return `/api/connections?${params.toString()}`;
  }, [activityScope, companyId, currentPage, mappingScope, pageSize, search, showStarredOnly]);

  const { data, isLoading, isFetching } = useQuery<ConnectionQueryResponse>({
    queryKey: connectionKeys.listWithParams({
      search,
      companyId,
      showStarredOnly,
      mappingScope,
      activityScope,
      pageSize,
      currentPage,
    }),
    queryFn: async () => {
      const res = await fetch(connectionsUrl);
      if (!res.ok) throw new Error("Failed to fetch connections");
      return res.json();
    },
  });

  const { data: totalConnectionsData } = useQuery<ConnectionQueryResponse>({
    queryKey: connectionKeys.totalCount(),
    queryFn: async () => {
      const res = await fetch("/api/connections?active=all&limit=1");
      if (!res.ok) throw new Error("Failed to fetch connections count");
      return res.json();
    },
  });

  const totalConnectionCount = totalConnectionsData?.totalCount || 0;

  const { data: unmatchedSummary } = useQuery<{
    summary: {
      unmatchedCompanyCount: number;
      unmatchedConnectionCount: number;
      ignoredCompanyCount: number;
    };
  }>({
    queryKey: connectionKeys.unmatchedCompanies.summary(),
    queryFn: async () => {
      const res = await fetch("/api/connections/unmatched-companies?summaryOnly=true");
      if (!res.ok) {
        throw new Error("Failed to fetch unmatched companies summary");
      }
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/connections/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to import CSV");
      }
      return (await res.json()) as ImportSummary;
    },
    onSuccess: (result) => {
      setLastSummary(result);
      setCurrentPage(1);
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: connectionKeys.importSessions() });
      queryClient.invalidateQueries({ queryKey: companyKeys.all });
      queryClient.invalidateQueries({ queryKey: connectionKeys.unmatchedCompanies.all() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.ignoredCompanies() });
      toast.success("Connections synced successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to import connections");
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (payload: { id: number; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/connections/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.body),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update connection");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update connection");
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connections", {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete connections");
      }
      return (await res.json()) as { deletedCount: number };
    },
    onSuccess: (result) => {
      setIsDeleteAllDialogOpen(false);
      setLastSummary(null);
      setCurrentPage(1);
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: connectionKeys.importSessions() });
      queryClient.invalidateQueries({ queryKey: companyKeys.all });
      queryClient.invalidateQueries({ queryKey: connectionKeys.unmatchedCompanies.all() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.ignoredCompanies() });
      toast.success(
        result.deletedCount > 0
          ? `Deleted ${result.deletedCount} connections`
          : "No connections to delete"
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete connections");
    },
  });

  const refreshMappingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/connections/unmatched-companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to refresh mappings");
      }

      return (await res.json()) as RefreshMappingsResponse;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.unmatchedCompanies.all() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.ignoredCompanies() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: companyKeys.all });

      if (result.mappedConnectionCount > 0) {
        toast.success(
          `Mapped ${result.mappedConnectionCount} connection${result.mappedConnectionCount === 1 ? "" : "s"} across ${result.mappedCompanyCount} compan${result.mappedCompanyCount === 1 ? "y" : "ies"}`
        );
        return;
      }

      toast.success("No new mappings found");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to refresh mappings");
    },
  });

  const connections = data?.connections || [];
  const totalCount = data?.totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Connections</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your LinkedIn network and keep outreach-ready contacts clean.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Last sync: {sessions[0]?.startedAt ? formatDateTime(new Date(sessions[0].startedAt)) : "Never"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {totalConnectionCount > 0 ? (
            <Button
              variant="outline"
              className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setIsDeleteAllDialogOpen(true)}
              disabled={deleteAllMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete All Connections
            </Button>
          ) : null}
          <Button onClick={() => setIsImportModalOpen(true)} disabled={importMutation.isPending}>
            {importMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Add LinkedIn Connections
          </Button>
        </div>
      </div>

      {lastSummary ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          Synced {lastSummary.totalRows} rows: {lastSummary.insertedRows} inserted, {lastSummary.updatedRows} updated,{" "}
          {lastSummary.deactivatedRows} deactivated, {lastSummary.invalidRows} invalid, {lastSummary.unmatchedCompanyRows} unmatched.
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-border bg-card/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[300px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, company, position, email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>

          <Select
            value={companyId || "all"}
            onValueChange={(value) => {
              setCompanyId(value === "all" ? "" : value);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 px-3 text-xs">
              <SelectValue placeholder="All tracked companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tracked companies</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TogglePill
            selected={mappingScope === "mapped"}
            onClick={() => {
              setMappingScope("mapped");
              setCurrentPage(1);
            }}
          >
            Mapped
          </TogglePill>
          <TogglePill
            selected={mappingScope === "all"}
            onClick={() => {
              setMappingScope("all");
              setCurrentPage(1);
            }}
          >
            All
          </TogglePill>
          <TogglePill
            selected={mappingScope === "unmapped"}
            onClick={() => {
              setMappingScope("unmapped");
              setCurrentPage(1);
            }}
          >
            Unmapped
          </TogglePill>

          <div className="h-5 w-px bg-border" />

          <TogglePill
            selected={activityScope === "active"}
            onClick={() => {
              setActivityScope("active");
              setCurrentPage(1);
            }}
          >
            Active
          </TogglePill>
          <TogglePill
            selected={activityScope === "inactive"}
            onClick={() => {
              setActivityScope("inactive");
              setCurrentPage(1);
            }}
          >
            Inactive
          </TogglePill>
          <TogglePill
            selected={activityScope === "all"}
            onClick={() => {
              setActivityScope("all");
              setCurrentPage(1);
            }}
          >
            All Status
          </TogglePill>

          <div className="h-5 w-px bg-border" />

          <TogglePill
            selected={showStarredOnly}
            onClick={() => {
              setShowStarredOnly((value) => !value);
              setCurrentPage(1);
            }}
          >
            Starred
          </TogglePill>

          {(search ||
            companyId ||
            showStarredOnly ||
            mappingScope !== "mapped" ||
            activityScope !== "active") ? (
            <button
              onClick={() => {
                setSearch("");
                setCompanyId("");
                setShowStarredOnly(false);
                setMappingScope("mapped");
                setActivityScope("active");
                setCurrentPage(1);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {(unmatchedSummary?.summary.unmatchedCompanyCount || 0) > 0 ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => refreshMappingsMutation.mutate()}
                  disabled={refreshMappingsMutation.isPending}
                >
                  {refreshMappingsMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh Mapping
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  onClick={() => setIsUnmatchedModalOpen(true)}
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  {unmatchedSummary?.summary.unmatchedCompanyCount || 0} Unmapped Companies
                </Button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All Mapped
              </span>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No connections found"
          description="Import LinkedIn connections or adjust filters to view results."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Actions</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((item) => {
                  const companyName = item.company?.name || item.companyRaw || "N/A";
                  const isMapped = Boolean(item.mappedCompanyId);
                  return (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-yellow-300"
                            onClick={() =>
                              patchMutation.mutate({ id: item.id, body: { isStarred: !item.isStarred } })
                            }
                            title={item.isStarred ? "Unstar connection" : "Star connection"}
                          >
                            <Star
                              className={`h-4 w-4 ${item.isStarred ? "fill-yellow-300 text-yellow-300" : ""}`}
                            />
                          </button>
                          <span>{item.fullName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{companyName}</td>
                      <td className="px-3 py-2">{item.position || "N/A"}</td>
                      <td className="px-3 py-2">
                        <EmailCell
                          connectionId={item.id}
                          email={item.email}
                          onSave={(id, nextEmail) =>
                            patchMutation.mutate({ id, body: { email: nextEmail } })
                          }
                          onCopy={(e) => copyToClipboard(e, "Email copied")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!canOpenLinkedInProfile(item.profileUrl)}
                          onClick={() => window.open(item.profileUrl, "_blank", "noopener,noreferrer")}
                          title={
                            canOpenLinkedInProfile(item.profileUrl)
                              ? "Open LinkedIn profile"
                              : "Invalid LinkedIn URL"
                          }
                        >
                          <Linkedin className="h-3.5 w-3.5" />
                          Profile
                        </Button>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs ${isMapped
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            }`}
                        >
                          {isMapped ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5" />
                          )}
                          {isMapped ? "Mapped" : "Unmapped"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalCount > 0 ? (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              isFetching={isFetching}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              pageSizeOptions={[10, 25, 50]}
            />
          ) : null}
        </>
      )}

      <ImportConnectionsModal
        open={isImportModalOpen}
        onOpenChange={setIsImportModalOpen}
        isUploading={importMutation.isPending}
        onUpload={async (file) => {
          await importMutation.mutateAsync(file);
        }}
      />

      <AlertDialog open={isDeleteAllDialogOpen} onOpenChange={setIsDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Connections</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all imported LinkedIn connections? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteAllMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteAllMutation.mutate();
              }}
            >
              {deleteAllMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete All Connections"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnmatchedConnectionsModal
        open={isUnmatchedModalOpen}
        onOpenChange={setIsUnmatchedModalOpen}
        companies={companies}
      />
    </div>
  );
}
