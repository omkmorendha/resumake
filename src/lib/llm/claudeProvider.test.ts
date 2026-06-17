/**
 * ClaudeProvider tests (Task 2.2). Live Agent SDK calls need a subscription
 * token (absent in CI), so generateStructured is exercised with an injected
 * raw generator (mock). The auth-footgun behavior (env drops ANTHROPIC_API_KEY;
 * startup warns) is tested directly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ClaudeProvider,
  buildClaudeEnv,
  warnIfApiKeyPresent,
} from "./claudeProvider";
import { StructuredGenerationError } from "./types";

const Schema = z.object({ score: z.number(), label: z.string() });

describe("ClaudeProvider.generateStructured (mocked raw)", () => {
  it("returns a Zod-valid object", async () => {
    const provider = new ClaudeProvider({
      rawGenerate: async () => '{"score": 9, "label": "strong"}',
    });
    const out = await provider.generateStructured({
      system: "review",
      user: "score this",
      schema: Schema,
    });
    expect(out).toEqual({ score: 9, label: "strong" });
  });

  it("retries then fails on persistently malformed output", async () => {
    const raw = vi.fn().mockResolvedValue('{"score": "NaN"}');
    const provider = new ClaudeProvider({
      rawGenerate: raw,
      retry: { onAttemptFailed: () => {} },
    });
    await expect(
      provider.generateStructured({ system: "s", user: "u", schema: Schema }),
    ).rejects.toBeInstanceOf(StructuredGenerationError);
    expect(raw).toHaveBeenCalledTimes(3);
  });

  it("runAgentTurn is deferred to M4", async () => {
    const provider = new ClaudeProvider({ rawGenerate: async () => "{}" });
    await expect(
      provider.runAgentTurn({ system: "", messages: [], tools: [], onEvent: () => {} }),
    ).rejects.toThrow(/M4/);
  });
});

describe("auth footgun handling", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("buildClaudeEnv drops ANTHROPIC_API_KEY but keeps others", () => {
    const env = buildClaudeEnv({
      ANTHROPIC_API_KEY: "sk-should-be-dropped",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-keep",
      PATH: "/usr/bin",
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-keep");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("warnIfApiKeyPresent warns when the key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-present";
    const msgs: string[] = [];
    const warned = warnIfApiKeyPresent((m) => msgs.push(m));
    expect(warned).toBe(true);
    expect(msgs[0]).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("warnIfApiKeyPresent is silent when the key is absent", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const msgs: string[] = [];
    const warned = warnIfApiKeyPresent((m) => msgs.push(m));
    expect(warned).toBe(false);
    expect(msgs).toHaveLength(0);
  });
});
