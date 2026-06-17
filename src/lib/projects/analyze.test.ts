/**
 * analyzeResume tests (Task 2.5). Uses a fake LLMProvider whose
 * generateStructured returns a fixed ReviewResult — no live LLM. Verifies
 * id/status assignment, severity sort, unknown-section fallback, and that
 * feedback.json is persisted.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LLMProvider } from "@/lib/llm";
import { PROJECT_FILENAMES, createProject, getProjectDir } from "@/lib/storage";
import { analyzeResume, readFeedback, sortBySeverity } from "./analyze";

const RESUME = String.raw`\documentclass{article}
\begin{document}
\section{Experience}
Did stuff at a company.
\section{Skills}
TypeScript.
\end{document}`;

/** A provider that returns a canned ReviewResult regardless of input. */
function fakeProvider(points: unknown[]): LLMProvider {
  return {
    name: "claude",
    generateStructured: (async () => ({ points })) as LLMProvider["generateStructured"],
    runAgentTurn: async () => {
      throw new Error("not used");
    },
  };
}

async function makeProject(): Promise<{ id: string; dataRoot: string }> {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-analyze-"));
  const meta = await createProject({ name: "A", resumeTex: RESUME, dataRoot });
  return { id: meta.id, dataRoot };
}

describe("sortBySeverity", () => {
  it("orders critical → nit", () => {
    const mk = (severity: string) =>
      ({ severity, id: "x", category: "impact", anchor: { sectionId: "s", sectionTitle: "S" }, issue: "", suggestion: "", status: "open" }) as never;
    const sorted = sortBySeverity([mk("nit"), mk("critical"), mk("medium")]);
    expect(sorted.map((p) => p.severity)).toEqual(["critical", "medium", "nit"]);
  });
});

describe("analyzeResume", () => {
  it("assigns id/status, sorts by severity, and persists feedback.json", async () => {
    const { id, dataRoot } = await makeProject();
    const provider = fakeProvider([
      {
        category: "clarity",
        severity: "low",
        anchor: { sectionId: "skills", sectionTitle: "Skills" },
        issue: "Too terse.",
        suggestion: "Expand.",
      },
      {
        category: "impact",
        severity: "critical",
        anchor: { sectionId: "experience", sectionTitle: "Experience" },
        issue: "No metrics.",
        suggestion: "Quantify.",
      },
    ]);

    const points = await analyzeResume({ projectId: id, provider, dataRoot });

    expect(points).toHaveLength(2);
    expect(points[0]?.severity).toBe("critical"); // sorted
    expect(points[0]?.id).toMatch(/^fp_/);
    expect(points[0]?.status).toBe("open");

    // Persisted and re-readable.
    const onDisk = JSON.parse(
      await readFile(join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.feedback), "utf8"),
    );
    expect(onDisk).toHaveLength(2);
    const reread = await readFeedback(id, dataRoot);
    expect(reread[0]?.severity).toBe("critical");
  });

  it("falls back to the first section for an unknown sectionId", async () => {
    const { id, dataRoot } = await makeProject();
    const provider = fakeProvider([
      {
        category: "ats",
        severity: "high",
        anchor: { sectionId: "does-not-exist", sectionTitle: "Ghost" },
        issue: "x",
        suggestion: "y",
      },
    ]);
    const points = await analyzeResume({ projectId: id, provider, dataRoot });
    // Resolves to a real parsed section (experience is first in the resume).
    expect(["experience", "document"]).toContain(points[0]?.anchor.sectionId);
    expect(points[0]?.anchor.sectionId).not.toBe("does-not-exist");
  });
});
