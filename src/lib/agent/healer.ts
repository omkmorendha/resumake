/**
 * Agent-backed self-heal healer (Task 4.5 wiring). Given a broken `.tex` and a
 * LaTeX error, asks the provider for a corrected full document via
 * generateStructured. Built from the configured provider so the /edits/apply
 * route can pass a real healer; when no provider token/key is configured the
 * provider call throws an actionable error (the route surfaces it, falling back
 * to error+undo without auto-healing).
 *
 * Returns the corrected source, or null to give up (so selfHeal can stop early).
 */
import { z } from "zod";

import type { LatexError } from "@/lib/latex";
import type { LLMProvider } from "@/lib/llm";

import type { Healer } from "@/lib/projects/selfHeal";

const HealOutput = z.object({ tex: z.string().min(1) });

const HEAL_SYSTEM = `You fix LaTeX compilation errors. Given a resume's LaTeX source and the first
compiler error, return the smallest change that makes it compile while
preserving all content and structure. Do not rewrite or restructure the
document — fix only what breaks compilation (undefined commands, unbalanced
braces/environments, bad math, missing packages). Return the FULL corrected
document.`;

function buildHealUser(brokenTex: string, error: LatexError, attempt: number): string {
  return [
    `Attempt ${attempt}. The document failed to compile with this error:`,
    `${error.message}${error.line ? ` (line ${error.line})` : ""}`,
    "",
    "Current source:",
    "```latex",
    brokenTex,
    "```",
    "",
    'Return ONLY JSON: { "tex": "<the full corrected LaTeX document>" }',
  ].join("\n");
}

/** Build a Healer from a provider. */
export function makeAgentHealer(provider: LLMProvider): Healer {
  return async ({ brokenTex, error, attempt }) => {
    try {
      const result = await provider.generateStructured({
        system: HEAL_SYSTEM,
        user: buildHealUser(brokenTex, error, attempt),
        schema: HealOutput,
      });
      // If the model returns the unchanged source, treat it as no-progress.
      if (result.tex.trim() === brokenTex.trim()) return null;
      return result.tex;
    } catch {
      // Provider unavailable (no token/key) or generation failed → give up so
      // the apply flow surfaces error + one-click undo.
      return null;
    }
  };
}

export { HEAL_SYSTEM };
