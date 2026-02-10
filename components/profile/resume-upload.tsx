"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, X, Check, AlertCircle } from "lucide-react";

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

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ResumeUploadProps {
  onParsed: (data: ResumeData, autofill: boolean) => void;
  disabled?: boolean;
}

export function ResumeUpload({ onParsed, disabled }: ResumeUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [autofill, setAutofill] = useState(true);

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
        // The API now returns { parsedData, resumeRecord }
        // We only care about parsedData here for the form filling
        const parsedData: ResumeData = result.parsedData || result;

        setSuccess(true);
        onParsed(parsedData, autofill);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse resume");
      } finally {
        setIsUploading(false);
      }
    },
    [onParsed, autofill]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
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
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const reset = () => {
    setFileName(null);
    setError(null);
    setSuccess(false);
  };

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors
          ${isDragging ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900/50"}
          ${isUploading ? "pointer-events-none opacity-50" : "cursor-pointer hover:border-zinc-600"}
          ${disabled ? "pointer-events-none opacity-50" : ""}
        `}
      >
        <input
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md"
          onChange={handleFileInput}
          disabled={disabled || isUploading}
          className="absolute inset-0 cursor-pointer opacity-0"
        />

        {isUploading ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
            <p className="mt-3 text-sm text-zinc-400">Parsing resume...</p>
            <p className="mt-1 text-xs text-zinc-500">{fileName}</p>
          </>
        ) : success ? (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="mt-3 text-sm text-emerald-400">Resume parsed successfully!</p>
            <p className="mt-1 text-xs text-zinc-500">{fileName}</p>
            <Button variant="ghost" size="sm" onClick={reset} className="mt-2">
              Upload different file
            </Button>
          </>
        ) : error ? (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <p className="mt-3 text-sm text-red-400">{error}</p>
            <Button variant="ghost" size="sm" onClick={reset} className="mt-2">
              Try again
            </Button>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-zinc-500" />
            <p className="mt-3 text-sm text-zinc-300">
              Drop your resume here or click to browse
            </p>
            <p className="mt-1 text-xs text-zinc-500">Supports PDF, DOCX, and TXT files</p>
          </>
        )}
      </div>

      <p className="text-center text-xs text-zinc-500">
        Your resume will be parsed by AI to auto-fill your profile. You can edit all fields before saving.
      </p>

      <div className="flex items-center justify-center space-x-2">
        <Switch
          id="autofill-mode"
          checked={autofill}
          onCheckedChange={setAutofill}
          disabled={isUploading || disabled}
        />
        <Label htmlFor="autofill-mode" className="text-sm font-medium text-zinc-300">
          Autofill profile with parsed data
        </Label>
      </div>
    </div>
  );
}
