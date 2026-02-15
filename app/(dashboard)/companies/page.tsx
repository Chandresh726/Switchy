"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CompanyForm } from "@/components/companies/company-form";
import { CompanyList } from "@/components/companies/company-list";
import { JsonEditor } from "@/components/companies/json-editor";
import { Plus, List, FileJson, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function CompaniesPage() {
  const [view, setView] = useState<"list" | "json">("list");
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (companies: unknown[]) => {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companies),
      });
      if (!res.ok) throw new Error("Failed to import companies");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(`Successfully imported ${Array.isArray(data) ? data.length : 1} companies`);
    },
    onError: () => {
      toast.error("Failed to import companies");
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        if (!Array.isArray(data)) {
          toast.error("Invalid file format: Root must be an array");
          return;
        }
        importMutation.mutate(data);
      } catch {
        toast.error("Invalid JSON file");
      }
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      const data = await res.json();

      // Filter out system fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const exportData = data.map(({ id, createdAt, updatedAt, ...rest }: { id: number; createdAt: string; updatedAt: string; [key: string]: unknown }) => rest);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "companies.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export companies");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Companies</h1>
          <p className="mt-1 text-zinc-400">
            Track companies and their job openings
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Toggle */}
          {view === "list" && !isAdding && (
            <Button size="sm" onClick={() => setIsAdding(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Company
            </Button>
          )}

          <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-1">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("list")}
              className="h-7 px-2"
            >
              <List className="mr-2 h-4 w-4" />
              List
            </Button>
            <Button
              variant={view === "json" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("json")}
              className="h-7 px-2"
            >
              <FileJson className="mr-2 h-4 w-4" />
              JSON
            </Button>
          </div>

          <div className="h-6 w-px bg-zinc-800 mx-2 hidden sm:block" />

          {/* Actions */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".json"
            onChange={handleFileUpload}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Import
          </Button>

          <Button variant="outline" size="sm" onClick={handleExport}>
            <Upload className="mr-2 h-4 w-4" />
            Export
          </Button>

          {view === "list" && !isAdding && (
            <Button size="sm" onClick={() => setIsAdding(true)} className="sm:hidden">
              <Plus className="mr-2 h-4 w-4" />
              Add Company
            </Button>
          )}
        </div>
      </div>

      {/* Add Company Form */}
      {view === "list" && isAdding && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <CompanyForm
            onSuccess={() => setIsAdding(false)}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      {/* Content */}
      {view === "list" ? (
        <CompanyList />
      ) : (
        <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          <JsonEditor onSuccess={() => {}} />
        </div>
      )}
    </div>
  );
}
