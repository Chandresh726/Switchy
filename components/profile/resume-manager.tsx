"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload, Loader2, Check, AlertCircle, FileText, ChevronDown, ChevronUp, Download, Trash2, History } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
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

interface ResumeData {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  summary?: string;
  skills: Array<{
    name: string;
    category?: string;
    proficiency?: number;
  }>;
  experience: Array<{
    company: string;
    title: string;
    location?: string;
    startDate: string;
    endDate?: string;
    description?: string;
    highlights?: string[];
  }>;
  education?: Array<{
    institution: string;
    degree: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
    honors?: string;
  }>;
}

interface Resume {
  id: number;
  fileName: string;
  version: number;
  createdAt: string;
  isCurrent: boolean;
}

interface ResumeManagerProps {
  resumes: Resume[];
  onParsed: (data: ResumeData, autofill: boolean) => void;
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
  const [showHistory, setShowHistory] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const currentResume = resumes.find((r) => r.isCurrent);
  const previousResumes = resumes.filter((r) => !r.isCurrent).sort((a, b) => b.version - a.version);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSuccess(false);
      setFileName(file.name);
      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/profile/parse-resume", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to parse resume");
        }

        const result = await response.json();
        const parsedData: ResumeData = result.parsedData || result;

        setSuccess(true);
        onParsed(parsedData, autofill);
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse resume");
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
    } catch {
      toast.error("Failed to delete resume");
    } finally {
      setDeleteConfirmId(null);
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
          {currentResume && (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              v{currentResume.version} Current
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
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
              <p className="mt-2 text-sm text-muted-foreground">Parsing resume...</p>
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

        {/* Autofill Toggle */}
        <div className="flex items-center justify-center space-x-2">
          <Switch
            id="autofill-mode"
            checked={autofill}
            onCheckedChange={setAutofill}
            disabled={isUploading}
          />
          <Label htmlFor="autofill-mode" className="text-sm font-medium text-foreground/80">
            Autofill profile with parsed data
          </Label>
        </div>

        {/* Current Resume */}
        {currentResume && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-emerald-500/20">
                  <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">{currentResume.fileName}</p>
                  <p className="text-xs text-emerald-600/80 dark:text-emerald-400/90">{formatDate(currentResume.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" className="h-8 w-8" asChild>
                  <a href={`/api/profile/resumes/${currentResume.id}/download`} download>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Previous Versions */}
        {previousResumes.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card p-3 text-sm font-medium text-foreground hover:bg-muted/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <span>Previous Versions ({previousResumes.length})</span>
              </div>
              {showHistory ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showHistory && (
              <div className="mt-2 space-y-2">
                {previousResumes.map((resume) => (
                  <div
                    key={resume.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{resume.fileName}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">v{resume.version}</span>
                          <span className="text-xs text-muted-foreground">•</span>
                          <span className="text-xs text-muted-foreground">{formatDate(resume.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" className="h-8 w-8" asChild>
                        <a href={`/api/profile/resumes/${resume.id}/download`} download>
                          <Download className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-8 w-8"
                        onClick={() => setDeleteConfirmId(resume.id)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Resume Version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this resume version. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
