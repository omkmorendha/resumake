/**
 * OpenAIProvider + config tests (Task 2.3). Live OpenAI calls need a real key
 * (absent in CI), so generateStructured uses an injected raw generator. The
 * config.json 0600 mode and the server-only/never-exposed key invariant are
 * tested directly. A small parity check confirms both providers satisfy the
 * same structured contract via mocks.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  configMode,
  patchConfig,
  readConfig,
  toPublicConfig,
  writeConfig,
} from "@/lib/config/appConfig";
import { ClaudeProvider } from "./claudeProvider";
import { OpenAIProvider } from "./openaiProvider";

const Schema = z.object({ score: z.number(), label: z.string() });

describe("OpenAIProvider.generateStructured (mocked raw)", () => {
  it("returns a Zod-valid object", async () => {
    const provider = new OpenAIProvider({
      rawGenerate: async () => '{"score": 7, "label": "ok"}',
    });
    const out = await provider.generateStructured({
      system: "s",
      user: "u",
      schema: Schema,
    });
    expect(out).toEqual({ score: 7, label: "ok" });
  });

  it("requires an apiKey when no rawGenerate override is given", () => {
    expect(() => new OpenAIProvider({})).toThrow(/apiKey/);
  });

  it("runAgentTurn is deferred to M4", async () => {
    const provider = new OpenAIProvider({ rawGenerate: async () => "{}" });
    await expect(
      provider.runAgentTurn({ system: "", messages: [], tools: [], onEvent: () => {} }),
    ).rejects.toThrow(/M4/);
  });
});

describe("config.json (0600, server-only key)", () => {
  it("writes config 0600 and never exposes the key in the public projection", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "resumake-cfg-"));
    await writeConfig({ provider: "openai", openaiApiKey: "sk-secret" }, dataRoot);

    expect(await configMode(dataRoot)).toBe(0o600);

    const cfg = await readConfig(dataRoot);
    expect(cfg.openaiApiKey).toBe("sk-secret");

    const pub = toPublicConfig(cfg);
    expect(pub).toEqual({ provider: "openai", hasOpenaiKey: true });
    // The key value must not appear anywhere in the browser-facing projection.
    expect(JSON.stringify(pub)).not.toContain("sk-secret");
  });

  it("patchConfig preserves the existing key when only the provider changes", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "resumake-cfg-"));
    await writeConfig({ provider: "openai", openaiApiKey: "sk-keep" }, dataRoot);
    const next = await patchConfig({ provider: "claude" }, dataRoot);
    expect(next.provider).toBe("claude");
    expect(next.openaiApiKey).toBe("sk-keep");
    // On-disk file is still 0600 after the patch.
    expect(await configMode(dataRoot)).toBe(0o600);
  });

  it("defaults to claude/no-key when config.json is absent", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "resumake-cfg-"));
    const cfg = await readConfig(dataRoot);
    expect(cfg).toEqual({ provider: "claude", openaiApiKey: null });
  });
});

describe("provider parity (structured contract)", () => {
  it("Claude and OpenAI both return the same validated shape from equivalent JSON", async () => {
    const json = '{"score": 5, "label": "even"}';
    const claude = new ClaudeProvider({ rawGenerate: async () => json });
    const openai = new OpenAIProvider({ rawGenerate: async () => json });

    const args = { system: "s", user: "u", schema: Schema } as const;
    const a = await claude.generateStructured(args);
    const b = await openai.generateStructured(args);
    expect(a).toEqual(b);
    expect(a).toEqual({ score: 5, label: "even" });
  });
});
