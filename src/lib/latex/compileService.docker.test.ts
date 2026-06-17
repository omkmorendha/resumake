/**
 * Integration test for {@link CompileService} — exercises a REAL compile
 * through the TeX Live container (Task 0.2 AC). Requires Docker + the
 * `texlive/texlive:latest` image; skipped automatically when unavailable so
 * CI without Docker stays green.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { CompileService } from "./compileService";

const exec = promisify(execFile);

async function dockerImageReady(): Promise<boolean> {
  try {
    await exec("docker", ["image", "inspect", "texlive/texlive:latest"]);
    return true;
  } catch {
    return false;
  }
}

const hasDocker = await dockerImageReady();
const describeDocker = hasDocker ? describe : describe.skip;

const VALID_TEX = String.raw`\documentclass{article}
\begin{document}
Hello from Resumake.
\end{document}
`;

const BROKEN_TEX = String.raw`\documentclass{article}
\begin{document}
\thisIsNotARealCommand
\end{document}
`;

describeDocker("CompileService (real TeX Live container)", () => {
  it("compiles a valid .tex to a non-empty PDF", async () => {
    const svc = new CompileService();
    const res = await svc.compile({ tex: VALID_TEX });
    expect(res.ok).toBe(true);
    expect(res.pdfPath).toBeTruthy();
    const pdf = await readFile(res.pdfPath as string);
    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 60_000);

  it("reports a parsed first error+line for a broken .tex", async () => {
    const svc = new CompileService();
    const res = await svc.compile({ tex: BROKEN_TEX });
    expect(res.ok).toBe(false);
    expect(res.firstError).toBeTruthy();
    expect(res.firstError?.line).toBeGreaterThan(0);
  }, 60_000);

  it("honors the timeout (kills a slow compile)", async () => {
    const svc = new CompileService({ timeoutMs: 1 });
    const res = await svc.compile({ tex: VALID_TEX });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
  }, 60_000);
});
