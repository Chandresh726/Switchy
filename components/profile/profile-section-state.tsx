import type { ReactNode } from "react";

import { Loader2 } from "lucide-react";

import { ApiErrorState } from "@/components/ui/api-error-state";
import { Card, CardContent } from "@/components/ui/card";

interface ProfileSectionStateProps {
  profileId: number | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  missingMessage: string;
  errorMessage: string;
  children: ReactNode;
}

export const ProfileSectionState = ({
  profileId,
  isLoading,
  isError,
  error,
  onRetry,
  missingMessage,
  errorMessage,
  children,
}: ProfileSectionStateProps) => {
  if (profileId && !isLoading && !isError) return children;
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6">
        {!profileId ? (
          <p className="text-sm text-muted-foreground">{missingMessage}</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ApiErrorState
            error={error}
            fallbackMessage={errorMessage}
            onRetry={onRetry}
          />
        )}
      </CardContent>
    </Card>
  );
};
