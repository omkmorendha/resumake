/**
 * Provider-agnostic agent loop (Task 4.2). Both Claude and OpenAI drive the
 * SAME loop here — they only differ in how a single model step is produced
 * (`ModelStep`). This guarantees provider parity by construction: the tool
 * contract, event emission, and turn termination are identical regardless of
 * backend.
 *
 * The loop: ask the model for a step → if it returns tool calls, execute each
 * via the constrained ResumeToolset (emitting tool_call / tool_result, and a
 * proposed_edit event when propose_edit succeeds) and feed the results back →
 * repeat until the model returns final text (or maxSteps is hit).
 */
import type { AgentEvent, ChatMessage, ResumeToolName, ToolResult } from "@/lib/llm";

import type { ResumeToolset } from "./tools";

/** A tool call the model wants to make. */
export interface ModelToolCall {
  id: string;
  name: ResumeToolName;
  input: unknown;
}

/** One model step: either a final text answer or a batch of tool calls. */
export type ModelStepResult =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: ModelToolCall[] };

/** Conversation entry fed back to the model between steps. */
export interface LoopMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present on tool messages: which call this answers. */
  toolCallId?: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ModelToolCall[];
}

export type ModelStep = (messages: LoopMessage[]) => Promise<ModelStepResult>;

export interface RunLoopArgs {
  step: ModelStep;
  tools: ResumeToolset;
  initialMessages: LoopMessage[];
  onEvent: (e: AgentEvent) => void;
  maxSteps?: number;
}

const TOOL_BY_NAME = (
  tools: ResumeToolset,
): Record<ResumeToolName, { execute: (i: unknown) => Promise<ToolResult> }> => ({
  read_resume: tools.read_resume,
  get_context: tools.get_context,
  propose_edit: tools.propose_edit,
  recompile: tools.recompile,
});

/**
 * Run the agent loop to completion. Returns the final assistant ChatMessage.
 * Emits AgentEvents as it goes (token text on the final answer, tool_call /
 * tool_result per call, proposed_edit when an edit is staged, error on failure).
 */
export async function runAgentLoop(args: RunLoopArgs): Promise<ChatMessage> {
  const maxSteps = args.maxSteps ?? 8;
  const messages: LoopMessage[] = [...args.initialMessages];
  const toolMap = TOOL_BY_NAME(args.tools);
  let lastProposedDiff: { diff: string; targetSectionId?: string; rationale: string } | undefined;

  for (let step = 0; step < maxSteps; step++) {
    const result = await args.step(messages);

    if (result.type === "text") {
      args.onEvent({ type: "token", text: result.text });
      const message: ChatMessage = {
        id: `m_${step}`,
        role: "assistant",
        content: result.text,
        ts: new Date(0).toISOString(), // stamped by caller; deterministic here
        proposedEdit: lastProposedDiff
          ? { diff: lastProposedDiff.diff, targetSectionId: lastProposedDiff.targetSectionId }
          : undefined,
      };
      args.onEvent({ type: "done", message });
      return message;
    }

    // Tool calls: record the assistant's request, execute each, feed results back.
    messages.push({ role: "assistant", content: "", toolCalls: result.calls });

    for (const call of result.calls) {
      args.onEvent({ type: "tool_call", tool: call.name, input: call.input });
      const tool = toolMap[call.name];
      let toolResult: ToolResult;
      if (!tool) {
        toolResult = { ok: false, error: `Unknown tool: ${call.name}` };
      } else {
        try {
          toolResult = await tool.execute(call.input);
        } catch (e) {
          toolResult = {
            ok: false,
            error: e instanceof Error ? e.message : "Tool execution failed.",
          };
        }
      }
      args.onEvent({ type: "tool_result", tool: call.name, result: toolResult });

      // A successful propose_edit emits a proposed_edit event for the approval UI.
      if (call.name === "propose_edit" && toolResult.ok) {
        const data = toolResult.data as {
          diff: string;
          sectionId?: string;
          rationale: string;
        };
        lastProposedDiff = {
          diff: data.diff,
          targetSectionId: data.sectionId,
          rationale: data.rationale,
        };
        args.onEvent({
          type: "proposed_edit",
          diff: data.diff,
          targetSectionId: data.sectionId,
          rationale: data.rationale,
        });
      }

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        toolCallId: call.id,
      });
    }
  }

  const message: ChatMessage = {
    id: "m_max",
    role: "assistant",
    content: "I've reached the step limit for this turn. Let me know how to proceed.",
    ts: new Date(0).toISOString(),
  };
  args.onEvent({ type: "done", message });
  return message;
}
