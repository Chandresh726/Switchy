"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save, Sparkles, Undo2, X, Zap } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  applyResumeSection,
  createSkill,
  deleteSkill,
  getSkills,
} from "@/lib/api/clients/profile";
import type { Skill } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type {
  ResumeSectionReview,
  ResumeSkillInput,
} from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

interface SkillsEditorProps {
  profileId: number | null;
  resumeReview?: {
    key: number;
    review: ResumeSectionReview<ResumeSkillInput>;
  };
  onReviewResolved?: () => void;
}

const SKILL_CATEGORIES = [
  "frontend",
  "backend",
  "devops",
  "data",
  "database",
  "cloud",
  "mobile",
  "design",
  "soft skills",
  "other",
];

export function SkillsEditor({
  profileId,
  resumeReview,
  onReviewResolved,
}: SkillsEditorProps) {
  const queryClient = useQueryClient();
  const [newSkill, setNewSkill] = useState({
    name: "",
    category: "other",
  });
  const [dismissedReview, setDismissedReview] = useState<{
    reviewKey: number | null;
    keys: string[];
  }>({ reviewKey: null, keys: [] });
  const dismissedReviewKeys = dismissedReview.reviewKey === resumeReview?.key
    ? dismissedReview.keys
    : [];

  const {
    data: skills = [],
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery<Skill[]>({
    queryKey: queryKeys.profile.skills(profileId),
    queryFn: async () => {
      if (!profileId) return [];
      return getSkills(profileId);
    },
    enabled: !!profileId,
  });

  const addMutation = useMutation({
    mutationFn: async (skill: typeof newSkill) => {
      if (!profileId) throw new Error("Save the profile before adding skills");
      return createSkill({ ...skill, profileId });
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
      setNewSkill({ name: "", category: "other" });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to add skill")),
  });

  const reviewMutation = useMutation({
    mutationFn: async (items: ResumeSkillInput[]) => {
      if (!profileId) throw new Error("Save the profile before applying skills");
      return applyResumeSection({
        section: "skills",
        profileId,
        items,
      });
    },
    onSuccess: (result) => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
      toast.success(
        `Skills updated: ${result.added} added, ${result.updated} updated`
      );
      onReviewResolved?.();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to apply resume skills"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSkill,
    onSuccess: () => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete skill")),
  });

  const pendingChanges = resumeReview?.review.changes.filter(
    ({ key }) => !dismissedReviewKeys.includes(key)
  ) ?? [];

  const handleAddSkill = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newSkill.name.trim() || !profileId) return;
    addMutation.mutate(newSkill);
  };

  const handleApplyReview = () => {
    if (pendingChanges.length === 0) return;
    reviewMutation.mutate(pendingChanges.map(({ value }) => value));
  };

  const handleRevertReview = () => {
    setDismissedReview({ reviewKey: null, keys: [] });
    onReviewResolved?.();
  };

  const removePendingChange = (key: string) => {
    const remainingCount = pendingChanges.filter((change) => change.key !== key).length;
    setDismissedReview({
      reviewKey: resumeReview?.key ?? null,
      keys: [...dismissedReviewKeys, key],
    });
    if (remainingCount === 0) onReviewResolved?.();
  };

  const skillsByCategory = skills.reduce(
    (groups, skill) => {
      const category = skill.category || "other";
      if (!groups[category]) groups[category] = [];
      groups[category].push(skill);
      return groups;
    },
    {} as Record<string, Skill[]>
  );

  if (!profileId) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            Save your basic information first to add skills.
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
            fallbackMessage="Skills could not be loaded."
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
            <Zap className="h-5 w-5 text-violet-500" />
          </div>
          <CardTitle className="text-lg font-medium text-foreground">Skills</CardTitle>
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
                onClick={handleApplyReview}
                disabled={reviewMutation.isPending}
                className="min-w-[120px] bg-violet-600 text-foreground hover:bg-violet-500"
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
      <CardContent className="space-y-6">
        {pendingChanges.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Resume changes to review
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingChanges.map((change) => (
                <Badge
                  key={change.key}
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                >
                  {change.value.name}
                  <span className="ml-1 text-[10px] uppercase">
                    {change.kind === "add" ? "New" : "Update"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Ignore ${change.value.name}`}
                    onClick={() => removePendingChange(change.key)}
                    className="ml-1 rounded p-0.5 hover:bg-emerald-500/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleAddSkill} className="flex gap-2">
          <Input
            placeholder="Skill name (e.g., React, Python)"
            value={newSkill.name}
            onChange={(event) => setNewSkill((current) => ({
              ...current,
              name: event.target.value,
            }))}
            className="flex-1"
          />
          <Select
            value={newSkill.category}
            onValueChange={(category) => setNewSkill((current) => ({
              ...current,
              category,
            }))}
          >
            <SelectTrigger className="w-36 shrink-0" aria-label="Skill category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                {SKILL_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={addMutation.isPending || !newSkill.name.trim()}>
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </form>

        {Object.entries(skillsByCategory).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No skills added yet. Add your first skill above.
            </p>
          </div>
        ) : (
          <div
            data-skills-category-layout
            className="flex flex-wrap items-start gap-x-6 gap-y-4"
          >
            {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
              <div
                key={category}
                data-skills-category
                className="w-max max-w-full flex-none"
              >
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {category}
                </h4>
                <div
                  data-skills-category-items
                  className="flex w-max max-w-full flex-nowrap gap-2 overflow-x-auto"
                >
                  {categorySkills.map((skill) => (
                    <Badge
                      key={skill.id}
                      variant="secondary"
                      className="group flex items-center gap-1 pl-2 pr-1"
                    >
                      {skill.name}
                      <button
                        type="button"
                        aria-label={`Delete ${skill.name}`}
                        onClick={() => deleteMutation.mutate(skill.id)}
                        className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

    </Card>
  );
}
