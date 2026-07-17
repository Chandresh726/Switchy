"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getApiErrorPresentation } from "@/lib/api/error-presentation";

interface ApiErrorStateProps {
  error: unknown;
  fallbackMessage?: string;
  onRetry?: () => void;
  title?: string;
}

export function ApiErrorState({
  error,
  fallbackMessage = "The data could not be loaded.",
  onRetry,
  title,
}: ApiErrorStateProps) {
  const presentation = getApiErrorPresentation(error, fallbackMessage);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-red-500/30 bg-red-500/5 px-4 py-8 text-center"
    >
      <AlertCircle className="h-8 w-8 text-red-400" />
      <h3 className="mt-3 text-sm font-medium text-foreground">
        {title ?? presentation.title}
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {presentation.description}
      </p>
      {presentation.requestId ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Request ID: {presentation.requestId}
        </p>
      ) : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
