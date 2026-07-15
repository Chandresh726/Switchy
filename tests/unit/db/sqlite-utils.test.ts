import { describe, expect, it, vi } from "vitest";

import {
  chunkSqliteParameters,
  isSqliteBusyError,
  loadSqliteParameterChunks,
  withSqliteBusyRetry,
} from "@/lib/db/sqlite-utils";

describe("SQLite utilities", () => {
  it("chunks parameters without dropping identity or ordering", () => {
    const values = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const chunks = chunkSqliteParameters(values, 2);

    expect(chunks).toEqual([[values[0], values[1]], [values[2]]]);
    expect(chunks[0]?.[0]).toBe(values[0]);
    expect(() => chunkSqliteParameters(values, 0)).toThrow(RangeError);
  });

  it("loads more parameters than one SQLite-safe chunk in stable order", async () => {
    const values = Array.from({ length: 1_001 }, (_, index) => index + 1);
    const load = vi.fn(async (chunk: number[]) => chunk.map((value) => `row-${value}`));

    const rows = await loadSqliteParameterChunks(values, load);

    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map(([chunk]) => chunk.length)).toEqual([400, 400, 201]);
    expect(rows).toHaveLength(1_001);
    expect(rows[0]).toBe("row-1");
    expect(rows.at(-1)).toBe("row-1001");
  });

  it("detects wrapped SQLite busy errors but not unrelated failures", () => {
    expect(
      isSqliteBusyError({ cause: { cause: { code: "SQLITE_BUSY_SNAPSHOT" } } })
    ).toBe(true);
    expect(isSqliteBusyError(Object.assign(new Error("no"), { code: "EINVAL" }))).toBe(
      false
    );
  });

  it("retries only transient busy failures with linear backoff", async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }))
      .mockRejectedValueOnce(
        Object.assign(new Error("busy snapshot"), {
          cause: { code: "SQLITE_BUSY_SNAPSHOT" },
        })
      )
      .mockResolvedValue("done");

    const result = withSqliteBusyRetry(operation, {
      maxRetries: 2,
      baseDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);

    await expect(result).resolves.toBe("done");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-SQLite errors", async () => {
    const error = new Error("invalid query");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      withSqliteBusyRetry(operation, { maxRetries: 4, baseDelayMs: 0 })
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
