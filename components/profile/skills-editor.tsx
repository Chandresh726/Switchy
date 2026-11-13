"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles, X, Zap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { applyResumeSection, createSkill, deleteSkill, getSkills } from "@/lib/api/clients/profile";
import type { Skill } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type {
  ResumeSectionReview,
  ResumeSkillInput,
} from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

import { ProfileSectionState } from "./profile-section-state";
import { ResumeReviewActions } from "./resume-review-actions";
import { useResumeSectionReview } from "./use-resume-section-review";

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

  const { pendingChanges, isPending: reviewPending, applyReview, revertReview, removePendingChange } = useResumeSectionReview<ResumeSkillInput>({
    profileId, section: "skills", review: resumeReview, onResolved: onReviewResolved,
    apply: (items, profileId) => applyResumeSection({ section: "skills", profileId, items }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSkill,
    onSuccess: () => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete skill")),
  });

  const handleAddSkill = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newSkill.name.trim() || !profileId) return;
    addMutation.mutate(newSkill);
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

  return (
    <ProfileSectionState
      profileId={profileId} isLoading={isLoading} isError={isError} error={error}
      onRetry={() => void refetch()} missingMessage="Save your basic information first to add skills." errorMessage="Skills could not be loaded."
    >
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
              <Zap className="h-5 w-5 text-violet-500" />
            </div>
            <CardTitle className="text-lg font-medium text-foreground">Skills</CardTitle>
          </div>
          <ResumeReviewActions
            changes={pendingChanges} unchangedCount={resumeReview?.review.unchangedCount}
            isPending={reviewPending} onRevert={revertReview} onApply={applyReview}
            className="bg-violet-600 hover:bg-violet-500"
          />
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
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
                <div
                  key={category}
                  className="w-max max-w-full flex-none"
                >
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {category}
                  </h4>
                  <div
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
    </ProfileSectionState>
  );
}
