"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { Loader2, Save, MapPin } from "lucide-react";

interface ProfileData {
  id?: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  preferredCountry: string;
  preferredCity: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  resumePath: string;
  summary: string;
}

interface ProfileFormProps {
  initialData?: Partial<ProfileData>;
}

export function ProfileForm({ initialData }: ProfileFormProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ProfileData>({
    name: "",
    email: "",
    phone: "",
    location: "",
    preferredCountry: "",
    preferredCity: "",
    linkedinUrl: "",
    githubUrl: "",
    portfolioUrl: "",
    resumePath: "",
    summary: "",
  });

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        name: profile.name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        location: profile.location || "",
        preferredCountry: profile.preferredCountry || "",
        preferredCity: profile.preferredCity || "",
        linkedinUrl: profile.linkedinUrl || "",
        githubUrl: profile.githubUrl || "",
        portfolioUrl: profile.portfolioUrl || "",
        resumePath: profile.resumePath || "",
        summary: profile.summary || "",
      });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      {/* Location Preferences Section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-medium text-zinc-200">Job Location Preferences</span>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Jobs matching your preferred location will be prioritized in your search results.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="preferredCountry">Preferred Country</Label>
            <Input
              id="preferredCountry"
              name="preferredCountry"
              value={formData.preferredCountry}
              onChange={handleChange}
              placeholder="United States"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferredCity">Preferred City</Label>
            <Input
              id="preferredCity"
              name="preferredCity"
              value={formData.preferredCity}
              onChange={handleChange}
              placeholder="San Francisco"
            />
          </div>
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

      <div className="space-y-2">
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

      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Profile
        </Button>
      </div>
    </form>
  );
}
