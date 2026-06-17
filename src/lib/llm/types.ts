/**
 * Provider abstraction (spec §6). Both Claude (Agent SDK / OAuth) and OpenAI
 * (API key) implement {@link LLMProvider}; the app speaks only this interface
 * so the two backends are interchangeable. Claude is the primary agentic path.
 */
import type { ZodSchema, ZodType } from "zod";

import type { ChatMessage } from "./schemas";

/** The four constrained tools the agent may call (spec §7). No FS/Bash. */
export type ResumeToolName =
  | "read_resume"
  | "get_context"
  | "propose_edit"
  | "recompile";

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export interface ResumeTool {
  name: ResumeToolName;
  description: string;
  inputSchema: ZodType<unknown>;
  execute: (input: unknown) => Promise<ToolResult>;
}

/** Events streamed from an agent turn to the browser over SSE (spec §6). */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; tool: ResumeToolName; input: unknown }
  | { type: "tool_result"; tool: ResumeToolName; result: ToolResult }
  | {
      type: "proposed_edit";
      diff: string;
      targetSectionId?: string;
      rationale: string;
    }
  | { type: "error"; message: string }
  | { type: "done"; message: ChatMessage };

export interface GenerateStructuredArgs<T> {
  system: string;
  user: string;
  schema: ZodSchema<T>;
}

export interface RunAgentTurnArgs {
  system: string;
  messages: ChatMessage[];
  tools: ResumeTool[];
  onEvent: (e: AgentEvent) => void;
}

export interface LLMProvider {
  /** Provider id, for diagnostics. */
  readonly name: "claude" | "openai";
  /**
   * Produce a value matching `schema`. Implementations retry on Zod-validation
   * failure (≤3, re-prompting with the error) before surfacing a failure.
   */
  generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<T>;
  /**
   * Run one agent turn with the constrained toolset, streaming AgentEvents.
   * Resolves with the final assistant ChatMessage. (Implemented in M4.)
   */
  runAgentTurn(args: RunAgentTurnArgs): Promise<ChatMessage>;
}

/** Thrown when generateStructured exhausts its retries. */
export class StructuredGenerationError extends Error {
  constructor(
    message: string,
    readonly rawOutput: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "StructuredGenerationError";
  }
}
