import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWrite, atomicWriteJson } from "./atomicWrite";

describe("atomicWrite", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "resumake-atomic-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a complete file", async () => {
    const target = join(dir, "feedback.json");
    await atomicWrite(target, "hello world");
    expect(await readFile(target, "utf8")).toBe("hello world");
  });

  it("creates missing parent directories", async () => {
    const target = join(dir, "nested", "deep", "feedback.json");
    await atomicWrite(target, "x");
    expect(await readFile(target, "utf8")).toBe("x");
  });

  it("overwrites an existing file in full", async () => {
    const target = join(dir, "feedback.json");
    await atomicWrite(target, "first-version-which-is-quite-long");
    await atomicWrite(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
  });

  it("leaves no .tmp files behind after a successful write", async () => {
    const target = join(dir, "feedback.json");
    await atomicWrite(target, "done");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    expect(entries).toContain("feedback.json");
  });

  it("atomicWriteJson serializes pretty JSON with trailing newline", async () => {
    const target = join(dir, "project.json");
    await atomicWriteJson(target, { a: 1, b: ["x"] });
    const raw = await readFile(target, "utf8");
    expect(raw).toBe(`${JSON.stringify({ a: 1, b: ["x"] }, null, 2)}\n`);
    expect(JSON.parse(raw)).toEqual({ a: 1, b: ["x"] });
  });

  /**
   * Core AC: under many concurrent writers to the SAME file, a reader (and the
   * final on-disk file) must NEVER observe a torn / interleaved payload. Because
   * each writer produces a distinct, self-describing payload, we can assert that
   * whatever lands on disk equals exactly one writer's payload — never a splice
   * of two.
   */
  it("never produces a torn feedback.json under concurrent writers", async () => {
    const target = join(dir, "feedback.json");

    // Distinct, large, content-keyed payloads. Size > a single fs page makes a
    // non-atomic implementation likely to tear (partial writes / interleaving).
    const N = 60;
    const writers = Array.from({ length: N }, (_, i) => {
      const tag = `writer-${String(i).padStart(3, "0")}`;
      // Each payload is internally consistent: every line repeats the same tag,
      // so any interleaving of two writers' bytes is detectable.
      const body = Array.from({ length: 4000 }, () => tag).join("\n");
      const payload = JSON.stringify({ tag, body });
      return { tag, payload };
    });

    const validPayloads = new Set(writers.map((w) => w.payload));

    // Fire all writes concurrently, and concurrently read mid-flight many times.
    const writePromises = writers.map((w) => atomicWrite(target, w.payload));

    const readResults: string[] = [];
    const readPromises = Array.from({ length: 200 }, async () => {
      try {
        const raw = await readFile(target, "utf8");
        readResults.push(raw);
      } catch {
        // ENOENT before the first rename lands is fine; ignore.
      }
    });

    await Promise.all([...writePromises, ...readPromises]);

    // Every intermediate read must be EXACTLY one writer's payload (never torn).
    for (const raw of readResults) {
      expect(validPayloads.has(raw)).toBe(true);
      // Double-check structural integrity: parses + single consistent tag.
      const parsed = JSON.parse(raw) as { tag: string; body: string };
      const lines = parsed.body.split("\n");
      expect(new Set(lines).size).toBe(1); // no interleaving of distinct tags
      expect(lines[0]).toBe(parsed.tag);
    }

    // The final file must also be exactly one complete writer's payload.
    const finalRaw = await readFile(target, "utf8");
    expect(validPayloads.has(finalRaw)).toBe(true);
  });

  it("default temp permissions do not widen on the final file", async () => {
    const target = join(dir, "feedback.json");
    await atomicWrite(target, "x");
    const s = await stat(target);
    // 0o600 requested on the temp file; final mode is at most owner-rw.
    expect(s.mode & 0o077).toBe(0);
  });
});
