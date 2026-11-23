export function createAbortError(signal?: AbortSignal, fallbackMessage = "Operation cancelled"): DOMException {
  if (signal?.reason instanceof DOMException && signal.reason.name === "AbortError") {
    return signal.reason;
  }
  return new DOMException(signal?.reason instanceof Error ? signal.reason.message : fallbackMessage, "AbortError");
}
