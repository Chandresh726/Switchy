"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { FileUp, Link as LinkIcon, Loader2, Upload, UserRoundPlus, Users } from "lucide-react";
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
import type { ImportSummary, PeopleImportPreviewResponse } from "@/lib/people/types";
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

const SOURCE_OPTIONS: Array<{ value: ImportSource; label: string; hint: string }> = [
  { value: "linkedin", label: "LinkedIn CSV", hint: "Import your Connections.csv snapshot" },
  { value: "apollo", label: "Apollo CSV", hint: "Upload export and map columns" },
  { value: "manual", label: "Manual Entry", hint: "Add one person directly" },
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

  return (
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
      <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-center">
        <FileUp className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">Drag and drop your CSV</p>
          <p className="mt-1 text-xs text-muted-foreground">Accepted format: .csv</p>
        </div>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          Choose File
        </Button>
        {file ? (
          <p className="text-xs text-emerald-400">{file.name}</p>
        ) : null}
      </div>
    </div>
  );
}

function SourceGuide({ source }: { source: Exclude<ImportSource, "manual"> }) {
  if (source === "apollo") {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <h3 className="text-sm font-semibold text-foreground">Apollo CSV Tips</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
          <li>Export contacts from Apollo as CSV.</li>
          <li>Upload the file and run preview to map columns.</li>
          <li>Keep at least one identity column mapped: Email or LinkedIn URL.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">How to get LinkedIn CSV</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
        <li>Sign in to LinkedIn.</li>
        <li>Open LinkedIn data download settings.</li>
        <li>Request your archive and wait for email confirmation.</li>
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
  );
}

export function ImportPeopleModal({
  open,
  onOpenChange,
  onImported,
  onCreatedManual,
}: ImportPeopleModalProps) {
  const [source, setSource] = useState<ImportSource>("linkedin");
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

  const runPreview = async () => {
    if (!file || source !== "apollo") return;
    setIsPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("source", source);
      formData.append("file", file);
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

  const submitImport = async () => {
    if (!file || source === "manual") return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("source", source);
      formData.append("file", file);
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
      <AlertDialogContent className="!left-1/2 !top-1/2 !max-h-[88vh] !-translate-x-1/2 !-translate-y-1/2 max-w-[96vw] overflow-y-auto data-[size=default]:max-w-[96vw] data-[size=default]:sm:max-w-4xl">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Add People
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm">
            Import from LinkedIn or Apollo, or add a person manually.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Source</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    source === option.value
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-border bg-card/40 hover:bg-card/70"
                  )}
                  onClick={() => handleSourceChange(option.value)}
                >
                  <p className="text-sm font-medium text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {source === "manual" ? (
            <div className="space-y-4 rounded-lg border border-border bg-card/30 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="manual-full-name">Full Name</Label>
                  <Input
                    id="manual-full-name"
                    value={manualForm.fullName}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, fullName: event.target.value }))}
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-email">Email</Label>
                  <Input
                    id="manual-email"
                    value={manualForm.email}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="jane@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-linkedin">LinkedIn URL</Label>
                  <Input
                    id="manual-linkedin"
                    value={manualForm.profileUrl}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, profileUrl: event.target.value }))}
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-company">Company</Label>
                  <Input
                    id="manual-company"
                    value={manualForm.companyRaw}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, companyRaw: event.target.value }))}
                    placeholder="Company name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-position">Position</Label>
                  <Input
                    id="manual-position"
                    value={manualForm.position}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, position: event.target.value }))}
                    placeholder="Talent Partner"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="manual-notes">Notes</Label>
                  <Textarea
                    id="manual-notes"
                    value={manualForm.notes}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="min-h-20"
                    placeholder="Context for future outreach"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CsvPicker file={file} onFileSelected={setFile} />
              <SourceGuide source={source} />
            </div>
          )}

          {source === "apollo" && file ? (
            <div className="space-y-3 rounded-lg border border-border bg-card/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Map Apollo Columns</p>
                  <p className="text-xs text-muted-foreground">
                    Confirm mappings before import. Identity needs Email or LinkedIn URL.
                  </p>
                </div>
                <Button variant="outline" onClick={runPreview} disabled={isPreviewing}>
                  {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Preview & Map
                </Button>
              </div>

              {preview ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {APOLLO_FIELDS.map((field) => (
                    <div key={field} className="space-y-1">
                      <Label>{FIELD_LABELS[field]}</Label>
                      <Select
                        value={mapping[field] || "none"}
                        onValueChange={(value) => {
                          setMapping((prev) => ({
                            ...prev,
                            [field]: value === "none" ? null : value,
                          }));
                        }}
                      >
                        <SelectTrigger>
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
              ) : null}
            </div>
          ) : null}
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
