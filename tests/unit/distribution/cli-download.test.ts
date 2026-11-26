import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { downloadVerifiedArchive } from "../../../packages/cli/src/download";

const bytes = Buffer.alloc(128 * 1024, "verified runtime fixture");
const sha256 = createHash("sha256").update(bytes).digest("hex");
let directory: string;
let destination: string;
let serve: (request: IncomingMessage, response: ServerResponse) => void;
let server: ReturnType<typeof createServer>;
let identity: { url: string; size: number; sha256: string };
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "switchy-download-"));
  destination = path.join(directory, "runtime.tar.gz");
  server = createServer((request, response) => serve(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  identity = { url: `http://127.0.0.1:${address.port}/runtime.tar.gz`, size: bytes.length, sha256 };
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function seedPartial(offset: number, overrides = {}) {
  await writeFile(`${destination}.part`, bytes.subarray(0, offset));
  await writeFile(`${destination}.part.json`, JSON.stringify({ ...identity, validator: '"fixture"', ...overrides }));
}

async function disconnectAfterWrite(response: ServerResponse, minimumSize: number) {
  const deadline = Date.now() + 2000;
  while (((await stat(`${destination}.part`).catch(() => null))?.size ?? 0) < minimumSize && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  response.destroy();
}

it("resumes an interrupted stream using Range and If-Range, then reuses the verified cache", async () => {
  const ranges: Array<string | undefined> = [];
  serve = (request, response) => {
    ranges.push(request.headers.range);
    if (ranges.length === 1) {
      response.writeHead(200, { "Content-Length": bytes.length, ETag: '"fixture"' });
      response.write(bytes.subarray(0, 8192));
      void disconnectAfterWrite(response, 8192);
    } else {
      const offset = Number(request.headers.range?.match(/bytes=(\d+)-/u)?.[1]);
      expect(offset).toBeGreaterThan(0);
      expect(request.headers["if-range"]).toBe('"fixture"');
      response.writeHead(206, { "Content-Length": bytes.length - offset, "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` });
      response.end(bytes.subarray(offset));
    }
  };
  await downloadVerifiedArchive(identity, destination);
  expect(await readFile(destination)).toEqual(bytes);
  expect(await readdir(directory)).toEqual(["runtime.tar.gz"]);
  expect(ranges).toHaveLength(2);
  await downloadVerifiedArchive(identity, destination);
  expect(ranges).toHaveLength(2);
});

it("restarts safely when the server ignores Range", async () => {
  await seedPartial(4096);
  serve = (request, response) => { expect(request.headers.range).toBe("bytes=4096-"); response.end(bytes); };
  await downloadVerifiedArchive(identity, destination);
  expect(await readFile(destination)).toEqual(bytes);
});

it.each(["range", "checksum", "size"])("rejects invalid %s and removes untrusted partial files", async (failure) => {
  await seedPartial(4096);
  serve = (_request, response) => {
    if (failure === "range") response.writeHead(206, { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` });
    if (failure === "size") response.setHeader("Content-Length", 1);
    response.end(failure === "checksum" ? Buffer.alloc(bytes.length) : bytes);
  };
  await expect(downloadVerifiedArchive(identity, destination)).rejects.toThrow(/range|checksum|size/u);
  expect(await readdir(directory)).toEqual([]);
});

it("retains an interrupted transfer after bounded retries and resumes on the next invocation", async () => {
  let requests = 0;
  serve = (request, response) => {
    requests++;
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/u)?.[1] ?? 0);
    response.writeHead(offset ? 206 : 200, {
      "Content-Length": bytes.length - offset,
      ...(offset ? { "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}),
    });
    response.write(bytes.subarray(offset, offset + 4096));
    void disconnectAfterWrite(response, offset + 4096);
  };
  await expect(downloadVerifiedArchive(identity, destination)).rejects.toThrow();
  expect(requests).toBe(3);
  expect((await readFile(`${destination}.part`)).length).toBeGreaterThan(0);
  serve = (request, response) => {
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/u)?.[1]);
    expect(offset).toBeGreaterThan(0);
    response.writeHead(206, { "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` });
    response.end(bytes.subarray(offset));
  };
  await downloadVerifiedArchive(identity, destination);
  expect(await readFile(destination)).toEqual(bytes);
});

it("retries transient HTTP failures and starts fresh for a changed artifact", async () => {
  await seedPartial(4096, { sha256: "0".repeat(64) });
  let requests = 0;
  serve = (request, response) => {
    expect(request.headers.range).toBeUndefined();
    if (++requests === 1) { response.writeHead(503); response.end(); }
    else response.end(bytes);
  };
  await downloadVerifiedArchive(identity, destination);
  expect(requests).toBe(2);
});

it("publishes a complete verified partial without another network request", async () => {
  await seedPartial(bytes.length);
  serve = () => { throw new Error("Unexpected network request"); };
  await downloadVerifiedArchive(identity, destination);
  expect(await readFile(destination)).toEqual(bytes);
});

it("falls back to a fresh transfer after a rejected range", async () => {
  await seedPartial(4096);
  let requests = 0;
  serve = (request, response) => {
    if (++requests === 1) {
      expect(request.headers.range).toBe("bytes=4096-");
      response.writeHead(416);
      response.end();
    } else {
      expect(request.headers.range).toBeUndefined();
      response.end(bytes);
    }
  };
  await downloadVerifiedArchive(identity, destination);
  expect(await readFile(destination)).toEqual(bytes);
});

it("replaces a corrupt cached archive and fails immediately on permanent HTTP errors", async () => {
  await writeFile(destination, Buffer.alloc(bytes.length));
  let requests = 0;
  serve = (_request, response) => { requests++; response.writeHead(404); response.end(); };
  await expect(downloadVerifiedArchive(identity, destination)).rejects.toThrow("404");
  expect(requests).toBe(1);
  expect(await readdir(directory)).toEqual([]);
});
