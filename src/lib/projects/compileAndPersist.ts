/**
 * Compile a `.tex` source and persist the build outputs into a project dir
 * (spec §5/§11). Shared by project creation (Task 0.5) and the recompile
 * action (Task 1.2) so the "compile → write resume.pdf + compile.log" sequence
 * lives in exactly one place.
 *
 * On success: writes resume.pdf (atomic) + compile.log, returns compiled:true.
 * On failure: writes compile.log only (never a blank/stale PDF), returns the
 * parsed first error so the UI can surface it. The previously-compiled
 * resume.pdf is left untouched on failure, so the preview can fall back to it.
 */
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CompileService } from "@/lib/latex";
import type { LatexError } from "@/lib/latex";
import { PROJECT_FILENAMES, atomicWrite, getProjectDir } from "@/lib/storage";
import { getDataRoot } from "@/lib/storage";

export interface CompileAndPersistInput {
  projectId: string;
  tex: string;
  dataRoot?: string;
  compileService?: CompileService;
}

export interface CompileAndPersistResult {
  compiled: boolean;
  log: string;
  compileError?: LatexError;
}

export async function compileAndPersist(
  input: CompileAndPersistInput,
): Promise<CompileAndPersistResult> {
  const dataRoot = input.dataRoot ?? getDataRoot();
  const dir = getProjectDir(input.projectId, dataRoot);
  const svc = input.compileService ?? new CompileService();

  const result = await svc.compile({ tex: input.tex });

  // Always persist the log so a failed compile is inspectable.
  await atomicWrite(join(dir, PROJECT_FILENAMES.compileLog), result.log);

  if (result.ok && result.pdfPath) {
    const pdfBytes = await readFile(result.pdfPath);
    await atomicWrite(join(dir, PROJECT_FILENAMES.resumePdf), pdfBytes);
    await rm(dirname(result.pdfPath), { recursive: true, force: true }).catch(() => {});
    return { compiled: true, log: result.log };
  }

  return { compiled: false, log: result.log, compileError: result.firstError };
}
