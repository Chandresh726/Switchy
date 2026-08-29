"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ApiErrorState } from "@/components/ui/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  applyResumeSection,
  createEducation,
  deleteEducation,
  getEducation,
  updateEducation,
} from "@/lib/api/clients/profile";
import type { Education } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type {
  ResumeEducationInput,
  ResumeSectionReview,
} from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

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
  resumeReview?: {
    key: number;
    review: ResumeSectionReview<ResumeEducationInput>;
  };
  onReviewResolved?: () => void;
}

const EMPTY_FORM: EducationFormData = {
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
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isEdit: boolean;
  isPending: boolean;
  formData: EducationFormData;
  setFormData: React.Dispatch<React.SetStateAction<EducationFormData>>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-sm font-medium text-foreground">
          {isEdit ? "Edit Education" : "Add Education"}
        </h4>
        <div className="flex justify-end gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : isEdit ? (
              <Save data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            {isEdit ? "Save Changes" : "Add Education"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="institution">Institution *</Label>
          <Input
            id="institution"
            value={formData.institution}
            onChange={(event) => setFormData((current) => ({
              ...current,
              institution: event.target.value,
            }))}
            required
            placeholder="Stanford University"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="degree">Degree *</Label>
          <Input
            id="degree"
            value={formData.degree}
            onChange={(event) => setFormData((current) => ({
              ...current,
              degree: event.target.value,
            }))}
            required
            placeholder="Bachelor of Science"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="field">Field of Study</Label>
          <Input
            id="field"
            value={formData.field}
            onChange={(event) => setFormData((current) => ({
              ...current,
              field: event.target.value,
            }))}
            placeholder="Computer Science"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="educationStartDate">Start Date</Label>
            <Input
              id="educationStartDate"
              value={formData.startDate}
              onChange={(event) => setFormData((current) => ({
                ...current,
                startDate: event.target.value,
              }))}
              placeholder="Sep 2018"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="educationEndDate">End Date</Label>
            <Input
              id="educationEndDate"
              value={formData.endDate}
              onChange={(event) => setFormData((current) => ({
                ...current,
                endDate: event.target.value,
              }))}
              placeholder="Jun 2022"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gpa">GPA</Label>
          <Input
            id="gpa"
            value={formData.gpa}
            onChange={(event) => setFormData((current) => ({
              ...current,
              gpa: event.target.value,
            }))}
            placeholder="3.8 / 4.0"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="honors">Honors</Label>
          <Input
            id="honors"
            value={formData.honors}
            onChange={(event) => setFormData((current) => ({
              ...current,
              honors: event.target.value,
            }))}
            placeholder="Magna Cum Laude, Dean's List"
          />
        </div>
      </div>
    </form>
  );
}

