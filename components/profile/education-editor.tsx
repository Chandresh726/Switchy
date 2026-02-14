"use client";

import { useState, useEffect } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, GraduationCap, Loader2, Pencil, Plus, Save, Trash2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Education {
  id: number;
  institution: string;
  degree: string;
  field: string | null;
  startDate: string;
  endDate: string | null;
  gpa: string | null;
  honors: string | null;
}

interface InitialEducation {
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
  honors?: string;
}

interface EducationFormData {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa: string;
  honors: string;
}

interface EducationEditorProps {
  profileId: number | null;
  initialEducation?: InitialEducation[];
}

const emptyForm: EducationFormData = {
  institution: "",
  degree: "",
  field: "",
  startDate: "",
  endDate: "",
  gpa: "",
  honors: "",
};

function EducationForm({
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
  formData: EducationFormData;
  setFormData: React.Dispatch<React.SetStateAction<EducationFormData>>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-white">
          {isEdit ? "Edit Education" : "Add Education"}
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
          <Label htmlFor="institution">Institution *</Label>
          <Input
            id="institution"
            value={formData.institution}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, institution: e.target.value }))
            }
            required
            placeholder="Stanford University"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="degree">Degree *</Label>
          <Input
            id="degree"
            value={formData.degree}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, degree: e.target.value }))
            }
            required
            placeholder="Bachelor of Science"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="field">Field of Study</Label>
          <Input
            id="field"
            value={formData.field}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, field: e.target.value }))
            }
            placeholder="Computer Science"
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
              placeholder="Sep 2018"
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
              placeholder="Jun 2022"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gpa">GPA</Label>
          <Input
            id="gpa"
            value={formData.gpa}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, gpa: e.target.value }))
            }
            placeholder="3.8 / 4.0"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="honors">Honors</Label>
          <Input
            id="honors"
            value={formData.honors}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, honors: e.target.value }))
            }
            placeholder="Magna Cum Laude, Dean's List"
          />
        </div>
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
          {isEdit ? "Save Changes" : "Add Education"}
        </Button>
      </div>
    </form>
  );
}

