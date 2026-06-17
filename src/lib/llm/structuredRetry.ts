/**
 * Zod-validated generation with bounded retries (spec §6, Task 2.4).
 *
 * Both providers produce structured output the same way: ask the model for
 * JSON, parse it against a Zod schema, and on failure re-prompt with the
 * validation error appended so the model can correct itself. After `maxAttempts`
 * (default 3) failures we throw {@link StructuredGenerationError} carrying the
 * last raw output for logging. Keeping this in one place guarantees Claude and
 * OpenAI honor identical retry semantics (the provider-parity contract).
 */
import type { ZodSchema } from "zod";

import { StructuredGenerationError } from "./types";

/**
 * A single raw model call. Given the (possibly error-augmented) user prompt,
 * return the model's raw text output. The retry loop owns parsing/validation.
 */
export type RawGenerate = (args: {
  system: string;
  user: string;
  /** The validation error from the previous attempt, if any (for re-prompting). */
  previousError?: string;
  attempt: number;
}) => Promise<string>;

export interface StructuredRetryOptions {
  maxAttempts?: number;
  /** Hook for logging each failed attempt's raw output (default: console.warn). */
  onAttemptFailed?: (info: { attempt: number; error: string; raw: string }) => void;
}

/** Extract the first JSON object/array from a model response (handles code fences). */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  // Find the first {...} or [...] span to tolerate prose around the JSON.
  const start = candidate.search(/[{[]/);
  if (start === -1) return JSON.parse(candidate); // let JSON.parse throw a clear error
  const end = matchingBracketEnd(candidate, start);
  const slice = end === -1 ? candidate.slice(start) : candidate.slice(start, end + 1);
  return JSON.parse(slice);
}

/**
 * Index of the bracket that closes the one at `open`, accounting for nesting
 * and string literals (so braces inside strings don't throw off the count).
 * Returns -1 if unbalanced.
 */
function matchingBracketEnd(s: string, open: number): number {
  const openCh = s[open];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export async function generateStructuredWithRetry<T>(args: {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  raw: RawGenerate;
  options?: StructuredRetryOptions;
}): Promise<T> {
  const maxAttempts = args.options?.maxAttempts ?? 3;
  const onFailed =
    args.options?.onAttemptFailed ??
    ((info) =>
      console.warn(
        `[generateStructured] attempt ${info.attempt} failed: ${info.error}`,
      ));

  let previousError: string | undefined;
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastRaw = await args.raw({
      system: args.system,
      user: args.user,
      previousError,
      attempt,
    });

    let parsedJson: unknown;
    try {
      parsedJson = extractJson(lastRaw);
    } catch (e) {
      previousError = `Output was not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`;
      onFailed({ attempt, error: previousError, raw: lastRaw });
      continue;
    }

    const result = args.schema.safeParse(parsedJson);
    if (result.success) {
      return result.data;
    }

    previousError = result.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    onFailed({ attempt, error: previousError, raw: lastRaw });
  }

  throw new StructuredGenerationError(
    `Failed to produce schema-valid output after ${maxAttempts} attempts. Last error:\n${previousError}`,
    lastRaw,
    maxAttempts,
  );
}

/**
 * Build the user prompt for a retry attempt: the base prompt, plus the prior
 * validation error and a reminder to emit only valid JSON when correcting.
 */
export function buildRetryUser(base: string, previousError?: string): string {
  if (!previousError) return base;
  return [
    base,
    "",
    "Your previous response failed schema validation with these errors:",
    previousError,
    "",
    "Return ONLY a corrected JSON value that satisfies the schema. No prose, no code fences.",
  ].join("\n");
}
