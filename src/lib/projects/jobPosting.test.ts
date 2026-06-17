/**
 * Job-posting extraction tests (Task 3.1). Uses a fake provider so no live LLM
 * runs. Verifies: requirements are stored + re-readable; rawText is the user's
 * exact paste (not the model echo); arbitrary text doesn't crash extraction.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { JobRequirements, LLMProvider } from "@/lib/llm";
import { createProject } from "@/lib/storage";
import {
  extractAndStoreJobPosting,
  readJobRequirements,
} from "./jobPosting";

function fakeProvider(reqs: JobRequirements): LLMProvider {
  return {
    name: "claude",
    generateStructured: (async () => reqs) as LLMProvider["generateStructured"],
    runAgentTurn: async () => {
      throw new Error("not used");
    },
  };
}

const SAMPLE: JobRequirements = {
  mustHaveSkills: ["TypeScript", "React"],
  niceToHaveSkills: ["Rust"],
  yearsExperience: "5+ years",
  keywords: ["typescript", "react", "node", "aws"],
  responsibilities: ["Build the frontend"],
  rawText: "MODEL-ECHOED-TEXT", // should be overridden by the user's paste
};

async function makeProject(): Promise<{ id: string; dataRoot: string }> {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-jd-"));
  const meta = await createProject({ name: "A", dataRoot });
  return { id: meta.id, dataRoot };
}

describe("extractAndStoreJobPosting", () => {
  it("stores requirements and uses the user's exact rawText", async () => {
    const { id, dataRoot } = await makeProject();
    const userPaste = "We are hiring a Senior TypeScript Engineer...";
    const out = await extractAndStoreJobPosting({
      projectId: id,
      provider: fakeProvider(SAMPLE),
      rawText: userPaste,
      dataRoot,
    });

    expect(out.mustHaveSkills).toEqual(["TypeScript", "React"]);
    // rawText is the user's paste, NOT the model echo.
    expect(out.rawText).toBe(userPaste);

    const reread = await readJobRequirements(id, dataRoot);
    expect(reread?.keywords).toContain("aws");
    expect(reread?.rawText).toBe(userPaste);
  });

  it("returns null when no JD has been stored", async () => {
    const { id, dataRoot } = await makeProject();
    expect(await readJobRequirements(id, dataRoot)).toBeNull();
  });

  it("handles arbitrary/garbage text without crashing (provider yields valid shape)", async () => {
    const { id, dataRoot } = await makeProject();
    // Even nonsense input must produce a valid stored shape (the Zod-retry loop
    // guarantees the provider returns a valid JobRequirements or throws — here
    // the fake returns an empty-ish but valid one).
    const empty: JobRequirements = {
      mustHaveSkills: [],
      niceToHaveSkills: [],
      keywords: [],
      responsibilities: [],
      rawText: "",
    };
    const out = await extractAndStoreJobPosting({
      projectId: id,
      provider: fakeProvider(empty),
      rawText: "%%%@@@ not a real job posting 123 $$$",
      dataRoot,
    });
    expect(out.mustHaveSkills).toEqual([]);
    expect(out.rawText).toBe("%%%@@@ not a real job posting 123 $$$");
  });
});
