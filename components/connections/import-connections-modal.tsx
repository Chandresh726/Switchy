"use client";

import { useRef, useState } from "react";
import { FileUp, Link as LinkIcon, Upload } from "lucide-react";

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
import { cn } from "@/lib/utils";

interface ImportConnectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File) => Promise<void> | void;
  isUploading?: boolean;
}

export function ImportConnectionsModal({
  open,
  onOpenChange,
  onUpload,
  isUploading = false,
}: ImportConnectionsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const onFileSelect = (file: File | null) => {
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv");
    if (!isCsv) return;
    setSelectedFile(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    onFileSelect(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    try {
      await onUpload(selectedFile);
      setSelectedFile(null);
      onOpenChange(false);
    } catch {
      // keep modal open so user can retry after error toast on caller
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setDragOver(false);
      setSelectedFile(null);
    }
    onOpenChange(isOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="!left-1/2 !top-1/2 !max-h-[88vh] !-translate-x-1/2 !-translate-y-1/2 max-w-[96vw] overflow-y-auto data-[size=default]:max-w-[96vw] data-[size=default]:sm:max-w-3xl">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-base">Import LinkedIn Connections</AlertDialogTitle>
          <AlertDialogDescription className="text-sm">
            Upload your LinkedIn `Connections.csv` file to sync connections into your local database.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            className={cn(
              "rounded-lg border border-dashed border-border bg-card/40 p-5",
              dragOver && "border-emerald-500/70 bg-emerald-500/10"
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => onFileSelect(event.target.files?.[0] ?? null)}
            />
            <div className="flex h-full min-h-52 flex-col items-center justify-center gap-3 text-center">
              <FileUp className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Drag and drop Connections.csv</p>
                <p className="mt-1 text-xs text-muted-foreground">Accepted format: .csv</p>
              </div>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Choose File
              </Button>
              {selectedFile ? (
                <p className="text-xs text-emerald-400">{selectedFile.name}</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">How to get this file from LinkedIn</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
              <li>Sign in to your LinkedIn account.</li>
              <li>Open the LinkedIn data download page.</li>
              <li>Request your archive and wait for LinkedIn email confirmation.</li>
              <li>Download the archive and upload `Connections.csv` here.</li>
            </ol>
            <a
              className="mt-4 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
              href="https://www.linkedin.com/mypreferences/d/download-my-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Open LinkedIn download page
            </a>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isUploading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleUpload();
            }}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? "Adding..." : "Add LinkedIn Connections"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
