"use client";

import { RefreshCw, Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CompanyActionsProps {
  isRefreshing: boolean;
  isMatching: boolean;
  onRefreshJobs: () => void;
  onRunMatching: () => void;
}

export function CompanyActions({
  isRefreshing,
  isMatching,
  onRefreshJobs,
  onRunMatching,
}: CompanyActionsProps) {
  const isLoading = isRefreshing || isMatching;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onRefreshJobs}
        disabled={isLoading}
      >
        {isRefreshing && !isMatching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Refresh Jobs
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRunMatching}
        disabled={isLoading}
      >
        {isMatching && !isRefreshing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        Run Matching
      </Button>
    </div>
  );
}
