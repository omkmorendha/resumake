/**
 * OpenAI ModelStep tests (Task 4.2 parity). A fake `complete` replays
 * tool_calls then a final message; we drive the real shared loop with it and
 * assert the tool contract is honored (tools executed, edit staged, done).
 */
import { describe, expect, it } from "vitest";

import type { AgentEvent, FeedbackPoint } from "@/lib/llm";
import { runAgentLoop } from "./agentLoop";
import {
  openaiModelStep,
  type OpenAICompletion,
  type OpenAIComplete,
} from "./modelSteps";
import { buildResumeTools, type StagedEdit, type ToolContext } from "./tools";

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

function makeTools() {
  let staged: StagedEdit | null = null;
  const ctx: ToolContext = {
    projectId: "p1",
    feedbackPoint: POINT,
    getTex: () => TEX,
    setStagedEdit: (e) => (staged = e),
    getStagedEdit: () => staged,
    jobRequirements: null,
    priorChat: [],
  };
  return { tools: buildResumeTools(ctx), getStaged: () => staged };
}

/** A fake OpenAI `complete` that replays a fixed sequence of responses. */
function fakeComplete(responses: OpenAICompletion["choices"][number]["message"][]): OpenAIComplete {
  let i = 0;
  return async () => {
    const message = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return { choices: [{ message }] };
  };
}

describe("openaiModelStep + runAgentLoop (manual tool loop)", () => {
  it("executes a tool call then returns the final text", async () => {
    const complete = fakeComplete([
      {
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read_resume", arguments: "{}" } },
        ],
      },
      {
        content: null,
        tool_calls: [
          {
            id: "c2",
            type: "function",
            function: {
              name: "propose_edit",
              arguments: JSON.stringify({
                sectionId: "experience",
                find: "Did stuff at ACME.",
                replace: "Cut deploy time 40% at ACME.",
                rationale: "Add a metric.",
              }),
            },
          },
        ],
      },
      { content: "Proposed a quantified bullet.", tool_calls: undefined },
    ]);

    const { tools, getStaged } = makeTools();
    const events: AgentEvent[] = [];
    const message = await runAgentLoop({
      step: openaiModelStep("You are a resume coach.", complete),
      tools,
      initialMessages: [{ role: "user", content: "Strengthen this bullet." }],
      onEvent: (e) => events.push(e),
    });

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["tool_call", "tool_result", "proposed_edit", "done"]),
    );
    expect(getStaged()?.proposedTex).toContain("Cut deploy time 40%");
    expect(message.content).toMatch(/quantified/i);
    expect(message.proposedEdit?.diff).toBeTruthy();
  });

  it("ignores tool calls the agent isn't allowed to make", async () => {
    const complete = fakeComplete([
      {
        content: null,
        // A non-ResumeTool call (e.g. a hallucinated 'bash') is filtered out.
        tool_calls: [
          { id: "x", type: "function", function: { name: "bash", arguments: "{}" } },
        ],
      },
      { content: "Done.", tool_calls: undefined },
    ]);
    const { tools } = makeTools();
    const events: AgentEvent[] = [];
    await runAgentLoop({
      step: openaiModelStep("s", complete),
      tools,
      initialMessages: [{ role: "user", content: "x" }],
      onEvent: (e) => events.push(e),
    });
    // The disallowed call was filtered before execution → no tool_call event.
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(0);
  });
});
