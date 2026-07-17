"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { createSkill, deleteSkill, getSkills } from "@/lib/api/clients/profile";
import type { Skill } from "@/lib/api/contracts/profile";
import { useState, useEffect } from "react";
import { Loader2, Plus, X, Sparkles, Zap, Save } from "lucide-react";
import { toast } from "sonner";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface InitialSkill {
  name: string;
  category?: string;
}

interface SkillsEditorProps {
  profileId: number | null;
  initialSkills?: InitialSkill[];
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

export function SkillsEditor({ profileId, initialSkills }: SkillsEditorProps) {
  const queryClient = useQueryClient();
  const [newSkill, setNewSkill] = useState({
    name: "",
    category: "other",
  });
  const [pendingSkills, setPendingSkills] = useState<InitialSkill[]>([]);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Set pending skills when initialSkills changes (from resume parsing)
  useEffect(() => {
    if (initialSkills && initialSkills.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSkills(initialSkills);
    }
  }, [initialSkills]);

  const { data: skills = [], error, isError, isLoading, refetch } = useQuery<Skill[]>({
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

  const bulkAddMutation = useMutation({
    mutationFn: async (skillsToAdd: InitialSkill[]) => {
      if (!profileId) throw new Error("Save the profile before adding skills");
      for (const skill of skillsToAdd) {
        await createSkill({
            name: skill.name,
            category: skill.category || "other",
            profileId,
        });
      }
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
      setPendingSkills([]);
      setIsBulkAdding(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Skills saved");
    },
    onError: (error) => {
      setIsBulkAdding(false);
      toast.error(getApiErrorMessage(error, "Failed to save skills"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return deleteSkill(id);
    },
    onSuccess: () => {
      void cacheOwnership.profileMutation(queryClient, queryKeys.profile.skills(profileId));
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete skill")),
  });

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkill.name.trim() || !profileId) return;
    addMutation.mutate(newSkill);
  };

  const handleSavePending = () => {
    if (!profileId || pendingSkills.length === 0) return;
    setIsBulkAdding(true);
    bulkAddMutation.mutate(pendingSkills);
  };

  const removePendingSkill = (index: number) => {
    setPendingSkills((prev) => prev.filter((_, i) => i !== index));
  };

  // Group skills by category
  const skillsByCategory = skills.reduce(
    (acc, skill) => {
      const category = skill.category || "other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(skill);
      return acc;
    },
    {} as Record<string, Skill[]>
  );

  if (!profileId) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            Save your profile first to add skills.
          </p>
          {pendingSkills.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {pendingSkills.length} skills from resume will be added after you save your profile.
              </p>
            </div>
          )}
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
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pending skills from resume */}
        {pendingSkills.length > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  {pendingSkills.length} skills from resume
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingSkills.map((skill, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                >
                  {skill.name}
                  <button
                    onClick={() => removePendingSkill(idx)}
                    className="ml-1 rounded p-0.5 hover:bg-emerald-500/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Add new skill form */}
        <form onSubmit={handleAddSkill} className="flex gap-2">
          <Input
            placeholder="Skill name (e.g., React, Python)"
            value={newSkill.name}
            onChange={(e) => setNewSkill((prev) => ({ ...prev, name: e.target.value }))}
            className="flex-1"
          />
          <select
            value={newSkill.category}
            onChange={(e) => setNewSkill((prev) => ({ ...prev, category: e.target.value }))}
            className="h-8 rounded border border-border bg-card px-2 text-xs text-foreground"
          >
            {SKILL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={addMutation.isPending || !newSkill.name.trim()}>
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </form>

        {/* Skills list by category */}
        {Object.entries(skillsByCategory).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No skills added yet. Add your first skill above.</p>
          </div>
        ) : (
          <div className="gap-6 space-y-4 sm:columns-2">
            {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
              <div key={category} className="mb-4 break-inside-avoid">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {category}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {categorySkills.map((skill) => (
                    <Badge
                      key={skill.id}
                      variant="secondary"
                      className="group flex items-center gap-1 pl-2 pr-1"
                    >
                      {skill.name}
                      <button
                        type="button"
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

      {pendingSkills.length > 0 && (
        <CardFooter className="flex items-center justify-between border-t border-border bg-card px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {settingsSaved ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                Changes saved successfully
              </span>
            ) : (
              <span className="text-yellow-700 dark:text-yellow-400">{pendingSkills.length} pending skills to save</span>
            )}
          </p>
          <Button
            onClick={handleSavePending}
            disabled={isBulkAdding || pendingSkills.length === 0}
            className="bg-violet-600 hover:bg-violet-500 text-foreground min-w-[120px]"
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
