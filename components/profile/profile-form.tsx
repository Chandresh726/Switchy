"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Undo2, User } from "lucide-react";
import { toast } from "sonner";

import { ApiErrorState } from "@/components/ui/api-error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getProfile, saveProfile } from "@/lib/api/clients/profile";
import type { ProfileResponse } from "@/lib/api/contracts/profile";
import { profileWriteBodySchema } from "@/lib/api/contracts/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

interface ProfileData {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  summary: string;
}

interface ProfileFormProps {
  initialData?: Partial<ProfileData>;
  reviewKey?: number;
  onReviewResolved?: () => void;
}

type ProfileDataSource = {
  [Key in keyof ProfileData]?: ProfileData[Key] | null;
};

const EMPTY_PROFILE_DATA: ProfileData = {
  name: "",
  email: "",
  phone: "",
  location: "",
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  summary: "",
};

const PROFILE_FIELD_LABELS: Record<keyof ProfileData, string> = {
  name: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedinUrl: "LinkedIn URL",
  githubUrl: "GitHub URL",
  portfolioUrl: "Portfolio URL",
  summary: "Professional summary",
};

const toProfileData = (profile?: ProfileDataSource | null): ProfileData => ({
  name: profile?.name || "",
  email: profile?.email || "",
  phone: profile?.phone || "",
  location: profile?.location || "",
  linkedinUrl: profile?.linkedinUrl || "",
  githubUrl: profile?.githubUrl || "",
  portfolioUrl: profile?.portfolioUrl || "",
  summary: profile?.summary || "",
});

export function ProfileForm({
  initialData,
  reviewKey,
  onReviewResolved,
}: ProfileFormProps) {
  const queryClient = useQueryClient();
  const [originalData, setOriginalData] = useState<ProfileData | null>(null);
  const [formData, setFormData] = useState<ProfileData>(EMPTY_PROFILE_DATA);
  const hasHydratedRef = useRef(false);
  const appliedReviewKeyRef = useRef<number | null>(null);

  const { data: profile, error, isError, isLoading, isSuccess, refetch } = useQuery({
    queryKey: queryKeys.profile.detail(),
    queryFn: getProfile,
  });

  useEffect(() => {
    if (!isSuccess || hasHydratedRef.current) return;

    const data = toProfileData(profile);
    hasHydratedRef.current = true;
    setFormData(data);
    setOriginalData(data);
  }, [isSuccess, profile]);

  useEffect(() => {
    if (
      reviewKey === undefined ||
      !initialData ||
      !originalData ||
      appliedReviewKeyRef.current === reviewKey
    ) {
      return;
    }

    appliedReviewKeyRef.current = reviewKey;
    setFormData((current) => {
      const next = { ...current };
      for (const key of Object.keys(PROFILE_FIELD_LABELS) as Array<keyof ProfileData>) {
        const proposedValue = initialData[key];
        if (
          proposedValue !== undefined &&
          proposedValue !== originalData[key]
        ) {
          next[key] = proposedValue;
        }
      }
      return next;
    });
  }, [initialData, originalData, reviewKey]);

  const changedFieldKeys = useMemo(() => {
    if (!originalData) return [];
    return (Object.keys(PROFILE_FIELD_LABELS) as Array<keyof ProfileData>)
      .filter((key) => formData[key] !== originalData[key]);
  }, [formData, originalData]);
  const changedFields = changedFieldKeys.map((key) => PROFILE_FIELD_LABELS[key]);
  const hasUnsavedChanges = changedFields.length > 0;
  const validationErrors = useMemo(() => {
    const result = profileWriteBodySchema.safeParse(formData);
    if (result.success) return [];

    const errors = new Map<string, string>();
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field !== "string" || !(field in PROFILE_FIELD_LABELS)) continue;
      const label = PROFILE_FIELD_LABELS[field as keyof ProfileData];
      if (!errors.has(field)) errors.set(field, `${label}: ${issue.message}`);
    }
    return [...errors.values()];
  }, [formData]);
  const formIsValid = validationErrors.length === 0;

  const mutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: (savedProfile) => {
      const savedData = toProfileData(savedProfile);
      setFormData(savedData);
      setOriginalData(savedData);
      queryClient.setQueryData<ProfileResponse>(
        queryKeys.profile.detail(),
        (current) => current
          ? { ...current, ...savedProfile }
          : {
              ...savedProfile,
              skills: [],
              experience: [],
              education: [],
              resumes: [],
            }
      );
      void cacheOwnership.profileMutation(queryClient);
      toast.success("Basic information saved");
      if (reviewKey !== undefined) onReviewResolved?.();
    },
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to save profile"));
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasUnsavedChanges || !formIsValid) return;
    mutation.mutate(formData);
  };

  const handleRevert = () => {
    if (!originalData) return;
    setFormData(originalData);
    if (reviewKey !== undefined) onReviewResolved?.();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

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
            fallbackMessage="Basic profile information could not be loaded."
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
            <User className="h-5 w-5 text-blue-500" />
          </div>
          <CardTitle className="text-lg font-medium text-foreground">Basic Information</CardTitle>
        </div>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="john@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+1 (555) 123-4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Current Location</Label>
              <Input
                id="location"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="San Francisco, CA"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
              <Input
                id="linkedinUrl"
                name="linkedinUrl"
                value={formData.linkedinUrl}
                onChange={handleChange}
                placeholder="https://linkedin.com/in/..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="githubUrl">GitHub URL</Label>
              <Input
                id="githubUrl"
                name="githubUrl"
                value={formData.githubUrl}
                onChange={handleChange}
                placeholder="https://github.com/..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="portfolioUrl">Portfolio URL</Label>
              <Input
                id="portfolioUrl"
                name="portfolioUrl"
                value={formData.portfolioUrl}
                onChange={handleChange}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-2 mb-2">
            <Label htmlFor="summary">Professional Summary</Label>
            <Textarea
              id="summary"
              name="summary"
              value={formData.summary}
              onChange={handleChange}
              rows={4}
              placeholder="Briefly describe your professional background and career goals..."
            />
          </div>
        </CardContent>

        {hasUnsavedChanges ? (
          <CardFooter className="flex items-center justify-between border-t border-border bg-card px-6 py-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {changedFields.length} pending {changedFields.length === 1 ? "change" : "changes"}:{" "}
                {changedFields.join(", ")}
              </p>
              {validationErrors.length > 0 ? (
                <p role="alert" className="text-xs text-destructive">
                  Fix before saving: {validationErrors.join("; ")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleRevert}
                disabled={mutation.isPending}
              >
                <Undo2 data-icon="inline-start" />
                Revert
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !formIsValid}
                className="min-w-[120px] bg-blue-600 text-foreground hover:bg-blue-500"
              >
                {mutation.isPending ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {mutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
