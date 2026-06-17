/**
 * Per-provider ModelStep adapters (Task 4.2). Each turns one round of the
 * shared agent loop into a provider call. Both are injectable (a `client` /
 * `complete` function) so the loop is testable without live auth.
 *
 * OpenAI: a manual function-tool loop — ResumeTools become function tools;
 * `tool_calls` in the response map to ModelToolCall[]; otherwise the text
 * content is the final answer.
 *
 * Claude: the Agent SDK can run tools itself, but to preserve PARITY (same loop,
 * same events) we expose the four tools as function-style calls and let the
 * shared loop execute them. The Claude step is provided as a thin adapter over
 * a `complete` function that returns text-or-toolcalls — the ClaudeProvider
 * wires the real SDK; tests inject a fake.
 */
import { z } from "zod";

import type { ResumeToolName } from "@/lib/llm";

import type { LoopMessage, ModelStep, ModelStepResult } from "./agentLoop";
import {
  GetContextInput,
  ProposeEditInput,
  ReadResumeInput,
  RecompileInput,
} from "./tools";

/** JSON-schema tool definitions shared by both providers. */
export function toolDefinitions() {
  const defs: { name: ResumeToolName; description: string; parameters: unknown }[] = [
    { name: "read_resume", description: "Return the resume LaTeX + section tree.", parameters: z.toJSONSchema(ReadResumeInput) },
    { name: "get_context", description: "Return the feedback point, JD, target section text, and prior chat.", parameters: z.toJSONSchema(GetContextInput) },
    { name: "propose_edit", description: "Stage a find->replace edit (shows a diff to approve; no disk write).", parameters: z.toJSONSchema(ProposeEditInput) },
    { name: "recompile", description: "Compile the staged-or-current resume; return errors.", parameters: z.toJSONSchema(RecompileInput) },
  ];
  return defs;
}

/** OpenAI chat-completions message shape (minimal). */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}
export interface OpenAICompletion {
  choices: { message: { content: string | null; tool_calls?: OpenAIToolCall[] } }[];
}

/** A function that performs one OpenAI chat.completions call. */
export type OpenAIComplete = (
  messages: OpenAIMessage[],
  tools: ReturnType<typeof toolDefinitions>,
) => Promise<OpenAICompletion>;

const RESUME_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_resume",
  "get_context",
  "propose_edit",
  "recompile",
]);

function toOpenAIMessages(system: string, messages: LoopMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
    } else if (m.role === "assistant" && m.toolCalls) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function openaiModelStep(system: string, complete: OpenAIComplete): ModelStep {
  const tools = toolDefinitions();
  return async (messages: LoopMessage[]): Promise<ModelStepResult> => {
    const completion = await complete(toOpenAIMessages(system, messages), tools);
    const choice = completion.choices[0]?.message;
    const calls = choice?.tool_calls ?? [];
    if (calls.length > 0) {
      return {
        type: "tool_calls",
        calls: calls
          .filter((c) => RESUME_TOOL_NAMES.has(c.function.name))
          .map((c) => ({
            id: c.id,
            name: c.function.name as ResumeToolName,
            input: safeParse(c.function.arguments),
          })),
      };
    }
    return { type: "text", text: choice?.content ?? "" };
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
