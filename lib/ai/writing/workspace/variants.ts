import type { HistoryVariant } from "@/lib/ai/writing/types";

export function selectInitialVariantIndex(
  history: HistoryVariant[],
  requestedVariantId = 0
): number {
  if (history.length === 0) return 0;
  if (requestedVariantId) {
    const requested = history.findIndex((item) => item.id === requestedVariantId);
    if (requested >= 0) return requested;
  }
  for (let index = history.length - 1; index >= 0; index--) {
    if (!history[index]?.discardedAt) return index;
  }
  return history.length - 1;
}

export function selectAdjacentVariantIndex(
  history: HistoryVariant[],
  currentIndex: number,
  direction: "prev" | "next"
): number {
  const activeIndexes = history.flatMap((item, index) => item.discardedAt ? [] : [index]);
  if (activeIndexes.length === 0) return currentIndex;
  const currentPosition = activeIndexes.indexOf(currentIndex);
  if (currentPosition < 0) {
    return direction === "prev"
      ? activeIndexes[activeIndexes.length - 1]
      : activeIndexes[0];
  }
  const offset = direction === "prev" ? -1 : 1;
  return activeIndexes[
    (currentPosition + offset + activeIndexes.length) % activeIndexes.length
  ];
}
