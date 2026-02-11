"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect, useMemo } from "react";
import { Building2, Calendar, Loader2, MapPin, Pencil, Plus, Save, Trash2, X, Sparkles, Briefcase } from "lucide-react";
import { toast } from "sonner";

interface Experience {
  id: number;
  company: string;
  title: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
  description: string | null;
  highlights: string | null;
}

interface InitialExperience {
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  description?: string;
  highlights?: string[];
}

interface ExperienceFormData {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface ExperienceListProps {
  profileId: number | null;
  initialExperience?: InitialExperience[];
}

const emptyForm: ExperienceFormData = {
  company: "",
  title: "",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
};

function ExperienceForm({
  onSubmit,
  onCancel,
  isEdit,
  isPending,
  formData,
  setFormData,
}: {
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isEdit: boolean;
  isPending: boolean;
  formData: ExperienceFormData;
  setFormData: React.Dispatch<React.SetStateAction<ExperienceFormData>>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-white">
          {isEdit ? "Edit Experience" : "Add Experience"}
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Job Title *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, title: e.target.value }))
            }
            required
            placeholder="Senior Software Engineer"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company">Company *</Label>
          <Input
            id="company"
            value={formData.company}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, company: e.target.value }))
            }
            required
            placeholder="Acme Inc"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={formData.location}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, location: e.target.value }))
            }
            placeholder="San Francisco, CA"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date *</Label>
            <Input
              id="startDate"
              value={formData.startDate}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, startDate: e.target.value }))
              }
              required
              placeholder="Jan 2022"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              value={formData.endDate}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, endDate: e.target.value }))
              }
              placeholder="Present"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, description: e.target.value }))
          }
          rows={3}
          placeholder="Describe your role and responsibilities..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEdit ? (
            <Save className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {isEdit ? "Save Changes" : "Add Experience"}
        </Button>
      </div>
    </form>
  );
}

