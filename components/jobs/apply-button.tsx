"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { ExternalLink, CheckCircle } from "lucide-react";

interface ApplyButtonProps {
  url: string;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
  onApply?: () => void;
}

export function ApplyButton({ url, size = "default", className, onApply }: ApplyButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = () => {
    window.open(url, "_blank", "noopener,noreferrer");
    setShowConfirm(true);
  };

  const handleConfirmApplied = () => {
    onApply?.();
    setShowConfirm(false);
  };

  return (
    <>
      <Button onClick={handleClick} size={size} className={className}>
        <ExternalLink className="h-4 w-4" />
        Apply
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Did you apply for this job?</AlertDialogTitle>
            <AlertDialogDescription>
              If you submitted your application, we&apos;ll mark this job as applied to help you track your progress.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmApplied}>
              <CheckCircle className="h-4 w-4" />
              Yes, I applied
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
