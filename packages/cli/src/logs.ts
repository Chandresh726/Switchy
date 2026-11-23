import { open, stat, truncate, writeFile } from "node:fs/promises";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_TAIL_BYTES = 256 * 1024;

export async function rotateLog(file: string): Promise<void> {
  if (((await stat(file).catch(() => null))?.size ?? 0) < MAX_LOG_BYTES) return;
  await writeFile(`${file}.1`, await readLogTail(file), { mode: 0o600 });
  await truncate(file, 0);
}

export async function readLogTail(file: string, lines = 200): Promise<string> {
  const handle = await open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return "";
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    // Drop the partial first line when reading a bounded suffix.
    return (size > length ? text.slice(text.indexOf("\n") + 1) : text).trimEnd().split("\n").slice(-lines).join("\n");
  } finally { await handle.close(); }
}