export function ExperienceList({ profileId, initialExperience }: ExperienceListProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ExperienceFormData>(emptyForm);
  const [pendingExperiences, setPendingExperiences] = useState<InitialExperience[]>([]);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Set pending experiences when initialExperience changes (from resume parsing)
  useEffect(() => {
    if (initialExperience && initialExperience.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingExperiences(initialExperience);
    }
  }, [initialExperience]);

  const { data: experiences = [], isLoading } = useQuery<Experience[]>({
    queryKey: ["experience", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await fetch(`/api/profile/experience?profileId=${profileId}`);
      if (!res.ok) throw new Error("Failed to fetch experience");
      return res.json();
    },
    enabled: !!profileId,
  });

  const hasUnsavedChanges = useMemo(() => pendingExperiences.length > 0, [pendingExperiences]);

  const addMutation = useMutation({
    mutationFn: async (exp: ExperienceFormData) => {
      const res = await fetch("/api/profile/experience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...exp,
          profileId,
          endDate: exp.endDate || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to add experience");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experience", profileId] });
      setIsAdding(false);
      setFormData(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, exp }: { id: number; exp: ExperienceFormData }) => {
      const res = await fetch("/api/profile/experience", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          ...exp,
          endDate: exp.endDate || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update experience");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experience", profileId] });
      setEditingId(null);
      setFormData(emptyForm);
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (experiencesToAdd: InitialExperience[]) => {
      for (const exp of experiencesToAdd) {
        const res = await fetch("/api/profile/experience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: exp.company,
            title: exp.title,
            location: exp.location || "",
            startDate: exp.startDate,
            endDate: exp.endDate || null,
            description: exp.description || (exp.highlights ? exp.highlights.join("\n") : ""),
            profileId,
          }),
        });
        if (!res.ok) throw new Error("Failed to add experience");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experience", profileId] });
      setPendingExperiences([]);
      setIsBulkAdding(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Experience saved");
    },
    onError: () => {
      setIsBulkAdding(false);
      toast.error("Failed to save experience");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/profile/experience?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete experience");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experience", profileId] });
    },
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, exp: formData });
    }
  };

  const startEditing = (exp: Experience) => {
    setEditingId(exp.id);
    setIsAdding(false);
    setFormData({
      company: exp.company,
      title: exp.title,
      location: exp.location || "",
      startDate: exp.startDate,
      endDate: exp.endDate || "",
      description: exp.description || "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleSavePending = () => {
    if (!profileId || pendingExperiences.length === 0) return;
    setIsBulkAdding(true);
    bulkAddMutation.mutate(pendingExperiences);
  };

  const removePendingExperience = (index: number) => {
    setPendingExperiences((prev) => prev.filter((_, i) => i !== index));
  };

  if (!profileId) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-6">
          <p className="text-sm text-zinc-400">
            Save your profile first to add work experience.
          </p>
          {pendingExperiences.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-amber-400">
                {pendingExperiences.length} work experiences from resume will be added after you save your profile.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Briefcase className="h-5 w-5 text-amber-500" />
          </div>
          <CardTitle className="text-lg font-medium text-white">Work Experience</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pending experiences from resume */}
        {pendingExperiences.length > 0 && (
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">
                  {pendingExperiences.length} work experiences from resume
                </span>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {pendingExperiences.map((exp, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded border border-emerald-700/50 bg-emerald-900/30 p-2"
                >
                  <div className="text-sm">
                    <span className="font-medium text-emerald-300">{exp.title}</span>
                    <span className="text-emerald-400"> at {exp.company}</span>
                    <span className="text-emerald-500 ml-2 text-xs">
                      {exp.startDate} - {exp.endDate || "Present"}
                    </span>
                  </div>
                  <button
                    onClick={() => removePendingExperience(idx)}
                    className="rounded p-1 text-emerald-400 hover:bg-emerald-800 hover:text-emerald-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit form (shown at top when editing) */}
        {editingId && (
          <ExperienceForm
            onSubmit={handleEditSubmit}
            onCancel={cancelEditing}
            isEdit={true}
            isPending={updateMutation.isPending}
            formData={formData}
            setFormData={setFormData}
          />
        )}

        {/* Experience list */}
        {experiences.map((exp) => (
          <div
            key={exp.id}
            className={`group rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 ${
              editingId === exp.id ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h4 className="font-medium text-white">{exp.title}</h4>
                <div className="flex items-center gap-4 text-sm text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {exp.company}
                  </span>
                  {exp.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {exp.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {exp.startDate} - {exp.endDate || "Present"}
                  </span>
                </div>
                {exp.description && (
                  <p className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">{exp.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEditing(exp)}
                  disabled={editingId === exp.id}
                >
                  <Pencil className="h-4 w-4 text-zinc-400 hover:text-zinc-200" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => deleteMutation.mutate(exp.id)}
                >
                  <Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-400" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {/* Add experience form */}
        {isAdding ? (
          <ExperienceForm
            onSubmit={handleAddSubmit}
            onCancel={() => {
              setIsAdding(false);
              setFormData(emptyForm);
            }}
            isEdit={false}
            isPending={addMutation.isPending}
            formData={formData}
            setFormData={setFormData}
          />
        ) : !editingId ? (
          <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4" />
            Add Work Experience
          </Button>
        ) : null}
      </CardContent>

      {pendingExperiences.length > 0 && (
        <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <p className="text-xs text-zinc-500">
            {settingsSaved ? (
              <span className="flex items-center text-emerald-400 gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Changes saved successfully
              </span>
            ) : (
              <span className="text-yellow-400">{pendingExperiences.length} pending experiences to save</span>
            )}
          </p>
          <Button
            onClick={handleSavePending}
            disabled={isBulkAdding || pendingExperiences.length === 0}
            className="bg-amber-600 hover:bg-amber-500 text-white min-w-[120px]"
          >
            {isBulkAdding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {isBulkAdding ? "Saving..." : "Save All"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
