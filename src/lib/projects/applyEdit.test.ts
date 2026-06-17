/**
 * applyEdit + versions tests (Task 4.4). The real-compile assertions are
 * Docker-gated; the snapshot/crash-recovery and addressed-marking logic run
 * without Docker. AC: approving an edit snapshots a version, applies it,
 * recompiles, re-parses anchors, marks the point addressed; a crash before the
 * resume.tex write recovers the prior version.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { makeUnifiedDiff } from "@/lib/agent/diff";
import type { FeedbackPoint } from "@/lib/llm";
import {
  PROJECT_FILENAMES,
  atomicWriteJson,
  createProject,
  getProjectDir,
} from "@/lib/storage";
import { applyEdit } from "./applyEdit";
import { readFeedback } from "./analyze";
import { readVersionIndex, readVersionSource, snapshotVersion } from "./versions";

const exec = promisify(execFile);
async function imageReady(): Promise<boolean> {
  try {
    await exec("docker", ["image", "inspect", "texlive/texlive:latest"]);
    return true;
  } catch {
    return false;
  }
}
const describeDocker = (await imageReady()) ? describe : describe.skip;

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Did stuff at ACME.",
  "\\end{document}",
  "",
].join("\n");

const POINT: FeedbackPoint = {
  id: "fp_1",
  category: "impact",
  severity: "high",
  anchor: { sectionId: "experience", sectionTitle: "Experience" },
  issue: "No metrics.",
  suggestion: "Quantify.",
  status: "open",
};

async function makeProject() {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-apply-"));
  const meta = await createProject({ name: "Apply", resumeTex: TEX, dataRoot });
  await atomicWriteJson(
    join(getProjectDir(meta.id, dataRoot), PROJECT_FILENAMES.feedback),
    [POINT],
  );
  return { id: meta.id, dataRoot };
}

function editDiff(): string {
  const after = TEX.replace("Did stuff at ACME.", "Cut deploy time 40% at ACME.");
  return makeUnifiedDiff(TEX, after);
}

describe("versions (snapshot + crash-safe index)", () => {
  it("snapshots write the .tex first; index rebuilds from disk if stale", async () => {
    const { id, dataRoot } = await makeProject();
    const v1 = await snapshotVersion(id, "V1 SOURCE", "first", "2026-06-17T00:00:00Z", dataRoot);
    expect(v1).toBe(1);
    expect(await readVersionSource(id, v1, dataRoot)).toBe("V1 SOURCE");

    // Simulate a crash that wrote the .tex but not the index: delete index.json.
    const { rm } = await import("node:fs/promises");
    await rm(join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.versionsIndex), { force: true });

    // readVersionIndex recovers the orphaned snapshot from disk.
    const index = await readVersionIndex(id, dataRoot);
    expect(index.map((e) => e.version)).toContain(1);

    // Next snapshot is numbered from disk, not the (missing) index → 2.
    const v2 = await snapshotVersion(id, "V2", "second", "2026-06-17T00:01:00Z", dataRoot);
    expect(v2).toBe(2);
  });
});

describeDocker("applyEdit (real container)", () => {
  it("snapshots, applies, recompiles, re-parses, and marks the point addressed", async () => {
    const { id, dataRoot } = await makeProject();

    const result = await applyEdit({
      projectId: id,
      pointId: "fp_1",
      diff: editDiff(),
      acceptedHunks: [true],
      dataRoot,
      now: "2026-06-17T00:00:00Z",
    });

    // Source applied.
    expect(result.source).toContain("Cut deploy time 40%");
    // Snapshotted the PRIOR version (the original).
    expect(result.version).toBe(1);
    expect(await readVersionSource(id, 1, dataRoot)).toContain("Did stuff at ACME.");
    // Compiled → PDF on disk.
    expect(result.compiled).toBe(true);
    const pdf = await readFile(join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.resumePdf));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Re-parsed anchors present.
    expect(result.sectionIds).toContain("experience");
    // Point auto-marked addressed (persisted).
    expect(result.point.status).toBe("addressed");
    const feedback = await readFeedback(id, dataRoot);
    expect(feedback.find((p) => p.id === "fp_1")?.status).toBe("addressed");
    // resume.tex on disk is the applied source.
    const onDisk = await readFile(join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.resumeTex), "utf8");
    expect(onDisk).toContain("Cut deploy time 40%");
  }, 60_000);
});
