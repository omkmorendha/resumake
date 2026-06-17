/**
 * Agent-loop tests (Task 4.2). The loop is provider-agnostic; we drive it with
 * scripted ModelStep functions standing in for Claude / OpenAI. Provider parity
 * is verified by running the SAME script through the loop with two different
 * step functions and asserting identical event sequences and tool execution.
 */
import { describe, expect, it } from "vitest";

import type { AgentEvent, FeedbackPoint } from "@/lib/llm";
import { runAgentLoop, type LoopMessage, type ModelStepResult } from "./agentLoop";
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
    setStagedEdit: (e) => {
      staged = e;
    },
    getStagedEdit: () => staged,
    jobRequirements: null,
    priorChat: [],
  };
  return { tools: buildResumeTools(ctx), getStaged: () => staged };
}

/** A scripted step function: returns the next item from `script` each call. */
function scriptedStep(script: ModelStepResult[]) {
  let i = 0;
  return async (_messages: LoopMessage[]): Promise<ModelStepResult> => {
    const next = script[Math.min(i, script.length - 1)]!;
    i++;
    return next;
  };
}

const SCRIPT: ModelStepResult[] = [
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
  { type: "text", text: "I proposed a quantified bullet — review the diff." },
];

async function run(script: ModelStepResult[]) {
  const { tools, getStaged } = makeTools();
  const events: AgentEvent[] = [];
  const message = await runAgentLoop({
    step: scriptedStep(script),
    tools,
    initialMessages: [{ role: "user", content: "Make this bullet stronger." }],
    onEvent: (e) => events.push(e),
  });
  return { events, message, getStaged };
}

describe("runAgentLoop", () => {
  it("executes tools, stages an edit, emits proposed_edit, and finishes", async () => {
    const { events, message, getStaged } = await run(SCRIPT);

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("proposed_edit");
    expect(types).toContain("done");

    // An edit was staged (no disk write).
    expect(getStaged()).not.toBeNull();
    expect(getStaged()!.proposedTex).toContain("Cut deploy time 40%");

    // The final message carries the proposed edit for the approval gate.
    expect(message.role).toBe("assistant");
    expect(message.proposedEdit?.diff).toBeTruthy();
  });

  it("surfaces a tool error as ok:false without aborting the loop", async () => {
    const badEdit: ModelStepResult[] = [
      {
        type: "tool_calls",
        calls: [
          {
            id: "c1",
            name: "propose_edit",
            input: { sectionId: "experience", find: "NOPE", replace: "x", rationale: "y" },
          },
        ],
      },
      { type: "text", text: "That text wasn't found; could you point me to the exact line?" },
    ];
    const { events, getStaged } = await run(badEdit);
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult && "result" in toolResult && toolResult.result.ok).toBe(false);
    expect(getStaged()).toBeNull(); // nothing staged on a failed edit
  });

  it("provider parity: two different step fns over the same script yield the same events", async () => {
    // "claude" and "openai" steps both replay the same scripted decisions.
    const claudeStep = scriptedStep(SCRIPT);
    const openaiStep = scriptedStep(SCRIPT);

    const claudeEvents: AgentEvent[] = [];
    const openaiEvents: AgentEvent[] = [];

    const t1 = makeTools();
    await runAgentLoop({
      step: claudeStep,
      tools: t1.tools,
      initialMessages: [{ role: "user", content: "x" }],
      onEvent: (e) => claudeEvents.push(e),
    });
    const t2 = makeTools();
    await runAgentLoop({
      step: openaiStep,
      tools: t2.tools,
      initialMessages: [{ role: "user", content: "x" }],
      onEvent: (e) => openaiEvents.push(e),
    });

    // Same event-type sequence and same tool-call order → identical contract.
    expect(claudeEvents.map((e) => e.type)).toEqual(openaiEvents.map((e) => e.type));
    const toolCalls = (evs: AgentEvent[]) =>
      evs.filter((e) => e.type === "tool_call").map((e) => (e as { tool: string }).tool);
    expect(toolCalls(claudeEvents)).toEqual(toolCalls(openaiEvents));
  });

  it("terminates at maxSteps if the model never finishes", async () => {
    const loop: ModelStepResult[] = [
      { type: "tool_calls", calls: [{ id: "c", name: "read_resume", input: {} }] },
    ];
    const events: AgentEvent[] = [];
    const { tools } = makeTools();
    const msg = await runAgentLoop({
      step: scriptedStep(loop),
      tools,
      initialMessages: [{ role: "user", content: "x" }],
      onEvent: (e) => events.push(e),
      maxSteps: 3,
    });
    expect(msg.content).toMatch(/step limit/i);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(3);
  });
});
