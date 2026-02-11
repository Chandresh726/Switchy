"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { Loader2, Plus, X, Save } from "lucide-react";

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
  onCancel?: () => void;
}

const PLATFORMS = [
  { value: "", label: "Auto-detect" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "custom", label: "Custom" },
];

export function CompanyForm({ company, onSuccess, onCancel }: CompanyFormProps) {
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

    // Auto-detect platform
    const urlLower = url.toLowerCase();
    if (urlLower.includes("greenhouse.io") || urlLower.includes("boards.greenhouse")) {
      setDetectedPlatform("Greenhouse");
    } else if (urlLower.includes("lever.co") || urlLower.includes("jobs.lever")) {
      setDetectedPlatform("Lever");
    } else if (url.length > 10) {
      setDetectedPlatform("Custom");
    } else {
      setDetectedPlatform(null);
    }
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
      if (!res.ok) throw new Error("Failed to create company");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onSuccess?.();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(`/api/companies/${company!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update company");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onSuccess?.();
    },
  });

  const mutation = isEditing ? updateMutation : createMutation;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">
          {isEditing ? "Edit Company" : "Add Company"}
        </h3>
        {onCancel && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

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
            />
            {detectedPlatform && !manualPlatformOverride && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                {detectedPlatform}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            We support Greenhouse, Lever, and custom career pages
          </p>
        </div>
      </div>

      <div className="space-y-2">
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

      {/* Platform Override Section */}
      {detectedPlatform === "Custom" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="manualPlatform"
              checked={manualPlatformOverride}
              onChange={(e) => {
                setManualPlatformOverride(e.target.checked);
                if (!e.target.checked) {
                  setFormData((prev) => ({ ...prev, platform: "", boardToken: "" }));
                }
              }}
              className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
            />
            <div>
              <Label htmlFor="manualPlatform" className="text-amber-400 cursor-pointer">
                This company uses a known ATS (Greenhouse/Lever)
              </Label>
              <p className="text-xs text-zinc-400 mt-0.5">
                Enable this if the company has a custom career page but uses Greenhouse or Lever for applications
              </p>
            </div>
          </div>

          {manualPlatformOverride && (
            <div className="grid gap-4 sm:grid-cols-2 pt-2">
              <div className="space-y-2">
                <Label htmlFor="platform">Platform</Label>
                <select
                  id="platform"
                  value={formData.platform}
                  onChange={(e) => setFormData((prev) => ({ ...prev, platform: e.target.value }))}
                  className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform.value} value={platform.value}>
                      {platform.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="boardToken">
                  Board Token {(formData.platform === "greenhouse" || formData.platform === "lever") && "*"}
                </Label>
                <Input
                  id="boardToken"
                  value={formData.boardToken}
                  onChange={(e) => setFormData((prev) => ({ ...prev, boardToken: e.target.value }))}
                  placeholder="e.g., acme"
                  required={formData.platform === "greenhouse" || formData.platform === "lever"}
                  autoComplete="off"
                  data-form-type="other"
                />
                <p className="text-xs text-zinc-500">
                  Find this in the apply URL: boards.greenhouse.io/<strong>acme</strong>/jobs/123
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEditing ? (
            <Save className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {isEditing ? "Save Changes" : "Add Company"}
        </Button>
      </div>
    </form>
  );
}
