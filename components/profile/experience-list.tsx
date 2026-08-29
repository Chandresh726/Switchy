"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Calendar,
  Loader2,
  MapPin,
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
import { Textarea } from "@/components/ui/textarea";
import {
  applyResumeSection,
  createExperience,
  deleteExperience,
  getExperience,
  updateExperience,
} from "@/lib/api/clients/profile";
import type { Experience } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type {
  ResumeExperienceInput,
  ResumeSectionReview,
} from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

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
  resumeReview?: {
    key: number;
    review: ResumeSectionReview<ResumeExperienceInput>;
  };
  onReviewResolved?: () => void;
}

const EMPTY_FORM: ExperienceFormData = {
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
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isEdit: boolean;
  isPending: boolean;
  formData: ExperienceFormData;
  setFormData: React.Dispatch<React.SetStateAction<ExperienceFormData>>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-sm font-medium text-foreground">
          {isEdit ? "Edit Experience" : "Add Experience"}
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
            {isEdit ? "Save Changes" : "Add Experience"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Job Title *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(event) => setFormData((current) => ({
              ...current,
              title: event.target.value,
            }))}
            required
            placeholder="Senior Software Engineer"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company">Company *</Label>
          <Input
            id="company"
            value={formData.company}
            onChange={(event) => setFormData((current) => ({
              ...current,
              company: event.target.value,
            }))}
            required
            placeholder="Acme Inc"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={formData.location}
            onChange={(event) => setFormData((current) => ({
              ...current,
              location: event.target.value,
            }))}
            placeholder="San Francisco, CA"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date *</Label>
            <Input
              id="startDate"
              value={formData.startDate}
              onChange={(event) => setFormData((current) => ({
                ...current,
                startDate: event.target.value,
              }))}
              required
              placeholder="Jan 2022"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              value={formData.endDate}
              onChange={(event) => setFormData((current) => ({
                ...current,
                endDate: event.target.value,
              }))}
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
          onChange={(event) => setFormData((current) => ({
            ...current,
            description: event.target.value,
          }))}
          rows={3}
          placeholder="Describe your role and responsibilities..."
        />
      </div>
    </form>
  );
}

export function ExperienceList({
  profileId,
  resumeReview,
  onReviewResolved,
}: ExperienceListProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ExperienceFormData>(EMPTY_FORM);
  const [dismissedReview, setDismissedReview] = useState<{
    reviewKey: number | null;
    keys: string[];
  }>({ reviewKey: null, keys: [] });
  const dismissedReviewKeys = dismissedReview.reviewKey === resumeReview?.key
    ? dismissedReview.keys
    : [];

  const {
    data: experiences = [],
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery<Experience[]>({
    queryKey: queryKeys.profile.experience(profileId),
    queryFn: async () => {
      if (!profileId) return [];
      return getExperience(profileId);
    },
    enabled: !!profileId,
  });

  const addMutation = useMutation({
    mutationFn: async (experienceData: ExperienceFormData) => {
      if (!profileId) throw new Error("Save the profile before adding experience");
      return createExperience({
        ...experienceData,
        profileId,
        endDate: experienceData.endDate || null,
      });
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.experience(profileId)
      );
      setIsAdding(false);
      setFormData(EMPTY_FORM);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to add experience"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ExperienceFormData }) => {
      return updateExperience(id, {
        ...data,
        endDate: data.endDate || null,
      });
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.experience(profileId)
      );
      setEditingId(null);
      setFormData(EMPTY_FORM);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to update experience"));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (items: ResumeExperienceInput[]) => {
      if (!profileId) throw new Error("Save the profile before applying experience");
      return applyResumeSection({
        section: "experience",
        profileId,
        items,
      });
    },
    onSuccess: (result) => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.experience(profileId)
      );
      toast.success(
        `Experience updated: ${result.added} added, ${result.updated} updated`
      );
      onReviewResolved?.();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to apply resume experience"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExperience,
    onSuccess: () => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile.experience(profileId)
      );
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to delete experience"));
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

  const startEditing = (item: Experience) => {
    setEditingId(item.id);
    setIsAdding(false);
    setFormData({
      company: item.company,
      title: item.title,
      location: item.location || "",
      startDate: item.startDate,
      endDate: item.endDate || "",
      description: item.description || "",
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
            Save your basic information first to add work experience.
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
            fallbackMessage="Work experience could not be loaded."
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Briefcase className="h-5 w-5 text-amber-500" />
          </div>
          <CardTitle className="text-lg font-medium text-foreground">
            Work Experience
          </CardTitle>
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
                className="min-w-[120px] bg-amber-600 text-foreground hover:bg-amber-500"
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
                        {change.value.title}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {" "}at {change.value.company}
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
                    aria-label={`Ignore ${change.value.title} at ${change.value.company}`}
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
          <ExperienceForm
            onSubmit={handleEditSubmit}
            onCancel={cancelEditing}
            isEdit
            isPending={updateMutation.isPending}
            formData={formData}
            setFormData={setFormData}
          />
        ) : null}

        {experiences.map((item) => (
          <div
            key={item.id}
            className={`group rounded-lg border border-border bg-card p-4 ${
              editingId === item.id ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">{item.title}</h4>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {item.company}
                  </span>
                  {item.location ? (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {item.location}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {item.startDate} - {item.endDate || "Present"}
                  </span>
                </div>
                {item.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                    {item.description}
                  </p>
                ) : null}
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
          <ExperienceForm
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
            Add Work Experience
          </Button>
        ) : null}
      </CardContent>

    </Card>
  );
}