export function EducationEditor({ profileId, initialEducation }: EducationEditorProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<EducationFormData>(emptyForm);
  const [pendingEducation, setPendingEducation] = useState<InitialEducation[]>([]);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (initialEducation && initialEducation.length > 0) {
      setPendingEducation(initialEducation);
    }
  }, [initialEducation]);

  const { data: educationList = [], isLoading } = useQuery<Education[]>({
    queryKey: ["education", profileId],
    queryFn: async () => {
      try {
        if (!profileId) return [];
        const res = await fetch(`/api/profile/education?profileId=${profileId}`);
        if (!res.ok) throw new Error("Failed to fetch education");
        return res.json();
      } catch (error) {
        console.error("fetch education:", error);
        return [];
      }
    },
    enabled: !!profileId,
  });

  const addMutation = useMutation({
    mutationFn: async (edu: EducationFormData) => {
      try {
        const res = await fetch("/api/profile/education", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...edu,
            profileId,
            endDate: edu.endDate || null,
            gpa: edu.gpa || null,
            honors: edu.honors || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to add education");
        return res.json();
      } catch (error) {
        console.error("add education:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education", profileId] });
      setIsAdding(false);
      setFormData(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, edu }: { id: number; edu: EducationFormData }) => {
      try {
        const res = await fetch("/api/profile/education", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            ...edu,
            endDate: edu.endDate || null,
            gpa: edu.gpa || null,
            honors: edu.honors || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to update education");
        return res.json();
      } catch (error) {
        console.error("update education:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education", profileId] });
      setEditingId(null);
      setFormData(emptyForm);
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (educationToAdd: InitialEducation[]) => {
      try {
        for (const edu of educationToAdd) {
          const res = await fetch("/api/profile/education", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              institution: edu.institution,
              degree: edu.degree,
              field: edu.field || null,
              startDate: edu.startDate,
              endDate: edu.endDate || null,
              gpa: edu.gpa || null,
              honors: edu.honors || null,
              profileId,
            }),
          });
          if (!res.ok) throw new Error("Failed to add education");
        }
      } catch (error) {
        console.error("bulk add education:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education", profileId] });
      setPendingEducation([]);
      setIsBulkAdding(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Education saved");
    },
    onError: () => {
      setIsBulkAdding(false);
      toast.error("Failed to save education");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        const res = await fetch(`/api/profile/education?id=${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete education");
        return res.json();
      } catch (error) {
        console.error("delete education:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education", profileId] });
    },
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, edu: formData });
    }
  };

  const startEditing = (edu: Education) => {
    setEditingId(edu.id);
    setIsAdding(false);
    setFormData({
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field || "",
      startDate: edu.startDate,
      endDate: edu.endDate || "",
      gpa: edu.gpa || "",
      honors: edu.honors || "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleSavePending = () => {
    if (!profileId || pendingEducation.length === 0) return;
    setIsBulkAdding(true);
    bulkAddMutation.mutate(pendingEducation);
  };

  const removePendingEducation = (index: number) => {
    setPendingEducation((prev) => prev.filter((_, i) => i !== index));
  };

  if (!profileId) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-6">
          <p className="text-sm text-zinc-400">
            Save your profile first to add education.
          </p>
          {pendingEducation.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-amber-400">
                {pendingEducation.length} education entries from resume will be added after you save your profile.
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <GraduationCap className="h-5 w-5 text-blue-500" />
          </div>
          <CardTitle className="text-lg font-medium text-white">Education</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingEducation.length > 0 && (
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">
                  {pendingEducation.length} education entries from resume
                </span>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {pendingEducation.map((edu, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded border border-emerald-700/50 bg-emerald-900/30 p-2"
                >
                  <div className="text-sm">
                    <span className="font-medium text-emerald-300">{edu.degree}</span>
                    {edu.field && <span className="text-emerald-400"> in {edu.field}</span>}
                    <span className="text-emerald-400"> at {edu.institution}</span>
                    <span className="text-emerald-500 ml-2 text-xs">
                      {edu.startDate} - {edu.endDate || "Present"}
                    </span>
                  </div>
                  <button
                    onClick={() => removePendingEducation(idx)}
                    className="rounded p-1 text-emerald-400 hover:bg-emerald-800 hover:text-emerald-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {editingId && (
          <EducationForm
            onSubmit={handleEditSubmit}
            onCancel={cancelEditing}
            isEdit={true}
            isPending={updateMutation.isPending}
            formData={formData}
            setFormData={setFormData}
          />
        )}

        {educationList.map((edu) => (
          <div
            key={edu.id}
            className={`group rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 ${
              editingId === edu.id ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h4 className="font-medium text-white">
                  {edu.degree}
                  {edu.field && <span className="font-normal text-zinc-300"> in {edu.field}</span>}
                </h4>
                <div className="flex items-center gap-4 text-sm text-zinc-400">
                  <span>{edu.institution}</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {edu.startDate} - {edu.endDate || "Present"}
                  </span>
                </div>
                <div className="flex gap-4 text-sm text-zinc-500">
                  {edu.gpa && <span>GPA: {edu.gpa}</span>}
                  {edu.honors && <span>Honors: {edu.honors}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEditing(edu)}
                  disabled={editingId === edu.id}
                >
                  <Pencil className="h-4 w-4 text-zinc-400 hover:text-zinc-200" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => deleteMutation.mutate(edu.id)}
                >
                  <Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-400" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {isAdding ? (
          <EducationForm
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
            Add Education
          </Button>
        ) : null}
      </CardContent>

      {pendingEducation.length > 0 && (
        <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <p className="text-xs text-zinc-500">
            {settingsSaved ? (
              <span className="flex items-center text-emerald-400 gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Changes saved successfully
              </span>
            ) : (
              <span className="text-yellow-400">{pendingEducation.length} pending education entries to save</span>
            )}
          </p>
          <Button
            onClick={handleSavePending}
            disabled={isBulkAdding || pendingEducation.length === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white min-w-[120px]"
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
