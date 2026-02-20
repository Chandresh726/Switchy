"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLATFORM_OPTIONS } from "@/lib/constants";
import { detectPlatformFromUrl, getPlatformLabel } from "@/lib/scraper/platform-detection";

interface Company {
  id: number;
  name: string;
  careersUrl: string;
  logoUrl: string | null;
  platform: string | null;
  boardToken: string | null;
  isActive: boolean;
  lastScrapedAt: string | null;
}

interface CompanyFormProps {
  company?: Company;
  onSuccess?: () => void;
}

const PLATFORMS = [
  ...PLATFORM_OPTIONS.filter((platform) => platform.value !== "uber"),
];

async function getApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.error === "string" && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore invalid JSON error responses and use fallback message.
  }

  return fallbackMessage;
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage;
}

export function CompanyForm({ company, onSuccess }: CompanyFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!company;
  const [formData, setFormData] = useState({
    name: "",
    careersUrl: "",
    logoUrl: "",
    platform: "",
    boardToken: "",
  });
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [manualPlatformOverride, setManualPlatformOverride] = useState(false);

  const handleUrlChange = (url: string) => {
    setFormData((prev) => ({ ...prev, careersUrl: url }));

    if (url.trim().length <= 10) {
      setDetectedPlatform(null);
      return;
    }

    const detected = detectPlatformFromUrl(url);
    setDetectedPlatform(getPlatformLabel(detected));
  };

  // Pre-fill form when editing
  useEffect(() => {
    if (company) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        name: company.name,
        careersUrl: company.careersUrl,
        logoUrl: company.logoUrl || "",
        platform: company.platform || "",
        boardToken: company.boardToken || "",
      });
      // Set manual override if boardToken exists
      if (company.boardToken) {
        setManualPlatformOverride(true);
      }
      handleUrlChange(company.careersUrl);
    }
  }, [company]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to create company"));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to create company"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(`/api/companies/${company!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to update company"));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to update company"));
    },
  });

  const mutation = isEditing ? updateMutation : createMutation;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  const title = isEditing ? "Edit Company" : "Add Company";
  const submitLabel = isEditing ? "Save" : "Add Company";
  const selectedManualPlatform = formData.platform || "custom";
  const requiresBoardToken =
    selectedManualPlatform === "greenhouse" ||
    selectedManualPlatform === "lever" ||
    selectedManualPlatform === "ashby";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      <h3 className="text-lg font-medium text-foreground">{title}</h3>

      {/* Required Fields Only */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Company Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            required
            placeholder="Acme Inc"
            autoComplete="off"
            data-form-type="other"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="careersUrl">Careers Page URL *</Label>
          <div className="relative">
            <Input
              id="careersUrl"
              value={formData.careersUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              required
              placeholder="https://jobs.lever.co/acme"
              autoComplete="off"
              data-form-type="other"
              className={detectedPlatform && !manualPlatformOverride ? "pr-32" : ""}
            />
            {detectedPlatform && !manualPlatformOverride && (
              <span className="absolute right-2 top-1/2 max-w-[8rem] -translate-y-1/2 truncate rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                {detectedPlatform}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Platform Override Section */}
      {detectedPlatform === "Custom" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="manualPlatform"
                checked={manualPlatformOverride}
                onChange={(e) => {
                  setManualPlatformOverride(e.target.checked);
                  if (e.target.checked) {
                    setFormData((prev) => ({
                      ...prev,
                      platform: prev.platform || "custom",
                    }));
                  } else {
                    setFormData((prev) => ({ ...prev, platform: "", boardToken: "" }));
                  }
                }}
                className="h-4 w-4 rounded border-border bg-card text-emerald-500 focus:ring-emerald-500"
              />
              <div className="space-y-0.5">
                <Label htmlFor="manualPlatform" className="cursor-pointer text-amber-400">
                  This company uses a known ATS
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable if a careers page routes to Greenhouse, Lever, Ashby, Workday, or Eightfold.
                </p>
              </div>
            </div>

            {manualPlatformOverride && requiresBoardToken ? (
              <div className="grid grid-cols-2 gap-2">
                <select
                  id="platform"
                  value={selectedManualPlatform}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, platform: e.target.value }))
                  }
                  className="h-9 w-full rounded border border-border bg-card px-2 text-xs text-foreground"
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform.value} value={platform.value}>
                      {platform.label}
                    </option>
                  ))}
                </select>
                <Input
                  id="boardToken"
                  value={formData.boardToken}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, boardToken: e.target.value }))
                  }
                  placeholder="Board token"
                  required
                  autoComplete="off"
                  data-form-type="other"
                  className="h-9"
                />
              </div>
            ) : (
              <select
                id="platform"
                value={selectedManualPlatform}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, platform: e.target.value }))
                }
                disabled={!manualPlatformOverride}
                className="h-9 w-full rounded border border-border bg-card px-2 text-xs text-foreground disabled:opacity-60"
              >
                {PLATFORMS.map((platform) => (
                  <option key={platform.value} value={platform.value}>
                    {platform.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor="logoUrl">Logo URL (Optional)</Label>
          <Input
            id="logoUrl"
            value={formData.logoUrl}
            onChange={(e) => setFormData((prev) => ({ ...prev, logoUrl: e.target.value }))}
            placeholder="https://..."
            autoComplete="off"
            data-form-type="other"
          />
        </div>
        <Button
          type="submit"
          disabled={mutation.isPending}
          className={`shrink-0 ${isEditing ? "bg-emerald-600 hover:bg-emerald-500 text-foreground min-w-[100px]" : ""}`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEditing ? (
            <Save className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {mutation.isPending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
