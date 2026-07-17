interface SignalStorage {
  run<T>(signal: AbortSignal, callback: () => Promise<T>): Promise<T>;
  getStore(): AbortSignal | undefined;
}

interface AsyncHooksModule {
  AsyncLocalStorage: new () => SignalStorage;
}

let signalStorage: SignalStorage | undefined;

function getSignalStorage(): SignalStorage {
  if (!signalStorage) {
    const asyncHooks = process.getBuiltinModule("node:async_hooks") as AsyncHooksModule;
    signalStorage = new asyncHooks.AsyncLocalStorage();
  }
  return signalStorage;
}

export function runWithScrapeSignal<T>(
  signal: AbortSignal,
  callback: () => Promise<T>
): Promise<T> {
  return getSignalStorage().run(signal, callback);
}

export function getActiveScrapeSignal(): AbortSignal | undefined {
  return getSignalStorage().getStore();
}

export function createScrapeAbortError(signal?: AbortSignal): DOMException {
  if (signal?.reason instanceof DOMException && signal.reason.name === "AbortError") {
    return signal.reason;
  }
  const message = signal?.reason instanceof Error
    ? signal.reason.message
    : "The scrape was cancelled";
  return new DOMException(message, "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function throwIfScrapeAborted(error?: unknown): void {
  const signal = getActiveScrapeSignal();
  if (signal?.aborted) throw createScrapeAbortError(signal);
  if (isAbortError(error)) throw error;
}

export function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined = getActiveScrapeSignal()
): Promise<void> {
  if (signal?.aborted) throw createScrapeAbortError(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createScrapeAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