export function EducationEditor({
  profileId,
  resumeReview,
  onReviewResolved,
}: EducationEditorProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<EducationFormData>(EMPTY_FORM);
  const [dismissedReview, setDismissedReview] = useState<{
    reviewKey: number | null;
    keys: string[];
  }>({ reviewKey: null, keys: [] });
  const dismissedReviewKeys = dismissedReview.reviewKey === resumeReview?.key
    ? dismissedReview.keys
    : [];

  const {
    data: educationList = [],
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.profile.education(profileId),
    queryFn: async () => {
      if (!profileId) return [];
      return getEducation(profileId);
    },
    enabled: !!profileId,
  });

  const addMutation = useMutation({
    mutationFn: async (educationData: EducationFormData) => {
      if (!profileId) throw new Error("Save the profile before adding education");
      return createEducation([{
        ...educationData,
        profileId,
        startDate: educationData.startDate || null,
        endDate: educationData.endDate || null,
        gpa: educationData.gpa || null,
        honors: educationData.honors || null,
      }]);
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.education(profileId)
      );
      setIsAdding(false);
      setFormData(EMPTY_FORM);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to add education"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EducationFormData }) => {
      return updateEducation(id, {
        ...data,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        gpa: data.gpa || null,
        honors: data.honors || null,
      });
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.education(profileId)
      );
      setEditingId(null);
      setFormData(EMPTY_FORM);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to update education"));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (items: ResumeEducationInput[]) => {
      if (!profileId) throw new Error("Save the profile before applying education");
      return applyResumeSection({
        section: "education",
        profileId,
        items,
      });
    },
    onSuccess: (result) => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.education(profileId)
      );
      toast.success(
        `Education updated: ${result.added} added, ${result.updated} updated`
      );
      onReviewResolved?.();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to apply resume education"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEducation,
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.education(profileId)
      );
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to delete education"));
    },
  });

  const pendingChanges = resumeReview?.review.changes.filter(
    ({ key }) => !dismissedReviewKeys.includes(key)
  ) ?? [];

  const handleAddSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    addMutation.mutate(formData);
  };

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
  };

  const startEditing = (item: Education) => {
    setEditingId(item.id);
    setIsAdding(false);
    setFormData({
      institution: item.institution,
      degree: item.degree,
      field: item.field || "",
      startDate: item.startDate,
      endDate: item.endDate || "",
      gpa: item.gpa || "",
      honors: item.honors || "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
  };

  const removePendingChange = (key: string) => {
    const remainingCount = pendingChanges.filter((change) => change.key !== key).length;
    setDismissedReview({
      reviewKey: resumeReview?.key ?? null,
      keys: [...dismissedReviewKeys, key],
    });
    if (remainingCount === 0) onReviewResolved?.();
  };

  const handleRevertReview = () => {
    setDismissedReview({ reviewKey: null, keys: [] });
    onReviewResolved?.();
  };

  if (!profileId) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            Save your basic information first to add education.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <ApiErrorState
            error={error}
            fallbackMessage="Education could not be loaded."
            onRetry={() => void refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <GraduationCap className="h-5 w-5 text-blue-500" />
          </div>
          <CardTitle className="text-lg font-medium text-foreground">Education</CardTitle>
        </div>
        {pendingChanges.length > 0 ? (
          <>
            <CardDescription>
              {pendingChanges.filter(({ kind }) => kind === "add").length} to add ·{" "}
              {pendingChanges.filter(({ kind }) => kind === "update").length} to update
              {resumeReview?.review.unchangedCount
                ? ` · ${resumeReview.review.unchangedCount} already current`
                : ""}
            </CardDescription>
            <CardAction className="col-span-2 col-start-1 row-span-1 row-start-3 mt-2 flex w-full justify-end gap-2 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRevertReview}
                disabled={reviewMutation.isPending}
              >
                <Undo2 data-icon="inline-start" />
                Revert
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => reviewMutation.mutate(
                  pendingChanges.map(({ value }) => value)
                )}
                disabled={reviewMutation.isPending}
                className="min-w-[120px] bg-blue-600 text-foreground hover:bg-blue-500"
              >
                {reviewMutation.isPending ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {reviewMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardAction>
          </>
        ) : null}
      </CardHeader>
      <Separator />
      <CardContent className="space-y-4">
        {pendingChanges.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Resume changes to review
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {pendingChanges.map((change) => (
                <div
                  key={change.key}
                  className="flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-500/15 p-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">
                      {change.kind === "add" ? "New" : "Update"}
                    </Badge>
                    <div>
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">
                        {change.value.degree}
                      </span>
                      {change.value.field ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {" "}in {change.value.field}
                        </span>
                      ) : null}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {" "}at {change.value.institution}
                      </span>
                      {change.changedFields.length > 0 ? (
                        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/90">
                          Changes: {change.changedFields.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Ignore ${change.value.degree} at ${change.value.institution}`}
                    onClick={() => removePendingChange(change.key)}
                    className="rounded p-1 text-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {editingId ? (
          <EducationForm
            onSubmit={handleEditSubmit}
            onCancel={cancelEditing}
            isEdit
            isPending={updateMutation.isPending}
            formData={formData}
            setFormData={setFormData}
          />
        ) : null}

        {educationList.map((item) => (
          <div
            key={item.id}
            className={`group rounded-lg border border-border bg-card p-4 ${
              editingId === item.id ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">
                  {item.degree}
                  {item.field ? (
                    <span className="font-normal text-foreground/80">
                      {" "}in {item.field}
                    </span>
                  ) : null}
                </h4>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{item.institution}</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {item.startDate || "Unknown"} - {item.endDate || "Present"}
                  </span>
                </div>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  {item.gpa ? <span>GPA: {item.gpa}</span> : null}
                  {item.honors ? <span>Honors: {item.honors}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEditing(item)}
                  disabled={editingId === item.id}
                >
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-400" />
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
              setFormData(EMPTY_FORM);
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

    </Card>
  );
}
