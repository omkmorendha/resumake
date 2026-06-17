/**
 * Zod-retry policy tests (Task 2.4 AC): a forced-malformed mock retries 3×
 * then surfaces the failure and logs raw output; valid output short-circuits;
 * the model gets the prior error re-prompted.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  buildRetryUser,
  extractJson,
  generateStructuredWithRetry,
} from "./structuredRetry";
import { StructuredGenerationError } from "./types";

const Schema = z.object({ value: z.number() });

describe("extractJson", () => {
  it("parses fenced json", () => {
    expect(extractJson('```json\n{"value": 1}\n```')).toEqual({ value: 1 });
  });
  it("parses json embedded in prose", () => {
    expect(extractJson('Here you go: {"value": 2} cheers')).toEqual({ value: 2 });
  });
});

describe("generateStructuredWithRetry", () => {
  it("returns immediately on valid first output", async () => {
    const raw = vi.fn().mockResolvedValue('{"value": 42}');
    const out = await generateStructuredWithRetry({
      system: "s",
      user: "u",
      schema: Schema,
      raw,
    });
    expect(out).toEqual({ value: 42 });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it("retries 3× then throws StructuredGenerationError with raw output", async () => {
    const failed: { attempt: number; raw: string }[] = [];
    const raw = vi.fn().mockResolvedValue('{"value": "not-a-number"}');

    await expect(
      generateStructuredWithRetry({
        system: "s",
        user: "u",
        schema: Schema,
        raw,
        options: {
          onAttemptFailed: (info) => failed.push({ attempt: info.attempt, raw: info.raw }),
        },
      }),
    ).rejects.toBeInstanceOf(StructuredGenerationError);

    expect(raw).toHaveBeenCalledTimes(3);
    expect(failed).toHaveLength(3);
    expect(failed[2]?.raw).toContain("not-a-number");
  });

  it("re-prompts with the previous error and recovers on a later attempt", async () => {
    const seen: (string | undefined)[] = [];
    const raw = vi.fn().mockImplementation(async (a: { previousError?: string; attempt: number }) => {
      seen.push(a.previousError);
      return a.attempt < 2 ? "totally not json" : '{"value": 7}';
    });

    const out = await generateStructuredWithRetry({
      system: "s",
      user: "u",
      schema: Schema,
      raw,
      options: { onAttemptFailed: () => {} },
    });

    expect(out).toEqual({ value: 7 });
    expect(raw).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeTruthy(); // second attempt got the prior error
  });

  it("carries the StructuredGenerationError metadata", async () => {
    const raw = vi.fn().mockResolvedValue("garbage");
    try {
      await generateStructuredWithRetry({
        system: "s",
        user: "u",
        schema: Schema,
        raw,
        options: { maxAttempts: 2, onAttemptFailed: () => {} },
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredGenerationError);
      const err = e as StructuredGenerationError;
      expect(err.attempts).toBe(2);
      expect(err.rawOutput).toBe("garbage");
    }
  });
});

describe("buildRetryUser", () => {
  it("returns base when no prior error", () => {
    expect(buildRetryUser("base")).toBe("base");
  });
  it("appends the prior error and a JSON-only reminder", () => {
    const out = buildRetryUser("base", "- value: expected number");
    expect(out).toContain("base");
    expect(out).toContain("expected number");
    expect(out).toMatch(/ONLY a corrected JSON/i);
  });
});
