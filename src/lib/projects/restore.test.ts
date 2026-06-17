/**
 * restoreVersion tests (Task 4.6). Real container compile. AC: restore reverts
 * to a snapshot (snapshotting the current source first), recompiles, re-parses.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  PROJECT_FILENAMES,
  atomicWrite,
  createProject,
  getProjectDir,
} from "@/lib/storage";
import { readVersionIndex, restoreVersion, snapshotVersion } from "./versions";

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

const V1 = "\\documentclass{article}\\begin{document}Version one.\\end{document}\n";
const V2 = "\\documentclass{article}\\begin{document}Version two.\\end{document}\n";

async function makeProject() {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-restore-"));
  const meta = await createProject({ name: "Restore", resumeTex: V1, dataRoot });
  return { id: meta.id, dataRoot };
}

describeDocker("restoreVersion (real container)", () => {
  it("snapshots current, restores the target, recompiles, re-parses", async () => {
    const { id, dataRoot } = await makeProject();
    const dir = getProjectDir(id, dataRoot);
    const texPath = join(dir, PROJECT_FILENAMES.resumeTex);

    // Snapshot V1, then move on to V2 as the current source.
    const v1 = await snapshotVersion(id, V1, "v1", "2026-06-17T00:00:00Z", dataRoot);
    await atomicWrite(texPath, V2);

    // Restore V1.
    const res = await restoreVersion(id, v1, "2026-06-17T00:01:00Z", dataRoot);

    // Current source is V1 again.
    expect(res.source).toContain("Version one");
    expect(await readFile(texPath, "utf8")).toContain("Version one");
    // Recompiled to a real PDF.
    expect(res.compiled).toBe(true);
    const pdf = await readFile(join(dir, PROJECT_FILENAMES.resumePdf));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The pre-restore source (V2) was snapshotted first → restore is reversible.
    const index = await readVersionIndex(id, dataRoot);
    expect(index.some((e) => e.version === res.snapshotVersion)).toBe(true);
    expect(res.snapshotVersion).toBeGreaterThan(v1);
  }, 60_000);

  it("re-parses anchors from the restored source", async () => {
    const { id, dataRoot } = await makeProject();
    const withSection = "\\documentclass{article}\\begin{document}\\section{Skills}TS.\\end{document}\n";
    const v = await snapshotVersion(id, withSection, "has skills", "2026-06-17T00:00:00Z", dataRoot);
    const res = await restoreVersion(id, v, "2026-06-17T00:02:00Z", dataRoot);
    expect(res.sectionIds).toContain("skills");
  }, 60_000);
});
