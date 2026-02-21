"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  CircleOff,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";

import { cn } from "@/lib/utils";
import { connectionKeys } from "@/lib/query-keys";

interface TrackedCompany {
  id: number;
  name: string;
}

interface UnmatchedCompanyConnection {
  id: number;
  fullName: string;
  position: string | null;
  email: string | null;
  profileUrl: string;
  isStarred: boolean;
}

interface UnmatchedCompanyGroup {
  companyNormalized: string;
  companyLabel: string;
  connectionCount: number;
  isIgnored: boolean;
}

interface UnmatchedCompaniesResponse {
  summary: {
    unmatchedCompanyCount: number;
    unmatchedConnectionCount: number;
    ignoredCompanyCount: number;
  };
  groups: UnmatchedCompanyGroup[];
  totalCount: number;
  hasMore: boolean;
}

interface UnmatchedCompanyConnectionsResponse {
  connections: UnmatchedCompanyConnection[];
  totalCount: number;
  hasMore: boolean;
}

interface UnmatchedConnectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: TrackedCompany[];
}

type CompanyGroupMode = "unmatched" | "ignored";

interface CompanyComboboxProps {
  companies: TrackedCompany[];
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}

function CompanyCombobox({ companies, value, onChange, onOpenChange }: CompanyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCompanies = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return query
      ? companies.filter((c) => c.name.toLowerCase().includes(query))
      : companies;
  }, [companies, searchQuery]);

  const selectedCompany = companies.find((c) => String(c.id) === value);

  const handleOpen = () => {
    setOpen(true);
    onOpenChange?.(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleClose = () => {
    setOpen(false);
    setSearchQuery("");
    onOpenChange?.(false);
  };

  const handleSelect = (companyId: string) => {
    onChange(companyId);
    handleClose();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-52">
      {/* Search input */}
      <div
        className={cn(
          "flex h-8 cursor-text items-center gap-2 rounded-md border bg-background px-3 text-xs transition-colors",
          open ? "border-ring ring-1 ring-ring" : "border-border hover:border-muted-foreground/50"
        )}
        onClick={handleOpen}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {open ? (
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search Company"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        ) : (
          <span className={cn("truncate flex-1", !selectedCompany && "text-muted-foreground")}>
            {selectedCompany?.name ?? "Search Company"}
          </span>
        )}
        {selectedCompany && !open && (
          <button
            className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => { e.stopPropagation(); onChange(""); }}
            tabIndex={-1}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          {/* Item list — max 5 items visible */}
          <div className="max-h-[calc(2rem*5)] overflow-y-auto overscroll-contain">
            {filteredCompanies.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No companies found
              </div>
            ) : (
              filteredCompanies.map((company) => (
                <div
                  key={company.id}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-2 px-3 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
                    String(company.id) === value && "bg-accent text-accent-foreground"
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(String(company.id))}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      String(company.id) === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{company.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CompanyConnectionsListProps {
  companyNormalized: string;
  expanded: boolean;
}

function CompanyConnectionsList({ companyNormalized, expanded }: CompanyConnectionsListProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const { data, isLoading, isFetching, error } = useQuery<UnmatchedCompanyConnectionsResponse>({
    queryKey: connectionKeys.unmatchedCompanies.connections(companyNormalized, page, pageSize),
    queryFn: async () => {
      const params = new URLSearchParams({
        companyNormalized,
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      const res = await fetch(`/api/connections/unmatched-company-connections?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to load connections");
      }
      return res.json();
    },
    enabled: expanded,
    staleTime: 60000,
  });

  const totalCount = data?.totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (!expanded) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error instanceof Error ? error.message : "Failed to load connections"}
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections...
        </div>
      ) : data?.connections?.length ? (
        <div className="space-y-2">
          {data.connections.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-2.5 py-1.5"
            >
              {/* Left: name · separator · role */}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs">
                <span className="shrink-0 truncate font-medium text-foreground">{connection.fullName}</span>
                {connection.position && (
                  <>
                    <span className="shrink-0 text-muted-foreground/40">·</span>
                    <span className="truncate text-muted-foreground">{connection.position}</span>
                  </>
                )}
                {connection.isStarred && (
                  <span className="ml-1 shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                    Starred
                  </span>
                )}
              </div>
              {/* Right: LinkedIn profile link */}
              {connection.profileUrl && (
                <a
                  href={connection.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="View LinkedIn profile"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            isFetching={isFetching}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={[10, 25, 50]}
          />
        </div>
      ) : (
        <p className="py-2 text-xs text-muted-foreground">No connections found.</p>
      )}
    </div>
  );
}

export function UnmatchedConnectionsModal({
  open,
  onOpenChange,
  companies,
}: UnmatchedConnectionsModalProps) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mode, setMode] = useState<CompanyGroupMode>("unmatched");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});
  const [selectedMappings, setSelectedMappings] = useState<Record<string, string>>({});
  const [openComboboxKey, setOpenComboboxKey] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setCurrentPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const handleModeChange = (newMode: CompanyGroupMode) => {
    setMode(newMode);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const { data, isLoading, isFetching } = useQuery<UnmatchedCompaniesResponse>({
    queryKey: connectionKeys.unmatchedCompanies.list(mode, debouncedSearch, currentPage, pageSize),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String((currentPage - 1) * pageSize));
      if (debouncedSearch) params.set("search", debouncedSearch);

      const endpoint = mode === "ignored"
        ? "/api/connections/ignored-unmatched-companies"
        : "/api/connections/unmatched-companies";
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
    enabled: open,
  });

  const totalCount = data?.totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const mapMutation = useMutation({
    mutationFn: async (payload: { companyNormalized: string; mappedCompanyId: number }) => {
      const res = await fetch("/api/connections/unmatched-companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "map",
          companyNormalized: payload.companyNormalized,
          mappedCompanyId: payload.mappedCompanyId,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to map company");
      }
      return res.json() as Promise<{ updatedCount: number }>;
    },
    onSuccess: (result, variables) => {
      setExpandedCompanies((prev) => {
        const next = { ...prev };
        delete next[variables.companyNormalized];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: connectionKeys.unmatchedCompanies.all() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.ignoredCompanies() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      toast.success(`Mapped ${result.updatedCount} connection${result.updatedCount === 1 ? "" : "s"}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to map company");
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (payload: { companyNormalized: string; ignored: boolean }) => {
      const res = await fetch("/api/connections/unmatched-companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: payload.ignored ? "ignore" : "unignore",
          companyNormalized: payload.companyNormalized,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update ignore state");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.unmatchedCompanies.all() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.ignoredCompanies() });
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      toast.success("Updated company status");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update company status");
    },
  });

  const groups = useMemo(() => data?.groups || [], [data?.groups]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="!left-1/2 !top-1/2 !max-h-[90vh] !-translate-x-1/2 !-translate-y-1/2 max-w-[96vw] overflow-y-auto data-[size=default]:max-w-[96vw] data-[size=default]:sm:max-w-5xl">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-3 top-3"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-amber-400" />
            Review Unmapped LinkedIn Companies
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm">
            Map imported LinkedIn company names to tracked companies, or ignore those you do not want to manage.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={mode === "ignored" ? "Search ignored company..." : "Search unmatched company..."}
                className="pl-9"
              />
            </div>
            <div className="inline-flex items-center rounded-lg border border-border p-1">
              <Button
                variant={mode === "unmatched" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => handleModeChange("unmatched")}
              >
                Unmapped ({data?.summary.unmatchedCompanyCount || 0})
              </Button>
              <Button
                variant={mode === "ignored" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => handleModeChange("ignored")}
              >
                Ignored ({data?.summary.ignoredCompanyCount || 0})
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              {data?.summary.unmatchedCompanyCount || 0} unmatched companies
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              {data?.summary.unmatchedConnectionCount || 0} unmatched connections
            </span>
            <span className="rounded-full border border-border bg-muted px-2.5 py-1">
              {data?.summary.ignoredCompanyCount || 0} ignored
            </span>
          </div>

          <div
            ref={scrollContainerRef}
            className={cn(
              "max-h-[60vh] space-y-3 pr-1",
              openComboboxKey ? "overflow-y-hidden" : "overflow-y-auto"
            )}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {mode === "ignored"
                  ? "No ignored companies found for current filters."
                  : "No unmatched companies found for current filters."}
              </div>
            ) : (
              groups.map((group) => {
                const selectedMappedCompany = selectedMappings[group.companyNormalized] || "";
                const isExpanded = Boolean(expandedCompanies[group.companyNormalized]);

                return (
                  <div key={group.companyNormalized} className="rounded-lg border border-border bg-card/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{group.companyLabel}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          {group.connectionCount} connection{group.connectionCount === 1 ? "" : "s"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2" style={{ alignSelf: "center" }}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={isExpanded ? "Hide connections" : "View connections"}
                          onClick={() => {
                            setExpandedCompanies((prev) => ({
                              ...prev,
                              [group.companyNormalized]: !prev[group.companyNormalized],
                            }));
                          }}
                        >
                          <Users className={cn("h-4 w-4", isExpanded && "text-amber-400")} />
                        </Button>

                        <CompanyCombobox
                          companies={companies}
                          value={selectedMappedCompany}
                          onChange={(value) =>
                            setSelectedMappings((current) => ({
                              ...current,
                              [group.companyNormalized]: value,
                            }))
                          }
                          onOpenChange={(isOpen) =>
                            setOpenComboboxKey(isOpen ? group.companyNormalized : null)
                          }
                        />

                        <Button
                          size="sm"
                          disabled={!selectedMappedCompany || mapMutation.isPending}
                          onClick={() =>
                            mapMutation.mutate({
                              companyNormalized: group.companyNormalized,
                              mappedCompanyId: Number(selectedMappedCompany),
                            })
                          }
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Map
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          className={mode === "ignored" ? "" : "text-amber-300"}
                          disabled={ignoreMutation.isPending}
                          onClick={() =>
                            ignoreMutation.mutate({
                              companyNormalized: group.companyNormalized,
                              ignored: mode !== "ignored",
                            })
                          }
                        >
                          {mode === "ignored" ? (
                            <>
                              <CircleOff className="h-3.5 w-3.5" />
                              Unignore
                            </>
                          ) : (
                            <>
                              <Link2Off className="h-3.5 w-3.5" />
                              Ignore
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <CompanyConnectionsList
                      companyNormalized={group.companyNormalized}
                      expanded={isExpanded}
                    />
                  </div>
                );
              })
            )}
          </div>

          {totalCount > 0 ? (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              isFetching={isFetching}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[10, 25, 50]}
            />
          ) : null}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
