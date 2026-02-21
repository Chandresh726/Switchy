"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect, useMemo } from "react";
import { Loader2, Save, User } from "lucide-react";
import { toast } from "sonner";

interface ProfileData {
  id?: number;
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
}

export function ProfileForm({ initialData }: ProfileFormProps) {
  const queryClient = useQueryClient();
  const [originalData, setOriginalData] = useState<ProfileData | null>(null);
  const [formData, setFormData] = useState<ProfileData>({
    name: "",
    email: "",
    phone: "",
    location: "",
    linkedinUrl: "",
    githubUrl: "",
    portfolioUrl: "",
    summary: "",
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  // Update form when profile data is loaded
  useEffect(() => {
    if (profile) {
      const data = {
        name: profile.name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        location: profile.location || "",
        linkedinUrl: profile.linkedinUrl || "",
        githubUrl: profile.githubUrl || "",
        portfolioUrl: profile.portfolioUrl || "",
        summary: profile.summary || "",
      };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(data);
      setOriginalData(data);
    }
  }, [profile]);

  // Apply initialData when provided (from resume parsing)
  useEffect(() => {
    if (initialData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({
        ...prev,
        name: initialData.name || prev.name,
        email: initialData.email || prev.email,
        phone: initialData.phone || prev.phone,
        location: initialData.location || prev.location,
        linkedinUrl: initialData.linkedinUrl || prev.linkedinUrl,
        githubUrl: initialData.githubUrl || prev.githubUrl,
        portfolioUrl: initialData.portfolioUrl || prev.portfolioUrl,
        summary: initialData.summary || prev.summary,
      }));
    }
  }, [initialData]);

  const hasUnsavedChanges = useMemo(() => {
    if (!originalData) return false;
    return (
      formData.name !== originalData.name ||
      formData.email !== originalData.email ||
      formData.phone !== originalData.phone ||
      formData.location !== originalData.location ||
      formData.linkedinUrl !== originalData.linkedinUrl ||
      formData.githubUrl !== originalData.githubUrl ||
      formData.portfolioUrl !== originalData.portfolioUrl ||
      formData.summary !== originalData.summary
    );
  }, [formData, originalData]);

  const mutation = useMutation({
    mutationFn: async (data: ProfileData) => {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setOriginalData({
        name: data.name || "",
        email: data.email || "",
        phone: data.phone || "",
        location: data.location || "",
        linkedinUrl: data.linkedinUrl || "",
        githubUrl: data.githubUrl || "",
        portfolioUrl: data.portfolioUrl || "",
        summary: data.summary || "",
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Profile saved");
    },
    onError: () => {
      toast.error("Failed to save profile");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
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

        <CardFooter className="flex items-center justify-between border-t border-border bg-card px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {settingsSaved ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Changes saved successfully
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-amber-700 dark:text-amber-400">Unsaved changes</span>
            ) : (
              "Up to date"
            )}
          </p>
          <Button
            type="submit"
            disabled={mutation.isPending || !hasUnsavedChanges}
            className="bg-blue-600 hover:bg-blue-500 text-foreground min-w-[120px]"
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
