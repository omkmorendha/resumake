/**
 * runChatTurn tests (Task 4.2): assembles context for a feedback point, runs
 * the loop with an injected ModelStep (no live LLM), streams events, and
 * persists the conversation. Verifies tool execution against the real on-disk
 * project and that the conversation file is appended.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentEvent, FeedbackPoint } from "@/lib/llm";
import { PROJECT_FILENAMES, atomicWriteJson, createProject, getProjectDir } from "@/lib/storage";

import { runChatTurn } from "./chatTurn";
import type { ModelStepResult } from "./agentLoop";

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Did stuff at ACME.",
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

async function makeProject() {
  const dataRoot = await mkdtemp(join(tmpdir(), "resumake-chat-"));
  const meta = await createProject({ name: "Chat", resumeTex: TEX, dataRoot });
  await atomicWriteJson(
    join(getProjectDir(meta.id, dataRoot), PROJECT_FILENAMES.feedback),
    [POINT],
  );
  return { id: meta.id, dataRoot };
}

function scriptedStep(script: ModelStepResult[]) {
  let i = 0;
  return async () => script[Math.min(i++, script.length - 1)]!;
}

describe("runChatTurn", () => {
  it("runs a turn, stages an edit, streams events, and persists the conversation", async () => {
    const { id, dataRoot } = await makeProject();
    const events: AgentEvent[] = [];

    const step = scriptedStep([
      { type: "tool_calls", calls: [{ id: "c1", name: "read_resume", input: {} }] },
      {
        type: "tool_calls",
        calls: [
          {
            id: "c2",
            name: "propose_edit",
            input: {
              sectionId: "experience",
              find: "Did stuff at ACME.",
              replace: "Cut deploy time 40% at ACME.",
              rationale: "Add a metric.",
            },
          },
        ],
      },
      { type: "text", text: "Proposed a quantified bullet." },
    ]);

    const assistant = await runChatTurn({
      projectId: id,
      pointId: "fp_1",
      userMessage: "Make this bullet stronger.",
      onEvent: (e) => events.push(e),
      dataRoot,
      modelStep: step,
      now: "2026-06-17T00:00:00.000Z",
    });

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["tool_call", "tool_result", "proposed_edit", "done"]),
    );
    expect(assistant.proposedEdit?.diff).toBeTruthy();

    // Conversation persisted: user message + assistant reply.
    const conv = JSON.parse(
      await readFile(
        join(getProjectDir(id, dataRoot), PROJECT_FILENAMES.conversationsDir, "fp_1.json"),
        "utf8",
      ),
    );
    expect(conv).toHaveLength(2);
    expect(conv[0].role).toBe("user");
    expect(conv[1].role).toBe("assistant");
  });

  it("throws a clear error for an unknown feedback point", async () => {
    const { id, dataRoot } = await makeProject();
    await expect(
      runChatTurn({
        projectId: id,
        pointId: "fp_missing",
        userMessage: "hi",
        onEvent: () => {},
        dataRoot,
        modelStep: scriptedStep([{ type: "text", text: "x" }]),
      }),
    ).rejects.toThrow(/not found/i);
  });
});
