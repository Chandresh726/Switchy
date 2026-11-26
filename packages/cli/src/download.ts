import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

import { CLI_VERSION } from "./config.js";
import { readJsonFile, writeJsonFileAtomic } from "./files.js";
import { trackUpdateStage } from "./update-progress.js";
import type { ProgressReporter } from "./update-progress.js";

interface DownloadIdentity { url: string; size: number; sha256: string }
interface PartialDownload extends DownloadIdentity { validator?: string }

class RetryableDownloadError extends Error {
  constructor(message: string, readonly retryAfter = 0) { super(message); }
}

function retryable(error: unknown): boolean {
  if (error instanceof RetryableDownloadError) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return error.name === "AbortError" || error.name === "TimeoutError"
    || (error instanceof TypeError && /fetch|terminated/iu.test(error.message))
    || Boolean(code && /^(?:ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_.*)$/u.test(code));
}

async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Cache verified archives and retain interrupted transfers across CLI restarts. */
export async function downloadVerifiedArchive(
  identity: DownloadIdentity,
  destination: string,
  report?: ProgressReporter
): Promise<void> {
  const partial = `${destination}.part`;
  const record = `${partial}.json`;
  const discard = async () => { await Promise.all([rm(partial, { force: true }), rm(record, { force: true })]); };
  const cached = await stat(destination).catch(() => null);
  if (cached?.size === identity.size
    && await trackUpdateStage("verify", report, () => digest(destination)) === identity.sha256) return;
  await rm(destination, { force: true });
  const saved = await readJsonFile<PartialDownload>(record);
  if (!saved || saved.url !== identity.url || saved.size !== identity.size || saved.sha256 !== identity.sha256) await discard();
  const deadline = Date.now() + 300_000;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response | undefined;
    let metadata = await readJsonFile<PartialDownload>(record);
    let offset = (await stat(partial).catch(() => null))?.size ?? 0;
    if (offset > identity.size) { await discard(); offset = 0; metadata = null; }
    try {
      // A complete transfer may have been interrupted just before publication.
      if (offset === identity.size) {
        if (await trackUpdateStage("verify", report, () => digest(partial)) !== identity.sha256) throw new Error("Runtime checksum verification failed");
        await rename(partial, destination);
        await rm(record, { force: true });
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RetryableDownloadError("Runtime download timed out");
      response = await fetch(identity.url, {
        headers: {
          "User-Agent": `switchy-cli/${CLI_VERSION}`,
          "Accept-Encoding": "identity",
          ...(offset > 0 ? { Range: `bytes=${offset}-`, ...(metadata?.validator ? { "If-Range": metadata.validator } : {}) } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(remaining),
      });
      const cancel = () => response?.body?.cancel().catch(() => {});
      if (response.status === 429 || response.status >= 500) {
        await cancel();
        const value = response.headers.get("retry-after");
        const retryAfter = value === null ? 0 : /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
        throw new RetryableDownloadError(`Runtime download failed with ${response.status}`, Number.isFinite(retryAfter) ? Math.max(0, Math.min(30_000, retryAfter)) : 0);
      }
      if (response.status === 416 && offset > 0) {
        await cancel();
        await discard();
        throw new RetryableDownloadError("Restarting an unavailable download range");
      }
      if (![200, 206].includes(response.status) || !response.body) {
        await cancel();
        throw new Error(`Runtime download failed with ${response.status}`);
      }
      if (response.status === 200) offset = 0; // Server ignored Range or If-Range changed.
      const range = response.headers.get("content-range");
      if (response.status === 206 && range !== `bytes ${offset}-${identity.size - 1}/${identity.size}`) {
        await cancel();
        throw new Error("Runtime download returned an invalid byte range");
      }
      const length = response.headers.get("content-length");
      if (length !== null && Number(length) !== identity.size - offset) {
        await cancel();
        throw new Error("Runtime download size does not match the release manifest");
      }
      const etag = response.headers.get("etag");
      const validator = etag && !etag.startsWith("W/") ? etag : response.headers.get("last-modified") ?? undefined;
      await writeJsonFileAtomic(record, { ...identity, validator });
      const hash = createHash("sha256");
      if (offset > 0) for await (const chunk of createReadStream(partial)) hash.update(chunk);
      let downloaded = offset;
      let lastReported = 0;
      await report?.({ stage: "download", completedBytes: downloaded, totalBytes: identity.size });
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloaded += chunk.length;
          if (downloaded > identity.size) { callback(new Error("Runtime download exceeded its declared size")); return; }
          hash.update(chunk);
          if (report && Date.now() - lastReported >= 1000) {
            lastReported = Date.now();
            report({ stage: "download", completedBytes: downloaded, totalBytes: identity.size }).then(() => callback(null, chunk), callback);
          } else callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), meter,
        createWriteStream(partial, { flags: offset > 0 ? "a" : "w", mode: 0o600 })
      );
      if (downloaded !== identity.size) throw new RetryableDownloadError("Runtime download was interrupted");
      await trackUpdateStage("verify", report, async () => {
        if (hash.digest("hex") !== identity.sha256) throw new Error("Runtime checksum verification failed");
      });
      await rename(partial, destination);
      await rm(record, { force: true });
      return;
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      if (!retryable(error)) { await discard(); throw error; }
      const backoff = error instanceof RetryableDownloadError ? error.retryAfter : 0;
      const wait = Math.max(backoff, 250 * 2 ** attempt + Math.random() * 100);
      if (attempt === 2 || Date.now() + wait >= deadline) throw error;
      await delay(wait);
    }
  }
}
