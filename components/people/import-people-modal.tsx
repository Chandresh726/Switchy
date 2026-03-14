"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileUp,
  Globe,
  Linkedin,
  Link as LinkIcon,
  Loader2,
  Upload,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ImportMode, ImportSummary, PeopleImportPreviewResponse } from "@/lib/people/types";
import { cn } from "@/lib/utils";

type ImportSource = "linkedin" | "apollo" | "manual";

interface ImportPeopleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (summary: ImportSummary) => void;
  onCreatedManual: () => void;
}

const APOLLO_FIELDS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "linkedinUrl",
  "company",
  "position",
  "notes",
] as const;

type ApolloField = typeof APOLLO_FIELDS[number];
type ApolloMapping = Partial<Record<ApolloField, string | null>>;

const FIELD_LABELS: Record<ApolloField, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  fullName: "Full Name",
  email: "Email",
  linkedinUrl: "LinkedIn URL",
  company: "Company",
  position: "Position",
  notes: "Notes",
};

const SOURCE_OPTIONS: Array<{
  value: ImportSource;
  label: string;
  hint: string;
  icon: typeof Linkedin;
}> = [
  { value: "linkedin", label: "LinkedIn", hint: "Connections.csv", icon: Linkedin },
  { value: "apollo", label: "Apollo", hint: "CSV export", icon: Globe },
  { value: "manual", label: "Manual", hint: "Add one person", icon: UserRoundPlus },
];

