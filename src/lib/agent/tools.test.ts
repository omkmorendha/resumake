/**
 * Constrained-tool tests (Task 4.1). Each tool validates input via Zod and
 * returns a ToolResult. propose_edit stages a diff without writing to disk.
 * The "agent cannot invoke FS/shell tools" half of the AC is enforced by the
 * provider's DISALLOWED_TOOLS (asserted here) and by OpenAI only exposing
 * these four (Task 4.2).
 */
import { describe, expect, it } from "vitest";

import type { FeedbackPoint } from "@/lib/llm";
import { buildResumeTools, type StagedEdit, type ToolContext } from "./tools";
import { makeUnifiedDiff } from "./diff";

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Did stuff at ACME.",
  "\\section{Skills}",
  "TypeScript.",
  "\\end{document}",
  "",
].join("\n");

const POINT: FeedbackPoint = {
  id: "fp_1",
  category: "impact",
  severity: "high",
  anchor: { sectionId: "experience", sectionTitle: "Experience" },
  issue: "No metrics.",
  suggestion: "Quantify.",
  status: "open",
};

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  let staged: StagedEdit | null = null;
  return {
    projectId: "p1",
    feedbackPoint: POINT,
    getTex: () => TEX,
    setStagedEdit: (e) => {
      staged = e;
    },
    getStagedEdit: () => staged,
    jobRequirements: null,
    priorChat: [],
    ...overrides,
  };
}

describe("makeUnifiedDiff", () => {
  it("produces a hunk with the changed line", () => {
    const before = "line one\nline two\nline three\n";
    const after = "line one\nline TWO\nline three\n";
    const diff = makeUnifiedDiff(before, after);
    expect(diff).toContain("-line two");
    expect(diff).toContain("+line TWO");
    expect(diff).toMatch(/^@@ /m);
  });
});

describe("read_resume", () => {
  it("returns tex + parsed section tree", async () => {
    const { read_resume } = buildResumeTools(makeCtx());
    const res = await read_resume.execute();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { tex: string; sections: { sectionId: string }[] };
      expect(data.tex).toContain("Experience");
      expect(data.sections.map((s) => s.sectionId)).toContain("experience");
    }
  });
});

describe("get_context", () => {
  it("returns the feedback point, section text, and prior chat", async () => {
    const { get_context } = buildResumeTools(
      makeCtx({ priorChat: [{ role: "user", content: "help" }] }),
    );
    const res = await get_context.execute({ sectionId: "experience" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        feedbackPoint: FeedbackPoint;
        section: { text: string } | null;
        priorChat: unknown[];
      };
      expect(data.feedbackPoint.id).toBe("fp_1");
      expect(data.section?.text).toContain("ACME");
      expect(data.priorChat).toHaveLength(1);
    }
  });

  it("rejects a non-object input via Zod", async () => {
    const { get_context } = buildResumeTools(makeCtx());
    await expect(get_context.execute(42)).rejects.toThrow();
  });
});

describe("propose_edit", () => {
  it("stages a diff without writing, and find-miss returns ok:false", async () => {
    let staged: StagedEdit | null = null;
    const { propose_edit } = buildResumeTools(
      makeCtx({ setStagedEdit: (e) => (staged = e), getStagedEdit: () => staged }),
    );

    const ok = await propose_edit.execute({
      sectionId: "experience",
      find: "Did stuff at ACME.",
      replace: "Cut deploy time 40% at ACME.",
      rationale: "Add a metric.",
    });
    expect(ok.ok).toBe(true);
    expect(staged).not.toBeNull();
    expect(staged!.proposedTex).toContain("Cut deploy time 40%");
    expect(staged!.diff).toContain("+");

    const miss = await propose_edit.execute({
      sectionId: "experience",
      find: "TEXT THAT DOES NOT EXIST",
      replace: "x",
      rationale: "y",
    });
    expect(miss.ok).toBe(false);
  });

  it("rejects missing required fields via Zod", async () => {
    const { propose_edit } = buildResumeTools(makeCtx());
    await expect(propose_edit.execute({ sectionId: "experience" })).rejects.toThrow();
  });
});

describe("provider tool constraints (FS/shell excluded)", () => {
  it("ClaudeProvider disallows Read/Edit/Bash/Write/etc.", async () => {
    const { DISALLOWED_TOOLS } = await import("@/lib/llm/claudeProvider");
    for (const banned of ["Bash", "Read", "Edit", "Write"]) {
      expect(DISALLOWED_TOOLS).toContain(banned);
    }
  });
});
