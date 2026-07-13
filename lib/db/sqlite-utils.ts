export const DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE = 400;

export interface SqliteBusyRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export function chunkSqliteParameters<T>(
  values: readonly T[],
  chunkSize = DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE
): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("SQLite chunk size must be a positive integer.");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export function isSqliteBusyError(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth += 1
  ) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (
      candidate.code === "SQLITE_BUSY" ||
      candidate.code === "SQLITE_BUSY_SNAPSHOT"
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function withSqliteBusyRetry<T>(
  operation: () => T | Promise<T>,
  options: SqliteBusyRetryOptions
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries));
  const baseDelayMs = Math.max(0, options.baseDelayMs);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxRetries) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * (attempt + 1))
      );
    }
  }
}

export function createSqliteBusyRetry(options: SqliteBusyRetryOptions) {
  return <T>(operation: () => T | Promise<T>) =>
    withSqliteBusyRetry(operation, options);
}
