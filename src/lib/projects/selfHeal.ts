/**
 * Self-heal compile loop (Task 4.5, spec §7). After an edit is applied and the
 * recompile FAILS, feed the LaTeX error to a healer (the agent) which returns a
 * fixed `.tex`; recompile; repeat ≤3 attempts. On success the repaired source
 * is persisted and the repair attempts are recorded. On persistent failure the
 * error is surfaced with a one-click undo (restore the pre-edit snapshot) — the
 * broken edit is LEFT IN PLACE so the user can inspect it.
 *
 * The healer is injected so the loop is testable without a live LLM. The route
 * supplies an agent-backed healer; tests supply a deterministic one.
 */
import { CompileService } from "@/lib/latex";
import type { LatexError } from "@/lib/latex";

export interface HealAttempt {
  attempt: number;
  error: { message: string; line?: number };
  /** The source the healer produced for this attempt. */
  candidate: string;
}

/** Given the failing source + error, return a candidate fix (or null to give up). */
export type Healer = (args: {
  brokenTex: string;
  error: LatexError;
  attempt: number;
}) => Promise<string | null>;

export interface SelfHealResult {
  healed: boolean;
  /** The final source: repaired (healed) or the broken edit (left in place). */
  source: string;
  attempts: HealAttempt[];
  /** Last error when not healed. */
  finalError?: { message: string; line?: number };
}

export interface SelfHealInput {
  brokenTex: string;
  initialError: LatexError;
  healer: Healer;
  maxAttempts?: number;
  compileService?: CompileService;
}

export async function selfHeal(input: SelfHealInput): Promise<SelfHealResult> {
  const maxAttempts = input.maxAttempts ?? 3;
  const svc = input.compileService ?? new CompileService();
  const attempts: HealAttempt[] = [];

  let currentTex = input.brokenTex;
  let currentError: LatexError = input.initialError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = await input.healer({
      brokenTex: currentTex,
      error: currentError,
      attempt,
    });
    if (candidate === null) {
      break; // healer gave up
    }

    attempts.push({
      attempt,
      error: { message: currentError.message, line: currentError.line },
      candidate,
    });

    const result = await svc.compile({ tex: candidate });
    if (result.ok) {
      return { healed: true, source: candidate, attempts };
    }
    // Carry the new error into the next attempt.
    currentTex = candidate;
    currentError = result.firstError ?? { message: "Compile failed.", raw: "" };
  }

  return {
    healed: false,
    source: input.brokenTex, // edit left in place
    attempts,
    finalError: { message: currentError.message, line: currentError.line },
  };
}
