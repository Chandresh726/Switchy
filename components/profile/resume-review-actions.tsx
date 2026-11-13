import { Loader2, Save, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardAction, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ResumeReviewActionsProps {
  changes: { kind: "add" | "update" }[];
  unchangedCount?: number;
  isPending: boolean;
  onRevert: () => void;
  onApply: () => void;
  className: string;
}

export const ResumeReviewActions = ({
  changes,
  unchangedCount,
  isPending,
  onRevert,
  onApply,
  className,
}: ResumeReviewActionsProps) =>
  changes.length > 0 ? (
    <>
      <CardDescription>
        {changes.filter(({ kind }) => kind === "add").length} to add ·{" "}
        {changes.filter(({ kind }) => kind === "update").length} to update
        {unchangedCount ? ` · ${unchangedCount} already current` : ""}
      </CardDescription>
      <CardAction className="col-span-2 col-start-1 row-span-1 row-start-3 mt-2 flex w-full justify-end gap-2 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:w-auto">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRevert}
          disabled={isPending}
        >
          <Undo2 data-icon="inline-start" />
          Revert
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onApply}
          disabled={isPending}
          className={cn("min-w-[120px] text-foreground", className)}
        >
          {isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardAction>
    </>
  ) : null;
