/**
 * Agent healer tests (Task 4.5 wiring). The provider is a fake; verifies the
 * healer returns the model's corrected tex, gives up (null) on no-progress, and
 * gives up (null) when the provider throws (no token/key configured).
 */
import { describe, expect, it } from "vitest";

import type { LLMProvider } from "@/lib/llm";
import { makeAgentHealer } from "./healer";

const ERROR = { message: "Undefined control sequence.", line: 4, raw: "" };

function provider(impl: LLMProvider["generateStructured"]): LLMProvider {
  return {
    name: "claude",
    generateStructured: impl,
    runAgentTurn: async () => {
      throw new Error("n/a");
    },
  };
}

describe("makeAgentHealer", () => {
  it("returns the model's corrected tex", async () => {
    const healer = makeAgentHealer(
      provider((async () => ({ tex: "FIXED SOURCE" })) as LLMProvider["generateStructured"]),
    );
    const out = await healer({ brokenTex: "BROKEN", error: ERROR, attempt: 1 });
    expect(out).toBe("FIXED SOURCE");
  });

  it("gives up (null) when the model returns unchanged source", async () => {
    const healer = makeAgentHealer(
      provider((async () => ({ tex: "BROKEN" })) as LLMProvider["generateStructured"]),
    );
    const out = await healer({ brokenTex: "BROKEN", error: ERROR, attempt: 1 });
    expect(out).toBeNull();
  });

  it("gives up (null) when the provider throws (no token/key)", async () => {
    const healer = makeAgentHealer(
      provider((async () => {
        throw new Error("OpenAI selected but no API key is configured.");
      }) as LLMProvider["generateStructured"]),
    );
    const out = await healer({ brokenTex: "BROKEN", error: ERROR, attempt: 1 });
    expect(out).toBeNull();
  });
});
