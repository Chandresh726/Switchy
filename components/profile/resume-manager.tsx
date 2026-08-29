"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { ResumeData } from "@/lib/ai/resume/contracts";
import { downloadResume, uploadResume } from "@/lib/api/clients/profile";
import type { Resume } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cn } from "@/lib/utils";

interface ResumeManagerProps {
  resumes: Resume[];
  onParsed: (data: ResumeData, resume: Resume) => void;
  onDelete: (id: number) => Promise<void>;
  onRefresh: () => void;
}

export function ResumeManager({ resumes, onParsed, onDelete, onRefresh }: ResumeManagerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [autofill, setAutofill] = useState(true);
  const [isResumeManagerOpen, setIsResumeManagerOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const managedResumes = [...resumes].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.version - a.version;
  });
  const resumeCountLabel = `${resumes.length} ${resumes.length === 1 ? "resume" : "resumes"}`;

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSuccess(false);
      setFileName(file.name);
      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("autofill", String(autofill));

        const result = await uploadResume(formData);

        setSuccess(true);
        if (autofill && result.parsedData) {
          onParsed(result.parsedData, result.resumeRecord);
          if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            toast.warning(
              `Resume parsed with ${result.warnings.length} field warning${result.warnings.length === 1 ? "" : "s"}. Review the autofilled profile before saving.`
            );
          }
        } else {
          toast.success("Resume uploaded without autofill.");
        }
        onRefresh();
      } catch (err) {
        setError(getApiErrorMessage(err, "Failed to upload resume"));
      } finally {
        setIsUploading(false);
      }
    },
    [onParsed, autofill, onRefresh]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const reset = () => {
    setFileName(null);
    setError(null);
    setSuccess(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await onDelete(deleteConfirmId);
      toast.success("Resume deleted");
      onRefresh();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to delete resume"));
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDownload = async (id: number) => {
    try {
      await downloadResume(id);
    } catch (downloadError) {
      toast.error(getApiErrorMessage(downloadError, "Failed to download resume"));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <FileText className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <CardTitle className="text-lg font-medium text-foreground">Resume</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Upload your resume to auto-fill your profile
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Switch
                id="autofill-mode"
                checked={autofill}
                onCheckedChange={setAutofill}
                disabled={isUploading}
              />
              <Label htmlFor="autofill-mode" className="text-sm font-medium text-foreground/80">
                Autofill
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Upload Area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors
            ${isDragging ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-card"}
            ${isUploading ? "pointer-events-none opacity-50" : "cursor-pointer hover:border-border"}
          `}
        >
          <input
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md"
            onChange={handleFileInput}
            disabled={isUploading}
            className="absolute inset-0 cursor-pointer opacity-0"
          />

          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
              <p className="mt-2 text-sm text-muted-foreground">
                {autofill ? "Parsing resume..." : "Uploading resume..."}
              </p>
              <p className="text-xs text-muted-foreground">{fileName}</p>
            </>
          ) : success ? (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
                <Check className="h-5 w-5 text-emerald-500" />
              </div>
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Resume uploaded successfully!</p>
              <Button variant="ghost" size="sm" onClick={reset} className="mt-1">
                Upload different file
              </Button>
            </>
          ) : error ? (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button variant="ghost" size="sm" onClick={reset} className="mt-1">
                Try again
              </Button>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-foreground/80">Drop your resume here or click to browse</p>
              <p className="text-xs text-muted-foreground">Supports PDF, DOCX, and TXT files</p>
            </>
          )}
        </div>

        {managedResumes.length > 0 ? (
          <Collapsible
            open={isResumeManagerOpen}
            onOpenChange={setIsResumeManagerOpen}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start rounded-none px-3 py-3 aria-expanded:bg-transparent"
                aria-label={`Resume Manager, ${resumeCountLabel}`}
              >
                <span>Resume Manager</span>
                <Badge variant="secondary">{resumeCountLabel}</Badge>
                <ChevronDown
                  data-icon="inline-end"
                  className={cn(
                    "ml-auto transition-transform",
                    isResumeManagerOpen ? "rotate-180" : null
                  )}
                />
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <Separator />
              <div className="flex flex-col p-1">
                {managedResumes.map((resume) => (
                  <div
                    key={resume.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-md px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                      resume.isCurrent ? "bg-emerald-500/10" : null
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded bg-muted",
                          resume.isCurrent ? "text-emerald-500" : "text-muted-foreground"
                        )}
                      >
                        <FileText className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-foreground">
                            {resume.fileName}
                          </p>
                          {resume.isCurrent ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            >
                              Current
                            </Badge>
                          ) : null}
                          {resume.storageState !== "ready" ? (
                            <Badge variant="outline">
                              {resume.storageState === "missing"
                                ? "File missing"
                                : "Recovering"}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>v{resume.version}</span>
                          <span aria-hidden="true">•</span>
                          <span>{formatDate(resume.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {resume.storageState === "ready" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Download ${resume.fileName}`}
                          onClick={() => void handleDownload(resume.id)}
                        >
                          <Download data-icon="inline-start" />
                        </Button>
                      ) : null}
                      {!resume.isCurrent ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${resume.fileName}`}
                          onClick={() => setDeleteConfirmId(resume.id)}
                        >
                          <Trash2 data-icon="inline-start" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent showCloseButton>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Resume Version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this resume version. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDelete} className="w-full bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
