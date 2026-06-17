/**
 * Integration test for createProjectFromTex (Task 0.5 AC) — real container.
 * Skipped when Docker / the TeX Live image is unavailable.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createProjectFromTex } from "./createFromTex";
import { getProjectDir, PROJECT_FILENAMES } from "@/lib/storage";

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

const VALID_TEX = String.raw`\documentclass{article}
\begin{document}
A valid resume body.
\end{document}
`;

const BROKEN_TEX = String.raw`\documentclass{article}
\begin{document}
\undefinedMacroHere
\end{document}
`;

describeDocker("createProjectFromTex (real container)", () => {
  it("valid .tex → compiled PDF + log on disk", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "resumake-data-"));
    const res = await createProjectFromTex({
      name: "Valid",
      tex: VALID_TEX,
      dataRoot,
    });
    expect(res.compiled).toBe(true);

    const dir = getProjectDir(res.project.id, dataRoot);
    const pdf = await readFile(join(dir, PROJECT_FILENAMES.resumePdf));
    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const log = await readFile(join(dir, PROJECT_FILENAMES.compileLog), "utf8");
    expect(log.length).toBeGreaterThan(0);
  }, 60_000);

  it("invalid .tex → no PDF, parsed first-error+line in the log", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "resumake-data-"));
    const res = await createProjectFromTex({
      name: "Broken",
      tex: BROKEN_TEX,
      dataRoot,
    });
    expect(res.compiled).toBe(false);
    expect(res.compileError).toBeTruthy();
    expect(res.compileError?.line).toBeGreaterThan(0);

    const dir = getProjectDir(res.project.id, dataRoot);
    // log present, pdf absent
    const log = await readFile(join(dir, PROJECT_FILENAMES.compileLog), "utf8");
    expect(log.length).toBeGreaterThan(0);
    await expect(stat(join(dir, PROJECT_FILENAMES.resumePdf))).rejects.toThrow();
  }, 60_000);
});
