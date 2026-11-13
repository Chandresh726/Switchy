import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface SessionDeleteDialogProps {
  kind: "match" | "scrape";
  onDelete: () => void;
  isDeleting: boolean;
}

export const SessionDeleteDialog = ({
  kind,
  onDelete,
  isDeleting,
}: SessionDeleteDialogProps) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Delete Session"
        className="text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {kind === "match" ? "Delete Match Session?" : "Delete Session?"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete this {kind} session and its logs. This
          action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onDelete}
          className="bg-red-500 hover:bg-red-600 text-foreground"
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
