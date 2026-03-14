"use client";

import { useState } from "react";
import { Loader2, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CompanyAddPersonProps {
  companyId: number;
  companyName: string;
  onAdded: () => void;
}

export function CompanyAddPerson({ companyId, companyName, onAdded }: CompanyAddPersonProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    profileUrl: "",
    position: "",
    notes: "",
  });

  const canSubmit = form.fullName.trim().length > 0;

  const reset = () => {
    setForm({ fullName: "", email: "", profileUrl: "", position: "", notes: "" });
    setIsSubmitting(false);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    setOpen(nextOpen);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email || undefined,
          profileUrl: form.profileUrl || undefined,
          companyRaw: companyName,
          position: form.position || undefined,
          notes: form.notes || undefined,
          mappedCompanyId: companyId,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to add person");
      }

      toast.success(`Added ${form.fullName.trim()} to ${companyName}`);
      handleClose(false);
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add person");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserRoundPlus className="h-4 w-4" />
        Add Person
      </Button>

      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent>
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle className="text-sm">Add Person</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Add a person to {companyName}. They will be auto-mapped to this company.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cp-full-name" className="text-xs">
                Full Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="cp-full-name"
                value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="Jane Doe"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-email" className="text-xs">Email</Label>
              <Input
                id="cp-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="jane@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-position" className="text-xs">Position</Label>
              <Input
                id="cp-position"
                value={form.position}
                onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))}
                placeholder="Talent Partner"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cp-linkedin" className="text-xs">LinkedIn URL</Label>
              <Input
                id="cp-linkedin"
                value={form.profileUrl}
                onChange={(e) => setForm((p) => ({ ...p, profileUrl: e.target.value }))}
                placeholder="https://linkedin.com/in/..."
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cp-notes" className="text-xs">Notes</Label>
              <Textarea
                id="cp-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="min-h-16"
                placeholder="Context for future outreach"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <UserRoundPlus className="h-4 w-4" />
                  Add Person
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
