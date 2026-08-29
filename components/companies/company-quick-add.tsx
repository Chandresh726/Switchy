"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCompanies } from "@/lib/api/clients/companies";
import { companyImportBodySchema } from "@/lib/api/contracts/companies";
import {
  getAddablePresetCompanies,
  searchPresetCompanies,
  type PresetCompany,
} from "@/lib/companies/preset-companies";
import { formatCompanyUrl } from "@/lib/companies/display";
import { normalizeCareersUrl } from "@/lib/companies/normalization";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { usePresetCompanies } from "@/lib/hooks/use-preset-companies";
import { cacheOwnership } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface ExistingCompany {
  name: string;
  careersUrl: string;
}

interface CompanyQuickAddProps {
  existingCompanies: ExistingCompany[];
}

function extractAddedCareersUrls(data: unknown): string[] {
  const items = Array.isArray(data) ? data : [data];
  const careersUrls: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { careersUrl } = item as { careersUrl?: unknown };
    if (typeof careersUrl === "string") {
      careersUrls.push(careersUrl);
    }
  }

  return careersUrls;
}

function toPayload(company: PresetCompany): Record<string, unknown> {
  return {
    name: company.name,
    careersUrl: company.careersUrl,
    logoUrl: company.logoUrl,
    platform: company.platform,
    boardToken: company.boardToken,
  };
}

