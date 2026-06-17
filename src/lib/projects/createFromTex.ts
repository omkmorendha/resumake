/**
 * Create a project from a `.tex` source, compile it, and persist the build
 * outputs into the project dir (Task 0.5, spec §5/§11).
 *
 * On a successful compile, `resume.pdf` is written alongside `resume.tex` and
 * the combined compiler output is saved to `compile.log`. On a failed compile
 * the project is still created (the user can fix and recompile) — only the
 * log + parsed first error are recorded, never a silently-blank PDF.
 */
import { CompileService } from "@/lib/latex";
import type { LatexError } from "@/lib/latex";
import {
  createProject,
  type CreateProjectInput,
  type ProjectMeta,
} from "@/lib/storage";
import { getDataRoot } from "@/lib/storage";

import { compileAndPersist } from "./compileAndPersist";

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

  const result = await compileAndPersist({
    projectId: project.id,
    tex: input.tex,
    dataRoot,
    compileService: input.compileService,
  });

  return {
    project,
    compiled: result.compiled,
    compileError: result.compileError,
  };
}
