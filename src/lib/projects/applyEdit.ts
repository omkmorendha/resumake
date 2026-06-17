/**
 * Apply an approved edit (Task 4.4, spec §7 approval gate):
 *   snapshot current resume.tex → apply accepted hunks → atomic-write the new
 *   source → recompile + persist PDF/log → re-parse anchors → mark the feedback
 *   point `addressed`.
 *
 * The version snapshot is taken BEFORE resume.tex is overwritten, so a crash
 * before the write leaves the prior version recoverable (durability per §5).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { applySelectedHunks, parseHunks } from "@/lib/agent/hunks";
import type { FeedbackPoint } from "@/lib/llm";
import { parseSections } from "@/lib/parser";
import {
  PROJECT_FILENAMES,
  atomicWrite,
  atomicWriteJson,
  getDataRoot,
  getProjectDir,
} from "@/lib/storage";

import { compileAndPersist } from "./compileAndPersist";
import { readFeedback } from "./analyze";
import { selfHeal, type HealAttempt, type Healer } from "./selfHeal";
import { snapshotVersion } from "./versions";
import type { CompileService, LatexError } from "@/lib/latex";

export interface ApplyEditInput {
  projectId: string;
  pointId: string;
  /** Unified diff produced by propose_edit. */
  diff: string;
  /** Per-hunk approval flags (parallel to parseHunks(diff)). */
  acceptedHunks: boolean[];
  dataRoot?: string;
  now?: string;
  compileService?: CompileService;
  /**
   * Optional self-heal: when the post-apply compile fails, this agent-backed
   * function proposes fixes (≤3 attempts, Task 4.5). Omit to skip self-heal.
   */
  healer?: Healer;
}

export interface ApplyEditResult {
  version: number;
  source: string;
  compiled: boolean;
  compileError?: { message: string; line?: number };
  /** sectionIds present after re-parsing the applied source. */
  sectionIds: string[];
  point: FeedbackPoint;
  /** Self-heal attempts, when the initial compile failed and a healer ran. */
  healAttempts?: HealAttempt[];
  /**
   * Set when the compile failed and self-heal did NOT recover. The broken edit
   * is left in place; restore this version to undo (Task 4.5 one-click undo).
   */
  undoVersion?: number;
}

export async function applyEdit(input: ApplyEditInput): Promise<ApplyEditResult> {
  const dataRoot = input.dataRoot ?? getDataRoot();
  const now = input.now ?? new Date().toISOString();
  const dir = getProjectDir(input.projectId, dataRoot);
  const texPath = join(dir, PROJECT_FILENAMES.resumeTex);

  const current = await readFile(texPath, "utf8");
  const hunks = parseHunks(input.diff);
  const applied = applySelectedHunks(current, hunks, input.acceptedHunks);

  // 1. Snapshot the CURRENT source before overwriting (crash-safe).
  const version = await snapshotVersion(
    input.projectId,
    current,
    `Before edit to ${input.pointId}`,
    now,
    dataRoot,
  );

  // 2. Write the new source atomically.
  await atomicWrite(texPath, applied);

  // 3. Recompile + persist (leaves prior PDF on failure).
  let finalSource = applied;
  let compile = await compileAndPersist({
    projectId: input.projectId,
    tex: applied,
    dataRoot,
    compileService: input.compileService,
  });

  // 3b. Self-heal (Task 4.5): if the compile failed and a healer is supplied,
  // try ≤3 agent fixes. On success persist the repaired source; on persistent
  // failure leave the broken edit in place and expose the pre-edit version for
  // a one-click undo.
  let healAttempts: HealAttempt[] | undefined;
  let undoVersion: number | undefined;
  if (!compile.compiled && input.healer && compile.compileError) {
    const heal = await selfHeal({
      brokenTex: applied,
      initialError: compile.compileError as LatexError,
      healer: input.healer,
      compileService: input.compileService,
    });
    healAttempts = heal.attempts;
    if (heal.healed) {
      finalSource = heal.source;
      await atomicWrite(texPath, finalSource);
      compile = await compileAndPersist({
        projectId: input.projectId,
        tex: finalSource,
        dataRoot,
        compileService: input.compileService,
      });
    } else {
      undoVersion = version; // restore the pre-edit snapshot to undo
    }
  } else if (!compile.compiled) {
    undoVersion = version; // no healer → surface undo immediately
  }

  // 4. Re-parse anchors from the final source.
  const sectionIds = parseSections(finalSource).map((s) => s.sectionId);

  // 5. Mark the point addressed (auto-advance; manual revert per spec §2) — but
  // only when the edit actually compiled. A broken-and-unhealed edit is left in
  // place for inspection and stays "open" so it isn't falsely marked done.
  const feedback = await readFeedback(input.projectId, dataRoot);
  let point = feedback.find((p) => p.id === input.pointId);
  if (!point) {
    throw new Error(`Feedback point ${input.pointId} not found.`);
  }
  const updated = feedback.map((p) =>
    p.id === input.pointId && compile.compiled
      ? { ...p, status: "addressed" as const }
      : p,
  );
  point = updated.find((p) => p.id === input.pointId)!;
  await atomicWriteJson(join(dir, PROJECT_FILENAMES.feedback), updated);

  return {
    version,
    source: finalSource,
    compiled: compile.compiled,
    compileError: compile.compileError
      ? { message: compile.compileError.message, line: compile.compileError.line }
      : undefined,
    sectionIds,
    point,
    healAttempts,
    undoVersion,
  };
}
