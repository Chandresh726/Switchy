"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Save, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/themes/prism-tomorrow.css";

interface Company {
  name: string;
  careersUrl: string;
  logoUrl?: string | null;
  platform?: string | null;
  boardToken?: string | null;
  isActive?: boolean;
}

export function JsonEditor({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [jsonValue, setJsonValue] = useState<string>("");
  const [originalValue, setOriginalValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: companies, isLoading: isLoadingCompanies } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  useEffect(() => {
    if (companies) {
      // Filter out system fields for the editor
      const editableCompanies = companies.map(
        ({ name, careersUrl, logoUrl, platform, boardToken, isActive }) => ({
          name,
          careersUrl,
          logoUrl: logoUrl || undefined,
          platform: platform || undefined,
          boardToken: boardToken || undefined,
          isActive: isActive !== undefined ? isActive : true,
        })
      );
      const jsonString = JSON.stringify(editableCompanies, null, 2);
      setJsonValue(jsonString);
      setOriginalValue(jsonString);
    }
  }, [companies]);

  const hasChanges = jsonValue !== originalValue;

  const saveMutation = useMutation({
    mutationFn: async (data: Company[]) => {
      const res = await fetch("/api/companies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save companies");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setOriginalValue(jsonValue);
      toast.success("Companies updated successfully");
      onSuccess();
    },
    onError: (err) => {
      setError(err.message);
      toast.error("Failed to update companies");
    },
  });

  const handleSave = () => {
    setError(null);
    try {
      const parsed = JSON.parse(jsonValue);
      if (!Array.isArray(parsed)) {
        throw new Error("Root element must be an array");
      }

      // Basic validation
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item.name || !item.careersUrl) {
          throw new Error(`Item at index ${i} is missing required fields (name, careersUrl)`);
        }
      }

      saveMutation.mutate(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (isLoadingCompanies) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-4 py-2">
        <p className="text-sm text-zinc-400">
          Edit your companies list as JSON.
        </p>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || !hasChanges}
          size="sm"
          className="h-8"
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>

      {error && (
        <div className="border-b border-zinc-800 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Error: {error}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-zinc-950 font-mono text-sm">
        <Editor
          value={jsonValue}
          onValueChange={setJsonValue}
          highlight={(code) => highlight(code, languages.json, "json")}
          padding={24}
          className="min-h-full font-mono"
          style={{
            fontFamily: '"Fira Code", "Fira Mono", monospace',
            fontSize: 14,
            backgroundColor: "transparent",
            minHeight: "100%",
          }}
          textareaClassName="focus:outline-none"
        />
      </div>
    </div>
  );
}
