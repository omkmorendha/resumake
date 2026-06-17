/**
 * Create a project from a `.tex` source, compile it, and persist the build
 * outputs into the project dir (Task 0.5, spec §5/§11).
 *
 * On a successful compile, `resume.pdf` is written alongside `resume.tex` and
 * the combined compiler output is saved to `compile.log`. On a failed compile
 * the project is still created (the user can fix and recompile) — only the
 * log + parsed first error are recorded, never a silently-blank PDF.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CompileService } from "@/lib/latex";
import type { LatexError } from "@/lib/latex";
import { atomicWrite } from "@/lib/storage";
import {
  PROJECT_FILENAMES,
  createProject,
  type CreateProjectInput,
  type ProjectMeta,
} from "@/lib/storage";
import { getProjectDir } from "@/lib/storage";
import { getDataRoot } from "@/lib/storage";

export interface CreateFromTexInput {
  name: string;
  tex: string;
  provider?: CreateProjectInput["provider"];
  id?: CreateProjectInput["id"];
  dataRoot?: string;
  /** Inject a compile service (tests pass a fake transport). */
  compileService?: CompileService;
}

export interface CreateFromTexResult {
  project: ProjectMeta;
  compiled: boolean;
  /** First LaTeX error when the compile failed. */
  compileError?: LatexError;
}

export async function createProjectFromTex(
  input: CreateFromTexInput,
): Promise<CreateFromTexResult> {
  const dataRoot = input.dataRoot ?? getDataRoot();

  const project = await createProject({
    name: input.name,
    provider: input.provider,
    id: input.id,
    resumeTex: input.tex,
    dataRoot,
  });

  const dir = getProjectDir(project.id, dataRoot);
  const svc = input.compileService ?? new CompileService();
  const result = await svc.compile({ tex: input.tex });

  // Always persist the log so a failed compile is inspectable.
  await atomicWrite(join(dir, PROJECT_FILENAMES.compileLog), result.log);

  if (result.ok && result.pdfPath) {
    // Read the compiled PDF (a stable temp copy from the service) and write it
    // into the project dir atomically. The temp copy is left for the OS to
    // reclaim — we don't depend on it after this point.
    const pdfBytes = await readFile(result.pdfPath);
    await atomicWrite(join(dir, PROJECT_FILENAMES.resumePdf), pdfBytes);
    return { project, compiled: true };
  }

  return { project, compiled: false, compileError: result.firstError };
}