function CsvPicker({
  file,
  onFileSelected,
}: {
  file: File | null;
  onFileSelected: (file: File | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onFileSelect = (nextFile: File | null) => {
    if (!nextFile) return;
    const isCsv = nextFile.name.toLowerCase().endsWith(".csv") || nextFile.type.includes("csv");
    if (!isCsv) {
      toast.error("Please select a CSV file");
      return;
    }
    onFileSelected(nextFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    onFileSelect(droppedFile);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 border border-emerald-500/30 bg-emerald-500/5 p-3">
        <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {(file.size / 1024).toFixed(1)} KB
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onFileSelected(null)}
          title="Remove file"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "border border-dashed border-border bg-card/40 p-5",
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
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-center">
        <FileUp className="h-8 w-8 text-muted-foreground/60" />
        <div>
          <p className="text-sm font-medium text-foreground">Drop your CSV here</p>
          <p className="mt-0.5 text-xs text-muted-foreground">or click to browse</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
          Choose File
        </Button>
      </div>
    </div>
  );
}

function SourceGuide({ source }: { source: Exclude<ImportSource, "manual"> }) {
  const [expanded, setExpanded] = useState(false);

  const title = source === "apollo" ? "How to export from Apollo" : "How to get LinkedIn CSV";

  return (
    <div className="border border-border bg-card/30">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {source === "apollo" ? (
            <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
              <li>Export contacts from Apollo as CSV.</li>
              <li>Upload the file — columns will be auto-detected.</li>
              <li>Keep at least Email or LinkedIn URL mapped.</li>
            </ol>
          ) : (
            <>
              <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
                <li>Open LinkedIn data download settings.</li>
                <li>Request your archive and wait for the email.</li>
                <li>Download and upload <code className="text-foreground/70">Connections.csv</code>.</li>
              </ol>
              <a
                className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                href="https://www.linkedin.com/mypreferences/d/download-my-data"
                target="_blank"
                rel="noopener noreferrer"
              >
                <LinkIcon className="h-3 w-3" />
                Open LinkedIn download page
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ImportPeopleModal({
  open,
  onOpenChange,
  onImported,
  onCreatedManual,
}: ImportPeopleModalProps) {
  const [source, setSource] = useState<ImportSource>("linkedin");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PeopleImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ApolloMapping>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [manualForm, setManualForm] = useState({
    fullName: "",
    email: "",
    profileUrl: "",
    companyRaw: "",
    position: "",
    notes: "",
  });

  const canSubmitImport = source !== "manual" && !!file && (source === "linkedin" || !!preview);
  const headers = preview?.detectedHeaders || [];
  const canCreateManual = useMemo(() => manualForm.fullName.trim().length > 0, [manualForm.fullName]);

  const resetState = () => {
    setSource("linkedin");
    setImportMode("merge");
    setFile(null);
    setPreview(null);
    setMapping({});
    setIsSubmitting(false);
    setIsPreviewing(false);
    setManualForm({
      fullName: "",
      email: "",
      profileUrl: "",
      companyRaw: "",
      position: "",
      notes: "",
    });
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  };

  const handleSourceChange = (nextSource: ImportSource) => {
    setSource(nextSource);
    setFile(null);
    setPreview(null);
    setMapping({});
  };

  const runPreview = async (targetFile?: File) => {
    const fileToPreview = targetFile || file;
    if (!fileToPreview || source !== "apollo") return;
    setIsPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("source", source);
      formData.append("file", fileToPreview);
      const res = await fetch("/api/people/import/preview", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to preview CSV");
      }

      const data = (await res.json()) as PeopleImportPreviewResponse;
      setPreview(data);
      setMapping((data.suggestedMapping || {}) as ApolloMapping);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to preview CSV");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleFileSelected = (nextFile: File | null) => {
    setFile(nextFile);
    setPreview(null);
    setMapping({});
    if (nextFile && source === "apollo") {
      void runPreview(nextFile);
    }
  };

  // Auto-preview when switching to apollo with an existing file
  useEffect(() => {
    if (source === "apollo" && file && !preview && !isPreviewing) {
      void runPreview(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const submitImport = async () => {
    if (!file || source === "manual") return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("source", source);
      formData.append("file", file);
      formData.append("importMode", importMode);
      if (source === "apollo") {
        formData.append("mapping", JSON.stringify(mapping));
      }

      const res = await fetch("/api/people/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to import");
      }

      const summary = (await res.json()) as ImportSummary;
      onImported(summary);
      toast.success("People imported successfully");
      handleClose(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import people");
    } finally {
      setIsSubmitting(false);
    }
  };

  const createManual = async () => {
    if (!canCreateManual) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: manualForm.fullName,
          email: manualForm.email || undefined,
          profileUrl: manualForm.profileUrl || undefined,
          companyRaw: manualForm.companyRaw || undefined,
          position: manualForm.position || undefined,
          notes: manualForm.notes || undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create person");
      }

      onCreatedManual();
      toast.success("Person added");
      handleClose(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add person");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-h-[88vh] max-w-[96vw] overflow-y-auto sm:max-w-2xl data-[size=default]:max-w-[96vw] data-[size=default]:sm:max-w-2xl">
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          onClick={() => handleClose(false)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>

        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Add People
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            Import from CSV or add a person manually.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {/* Source tabs */}
          <div className="flex gap-1 border-b border-border">
            {SOURCE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = source === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                    isActive
                      ? "border-emerald-500 text-emerald-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => handleSourceChange(option.value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                  <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {/* CSV import flow */}
          {source !== "manual" && (
            <div className="space-y-3">
              <CsvPicker file={file} onFileSelected={handleFileSelected} />
              <SourceGuide source={source} />

              {/* Import mode — compact inline */}
              <div className="flex items-center gap-3">
                <Label className="shrink-0 text-xs text-muted-foreground">Mode</Label>
                <div className="flex gap-0 border border-border">
                  <button
                    type="button"
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium transition-colors",
                      importMode === "merge"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setImportMode("merge")}
                    title="Keep existing mappings and emails. New data fills in blanks."
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "border-l border-border px-3 py-1.5 text-xs font-medium transition-colors",
                      importMode === "replace"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setImportMode("replace")}
                    title="Reset mappings and emails from CSV. Manual changes will be lost."
                  >
                    Replace
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {importMode === "merge"
                    ? "Keeps existing data, fills blanks"
                    : "Overwrites with CSV data"}
                </span>
              </div>
            </div>
          )}

          {/* Apollo column mapping */}
          {source === "apollo" && file && (
            <div className="space-y-3 border border-border bg-card/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-foreground">Column Mapping</p>
                  <p className="text-[10px] text-muted-foreground">
                    Map CSV columns to fields. Needs Email or LinkedIn URL.
                  </p>
                </div>
                {isPreviewing && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {preview ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {APOLLO_FIELDS.map((field) => (
                    <div key={field} className="flex items-center gap-2">
                      <Label className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                        {FIELD_LABELS[field]}
                      </Label>
                      <Select
                        value={mapping[field] || "none"}
                        onValueChange={(value) => {
                          setMapping((prev) => ({
                            ...prev,
                            [field]: value === "none" ? null : value,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-7 flex-1 text-xs">
                          <SelectValue placeholder="Not mapped" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not mapped</SelectItem>
                          {headers.map((header) => (
                            <SelectItem key={`${field}-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              ) : !isPreviewing ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Upload a file to auto-detect columns.
                </p>
              ) : null}
            </div>
          )}

          {/* Manual entry form */}
          {source === "manual" && (
            <div className="space-y-3 border border-border bg-card/30 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manual-full-name" className="text-xs">
                    Full Name <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="manual-full-name"
                    value={manualForm.fullName}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, fullName: event.target.value }))}
                    placeholder="Jane Doe"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-email" className="text-xs">Email</Label>
                  <Input
                    id="manual-email"
                    type="email"
                    value={manualForm.email}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="jane@company.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-linkedin" className="text-xs">LinkedIn URL</Label>
                  <Input
                    id="manual-linkedin"
                    value={manualForm.profileUrl}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, profileUrl: event.target.value }))}
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-company" className="text-xs">Company</Label>
                  <Input
                    id="manual-company"
                    value={manualForm.companyRaw}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, companyRaw: event.target.value }))}
                    placeholder="Company name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-position" className="text-xs">Position</Label>
                  <Input
                    id="manual-position"
                    value={manualForm.position}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, position: event.target.value }))}
                    placeholder="Talent Partner"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manual-notes" className="text-xs">Notes</Label>
                  <Textarea
                    id="manual-notes"
                    value={manualForm.notes}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="min-h-16"
                    placeholder="Context for future outreach"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          {source === "manual" ? (
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void createManual();
              }}
              disabled={!canCreateManual || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <UserRoundPlus className="h-4 w-4" />
                  Add Person
                </>
              )}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void submitImport();
              }}
              disabled={!canSubmitImport || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import People"
              )}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
