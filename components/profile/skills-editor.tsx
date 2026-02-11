"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect, useMemo } from "react";
import { Loader2, Plus, X, Sparkles, Zap, Save } from "lucide-react";
import { toast } from "sonner";

interface Skill {
  id: number;
  name: string;
  category: string | null;
  proficiency: number;
  yearsOfExperience: number | null;
}

interface InitialSkill {
  name: string;
  category?: string;
  proficiency?: number;
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

const PROFICIENCY_LEVELS = [
  { value: 1, label: "Beginner" },
  { value: 2, label: "Elementary" },
  { value: 3, label: "Intermediate" },
  { value: 4, label: "Advanced" },
  { value: 5, label: "Expert" },
];

export function SkillsEditor({ profileId, initialSkills }: SkillsEditorProps) {
  const queryClient = useQueryClient();
  const [newSkill, setNewSkill] = useState({
    name: "",
    category: "other",
    proficiency: 3,
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

  const { data: skills = [], isLoading } = useQuery<Skill[]>({
    queryKey: ["skills", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await fetch(`/api/profile/skills?profileId=${profileId}`);
      if (!res.ok) throw new Error("Failed to fetch skills");
      return res.json();
    },
    enabled: !!profileId,
  });

  const hasUnsavedChanges = useMemo(() => pendingSkills.length > 0, [pendingSkills]);

  const addMutation = useMutation({
    mutationFn: async (skill: typeof newSkill) => {
      const res = await fetch("/api/profile/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...skill, profileId }),
      });
      if (!res.ok) throw new Error("Failed to add skill");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", profileId] });
      setNewSkill({ name: "", category: "other", proficiency: 3 });
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (skillsToAdd: InitialSkill[]) => {
      for (const skill of skillsToAdd) {
        const res = await fetch("/api/profile/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: skill.name,
            category: skill.category || "other",
            proficiency: skill.proficiency || 3,
            profileId,
          }),
        });
        if (!res.ok) throw new Error("Failed to add skill");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", profileId] });
      setPendingSkills([]);
      setIsBulkAdding(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Skills saved");
    },
    onError: () => {
      setIsBulkAdding(false);
      toast.error("Failed to save skills");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/profile/skills?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete skill");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", profileId] });
    },
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
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-6">
          <p className="text-sm text-zinc-400">
            Save your profile first to add skills.
          </p>
          {pendingSkills.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-amber-400">
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
            <Zap className="h-5 w-5 text-violet-500" />
          </div>
          <CardTitle className="text-lg font-medium text-white">Skills</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pending skills from resume */}
        {pendingSkills.length > 0 && (
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">
                  {pendingSkills.length} skills from resume
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingSkills.map((skill, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="border-emerald-700 bg-emerald-900/30 text-emerald-300"
                >
                  {skill.name}
                  <button
                    onClick={() => removePendingSkill(idx)}
                    className="ml-1 rounded p-0.5 hover:bg-emerald-800"
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
            className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
          >
            {SKILL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={newSkill.proficiency}
            onChange={(e) =>
              setNewSkill((prev) => ({ ...prev, proficiency: parseInt(e.target.value) }))
            }
            className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
          >
            {PROFICIENCY_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
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
          <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center">
            <p className="text-sm text-zinc-400">No skills added yet. Add your first skill above.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
              <div key={category}>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
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
                      <span className="text-zinc-500">
                        ({PROFICIENCY_LEVELS.find((l) => l.value === skill.proficiency)?.label})
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(skill.id)}
                        className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100"
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
        <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <p className="text-xs text-zinc-500">
            {settingsSaved ? (
              <span className="flex items-center text-emerald-400 gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Changes saved successfully
              </span>
            ) : (
              <span className="text-yellow-400">{pendingSkills.length} pending skills to save</span>
            )}
          </p>
          <Button
            onClick={handleSavePending}
            disabled={isBulkAdding || pendingSkills.length === 0}
            className="bg-violet-600 hover:bg-violet-500 text-white min-w-[120px]"
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
