import { History } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

export function LegacyMatchAlert() {
  return (
    <Alert>
      <History className="size-4" />
      <AlertTitle>Legacy match score</AlertTitle>
      <AlertDescription>
        This score came from Switchy&apos;s previous matching engine. It remains a valid
        match score; rematch this job to refresh it with the current engine.
      </AlertDescription>
    </Alert>
  );
}
