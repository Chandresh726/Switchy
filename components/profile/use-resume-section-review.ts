"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { applyResumeSection } from "@/lib/api/clients/profile";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type { ResumeSectionReview } from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

interface ResumeSectionReviewOptions<T> {
  profileId: number | null;
  section: "skills" | "experience" | "education";
  review?: { key: number; review: ResumeSectionReview<T> };
  onResolved?: () => void;
  apply: (
    items: T[],
    profileId: number,
  ) => ReturnType<typeof applyResumeSection>;
}

export const useResumeSectionReview = <T>({
  profileId,
  section,
  review,
  onResolved,
  apply,
}: ResumeSectionReviewOptions<T>) => {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<{
    reviewKey: number | null;
    keys: string[];
  }>({ reviewKey: null, keys: [] });
  const keys = dismissed.reviewKey === review?.key ? dismissed.keys : [];
  const pendingChanges =
    review?.review.changes.filter(({ key }) => !keys.includes(key)) ?? [];
  const mutation = useMutation({
    mutationFn: (items: T[]) => {
      if (!profileId)
        throw new Error(`Save the profile before applying ${section}`);
      return apply(items, profileId);
    },
    onSuccess: (result) => {
      void cacheOwnership.profileMutation(
        queryClient,
        queryKeys.profile[section](profileId),
      );
      toast.success(
        `${section.charAt(0).toUpperCase() + section.slice(1)} updated: ${result.added} added, ${result.updated} updated`,
      );
      onResolved?.();
    },
    onError: (error) =>
      toast.error(
        getApiErrorMessage(error, `Failed to apply resume ${section}`),
      ),
  });
  return {
    pendingChanges,
    isPending: mutation.isPending,
    applyReview: () => {
      if (pendingChanges.length > 0)
        mutation.mutate(pendingChanges.map(({ value }) => value));
    },
    revertReview: () => {
      setDismissed({ reviewKey: null, keys: [] });
      onResolved?.();
    },
    removePendingChange: (key: string) => {
      setDismissed({ reviewKey: review?.key ?? null, keys: [...keys, key] });
      if (pendingChanges.filter((change) => change.key !== key).length === 0)
        onResolved?.();
    },
  };
};
