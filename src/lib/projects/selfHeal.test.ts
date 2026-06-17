/**
 * Self-heal tests (Task 4.5). Real container compile; the healer is a
 * deterministic mock standing in for the agent. AC: a broken edit triggers ≤3
 * fix attempts; success persists the repair; persistent failure surfaces the
 * error + a one-click undo (pre-edit version), edit left in place.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { makeUnifiedDiff } from "@/lib/agent/diff";
import type { FeedbackPoint } from "@/lib/llm";
import {
  PROJECT_FILENAMES,
  atomicWriteJson,
  createProject,
  getProjectDir,
} from "@/lib/storage";
import { applyEdit } from "./applyEdit";
import { selfHeal, type Healer } from "./selfHeal";
import { readVersionSource } from "./versions";

const exec = promisify(execFile);
async function imageReady() {
  try {
    await exec("docker", ["image", "inspect", "texlive/texlive:latest"]);
    return true;
  } catch {
    return false;
  }
}
const describeDocker = (await imageReady()) ? describe : describe.skip;

const GOOD = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Did stuff at ACME.",
  "\\end{document}",
  "",
].join("\n");

// A diff that injects an undefined control sequence (breaks compilation).
function breakingDiff(): string {
  const broken = GOOD.replace("Did stuff at ACME.", "\\undefinedmacro Did stuff at ACME.");
  return makeUnifiedDiff(GOOD, broken);
}

const POINT: FeedbackPoint = {
  id: "fp_1",
  category: "impact",
  severity: "high",
  anchor: { sectionId: "experience", sectionTitle: "Experience" },
  issue: "x",
  suggestion: "y",
  status: "open",
};

async function makeProject() {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-heal-"));
  const meta = await createProject({ name: "Heal", resumeTex: GOOD, dataRoot });
  await atomicWriteJson(
    join(getProjectDir(meta.id, dataRoot), PROJECT_FILENAMES.feedback),
    [POINT],
  );
  return { id: meta.id, dataRoot };
}

describeDocker("selfHeal (real container)", () => {
  it("recovers within ≤3 attempts when the healer fixes the source", async () => {
    // Healer removes the bad macro on the first attempt.
    const healer: Healer = vi.fn(async ({ brokenTex }) => brokenTex.replace("\\undefinedmacro ", ""));
    const broken = GOOD.replace("Did stuff at ACME.", "\\undefinedmacro Did stuff at ACME.");

    const res = await selfHeal({
      brokenTex: broken,
      initialError: { message: "Undefined control sequence.", line: 4, raw: "" },
      healer,
    });

    expect(res.healed).toBe(true);
    expect(res.source).not.toContain("\\undefinedmacro");
    expect(res.attempts.length).toBeLessThanOrEqual(3);
    expect(healer).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("gives up after 3 attempts when the healer can't fix it; edit left in place", async () => {
    // Healer returns the still-broken source every time.
    const healer: Healer = vi.fn(async ({ brokenTex }) => brokenTex);
    const broken = GOOD.replace("Did stuff at ACME.", "\\undefinedmacro Did stuff at ACME.");

    const res = await selfHeal({
      brokenTex: broken,
      initialError: { message: "Undefined control sequence.", line: 4, raw: "" },
      healer,
    });

    expect(res.healed).toBe(false);
    expect(res.source).toContain("\\undefinedmacro"); // edit left in place
    expect(res.attempts).toHaveLength(3);
    expect(res.finalError?.message).toBeTruthy();
    expect(healer).toHaveBeenCalledTimes(3);
  }, 90_000);
});

describeDocker("applyEdit with self-heal (real container)", () => {
  it("a breaking edit that self-heal fixes → compiled, addressed", async () => {
    const { id, dataRoot } = await makeProject();
    const healer: Healer = async ({ brokenTex }) => brokenTex.replace("\\undefinedmacro ", "");

    const res = await applyEdit({
      projectId: id,
      pointId: "fp_1",
      diff: breakingDiff(),
      acceptedHunks: [true],
      dataRoot,
      now: "2026-06-17T00:00:00Z",
      healer,
    });

    expect(res.compiled).toBe(true);
    expect(res.source).not.toContain("\\undefinedmacro");
    expect(res.healAttempts?.length).toBeGreaterThanOrEqual(1);
    expect(res.point.status).toBe("addressed");
    expect(res.undoVersion).toBeUndefined();
  }, 90_000);

  it("a breaking edit self-heal can't fix → error + undoVersion, point stays open", async () => {
    const { id, dataRoot } = await makeProject();
    const healer: Healer = async ({ brokenTex }) => brokenTex; // never fixes

    const res = await applyEdit({
      projectId: id,
      pointId: "fp_1",
      diff: breakingDiff(),
      acceptedHunks: [true],
      dataRoot,
      now: "2026-06-17T00:00:00Z",
      healer,
    });

    expect(res.compiled).toBe(false);
    expect(res.compileError?.message).toBeTruthy();
    expect(res.undoVersion).toBe(res.version); // one-click undo = pre-edit snapshot
    expect(res.point.status).toBe("open"); // not falsely addressed
    // The broken edit is left in place on disk...
    const onDisk = await readFile(join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.resumeTex), "utf8");
    expect(onDisk).toContain("\\undefinedmacro");
    // ...and the undo version restores the good source.
    expect(await readVersionSource(id, res.undoVersion!, dataRoot)).not.toContain("\\undefinedmacro");
  }, 120_000);
});
