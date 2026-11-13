import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useResumeSectionReview } from "@/components/profile/use-resume-section-review";
import type { ResumeSectionReview } from "@/lib/profile/resume-review";

const review = (key: number) => ({
  key,
  review: {
    changes: ["React", "TypeScript"].map((name) => ({
      key: name,
      kind: "add" as const,
      currentId: null,
      value: { name },
      changedFields: [],
    })),
    unchangedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
  } satisfies ResumeSectionReview<{ name: string }>,
});

it("applies only accepted changes and resets dismissals for a new resume review", async () => {
  const onResolved = vi.fn();
  const apply = vi.fn().mockResolvedValue({ added: 1, updated: 0 });
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const { result, rerender } = renderHook(
    ({ reviewKey }) =>
      useResumeSectionReview({
        profileId: 7,
        section: "skills",
        review: review(reviewKey),
        onResolved,
        apply,
      }),
    {
      initialProps: { reviewKey: 1 },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  act(() => result.current.removePendingChange("React"));
  expect(onResolved).not.toHaveBeenCalled();
  act(() => result.current.applyReview());
  await waitFor(() => expect(onResolved).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenCalledWith([{ name: "TypeScript" }], 7);
  rerender({ reviewKey: 2 });
  expect(result.current.pendingChanges).toHaveLength(2);
  act(() => result.current.removePendingChange("React"));
  act(() => result.current.removePendingChange("TypeScript"));
  expect(onResolved).toHaveBeenCalledTimes(2);
  expect(result.current.pendingChanges).toHaveLength(0);
});