export function CompanyQuickAdd({ existingCompanies }: CompanyQuickAddProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [locallyHiddenUrls, setLocallyHiddenUrls] = useState<string[]>([]);
  const [pendingSingleAddUrl, setPendingSingleAddUrl] = useState<string | null>(
    null
  );
  const debouncedSearch = useDebounce(searchQuery, 180);

  const presetCompaniesQuery = usePresetCompanies();

  const addMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      return createCompanies(companyImportBodySchema.parse(payload));
    },
  });

  const addableCompanies = useMemo(() => {
    return getAddablePresetCompanies(
      presetCompaniesQuery.data ?? [],
      existingCompanies,
      locallyHiddenUrls
    );
  }, [presetCompaniesQuery.data, existingCompanies, locallyHiddenUrls]);

  const filteredCompanies = useMemo(() => {
    return searchPresetCompanies(addableCompanies, debouncedSearch);
  }, [addableCompanies, debouncedSearch]);

  const addableCompanyByUrl = useMemo(() => {
    const map = new Map<string, PresetCompany>();
    for (const company of addableCompanies) {
      map.set(normalizeCareersUrl(company.careersUrl), company);
    }
    return map;
  }, [addableCompanies]);

  const selectedCompanies = useMemo(() => {
    return selectedUrls
      .map((url) => addableCompanyByUrl.get(url))
      .filter((company): company is PresetCompany => Boolean(company));
  }, [selectedUrls, addableCompanyByUrl]);

  const visibleUrlSet = useMemo(() => {
    return new Set(filteredCompanies.map((company) => normalizeCareersUrl(company.careersUrl)));
  }, [filteredCompanies]);

  const selectedVisibleCount = useMemo(() => {
    return selectedUrls.filter((url) => visibleUrlSet.has(url)).length;
  }, [selectedUrls, visibleUrlSet]);

  const markAdded = (careersUrls: string[]) => {
    if (careersUrls.length === 0) return;

    const normalizedUrls = careersUrls
      .map((url) => normalizeCareersUrl(url))
      .filter((url) => url.length > 0);

    if (normalizedUrls.length === 0) return;

    const normalizedSet = new Set(normalizedUrls);

    setLocallyHiddenUrls((previous) => {
      const next = new Set(previous);
      for (const url of normalizedSet) {
        next.add(url);
      }
      return Array.from(next);
    });

    setSelectedUrls((previous) =>
      previous.filter((url) => !normalizedSet.has(url))
    );

    void cacheOwnership.companyMutation(queryClient, { affectsMappings: true });
  };

  const handleSingleAdd = async (company: PresetCompany) => {
    const normalizedUrl = normalizeCareersUrl(company.careersUrl);
    setPendingSingleAddUrl(normalizedUrl);

    try {
      const result = await addMutation.mutateAsync(toPayload(company));
      const addedUrls = extractAddedCareersUrls(result);
      if (addedUrls.length === 0) {
        toast.error("Company was not added");
        return;
      }

      markAdded(addedUrls);
      toast.success(`Added ${company.name}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to add company"));
    } finally {
      setPendingSingleAddUrl(null);
    }
  };

  const handleAddSelected = async () => {
    if (selectedCompanies.length === 0) {
      toast.error("Select at least one company");
      return;
    }

    try {
      const payload = selectedCompanies.map((company) => toPayload(company));
      const result = await addMutation.mutateAsync(payload);
      const addedUrls = extractAddedCareersUrls(result);
      markAdded(addedUrls);

      const addedCount = addedUrls.length;
      const attemptedCount = selectedCompanies.length;
      const failedCount = attemptedCount - addedCount;

      if (addedCount > 0) {
        toast.success(`Added ${addedCount} compan${addedCount === 1 ? "y" : "ies"}`);
      }

      if (failedCount > 0) {
        toast.error(
          `${failedCount} compan${failedCount === 1 ? "y was" : "ies were"} not added. You can retry the remaining selection.`
        );
      }

      if (addedCount === 0 && failedCount === 0) {
        toast.error("No companies were added");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to add selected companies"));
    }
  };

  const handleToggleSelection = (normalizedUrl: string) => {
    setSelectedUrls((previous) =>
      previous.includes(normalizedUrl)
        ? previous.filter((value) => value !== normalizedUrl)
        : [...previous, normalizedUrl]
    );
  };

  const handleSelectAllVisible = () => {
    const visibleUrls = filteredCompanies.map((company) =>
      normalizeCareersUrl(company.careersUrl)
    );
    setSelectedUrls((previous) =>
      Array.from(new Set([...previous, ...visibleUrls]))
    );
  };

  const handleClearVisibleSelection = () => {
    setSelectedUrls((previous) =>
      previous.filter((url) => !visibleUrlSet.has(url))
    );
  };

  if (presetCompaniesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (presetCompaniesQuery.isError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <div className="flex items-start gap-2 text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Failed to load `/companies.json`
            </p>
            <p className="text-xs text-red-300/90">
              {getApiErrorMessage(
                presetCompaniesQuery.error,
                "Could not parse preset companies."
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => presetCompaniesQuery.refetch()}
              className="h-7 border-red-400/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (addableCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        <p className="mt-3 text-sm font-medium text-foreground">
          All preset companies are already added
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use the Custom Company tab to add a company that is not in the preset list.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search preset companies by name or URL..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectAllVisible}
            disabled={filteredCompanies.length === 0 || addMutation.isPending}
          >
            Select All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearVisibleSelection}
            disabled={selectedVisibleCount === 0 || addMutation.isPending}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleAddSelected}
            disabled={selectedCompanies.length === 0 || addMutation.isPending}
          >
            {addMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add Selected ({selectedCompanies.length})
          </Button>
        </div>
      </div>

      {filteredCompanies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            No companies match your search
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different name, platform, or URL term.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSearchQuery("")}
            className="mt-3"
          >
            Clear Search
          </Button>
        </div>
      ) : (
        <div className="max-h-[20rem] space-y-2 overflow-y-auto pr-1">
          {filteredCompanies.map((company) => {
            const normalizedUrl = normalizeCareersUrl(company.careersUrl);
            const isSelected = selectedUrls.includes(normalizedUrl);
            const isAddingThisRow =
              addMutation.isPending && pendingSingleAddUrl === normalizedUrl;

            return (
              <div
                key={normalizedUrl}
                role="button"
                tabIndex={0}
                onClick={() => handleToggleSelection(normalizedUrl)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleToggleSelection(normalizedUrl);
                  }
                }}
                className={`rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : "border-border bg-card/70 hover:border-emerald-500/30"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {company.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={company.logoUrl}
                        alt={company.name}
                        className="size-10 rounded bg-muted object-contain p-1"
                      />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded bg-muted text-sm font-medium text-muted-foreground">
                        {company.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {company.name}
                      </p>
                      <a
                        href={company.careersUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="mt-1 flex w-fit max-w-full items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        <span className="truncate">
                          {formatCompanyUrl(company.careersUrl)}
                        </span>
                      </a>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSingleAdd(company);
                    }}
                    disabled={addMutation.isPending}
                  >
                    {isAddingThisRow ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
