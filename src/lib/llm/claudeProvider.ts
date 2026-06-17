/**
 * ClaudeProvider — the primary (agentic) LLM backend (spec §6).
 *
 * `generateStructured` runs a single-turn `query()` against the Claude Agent
 * SDK, collecting the final result text and validating it through the shared
 * Zod-retry loop. Authentication uses the subscription OAuth token
 * (`CLAUDE_CODE_OAUTH_TOKEN`); the spawned env explicitly UNSETS
 * `ANTHROPIC_API_KEY` so the SDK can't silently fall back to API billing
 * (the §6 footgun). Read/Edit/Bash and other built-ins are disallowed —
 * structured generation needs no tools, and the agent path (M4) will expose
 * only the four constrained ResumeTools.
 *
 * `runAgentTurn` is implemented in M4 (Task 4.2); it throws here so the
 * interface is satisfied without a half-built agent loop.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

import {
  buildRetryUser,
  generateStructuredWithRetry,
  type RawGenerate,
  type StructuredRetryOptions,
} from "./structuredRetry";
import type {
  GenerateStructuredArgs,
  LLMProvider,
  RunAgentTurnArgs,
} from "./types";
import type { ChatMessage } from "./schemas";

/** Model used for all Claude calls (spec defaults to the latest Opus). */
export const CLAUDE_MODEL = "claude-opus-4-8";

/** Built-in tools never available to this app's Claude calls (spec §6/§7). */
export const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
];

export interface ClaudeProviderOptions {
  model?: string;
  retry?: StructuredRetryOptions;
  /**
   * Override the raw generation step (tests inject a mock so no live call /
   * auth is needed). When omitted, the real Agent SDK `query()` is used.
   */
  rawGenerate?: RawGenerate;
}

/**
 * Build the spawned-process env for the SDK: inherit the host env but force
 * `ANTHROPIC_API_KEY` out so the subscription token is used, not API billing.
 */
export function buildClaudeEnv(
  base: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === "ANTHROPIC_API_KEY") continue; // drop the footgun
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** Warn (once) at startup if ANTHROPIC_API_KEY is present in the host env. */
export function warnIfApiKeyPresent(
  log: (msg: string) => void = console.warn,
): boolean {
  if (process.env.ANTHROPIC_API_KEY) {
    log(
      "[resumake] WARNING: ANTHROPIC_API_KEY is set. The Claude Agent SDK is " +
        "configured to ignore it (using your subscription token via " +
        "CLAUDE_CODE_OAUTH_TOKEN), but unset it to be safe — otherwise other " +
        "tools may bill against API credits instead of your subscription.",
    );
    return true;
  }
  return false;
}

/** The default raw generator: one single-turn agent query, no tools. */
function sdkRawGenerate(model: string): RawGenerate {
  return async ({ system, user, previousError }) => {
    const prompt = buildRetryUser(user, previousError);
    let result = "";
    for await (const message of query({
      prompt,
      options: {
        model,
        systemPrompt: system,
        disallowedTools: DISALLOWED_TOOLS,
        maxTurns: 1,
        env: buildClaudeEnv(),
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
      }
    }
    return result;
  };
}

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude" as const;
  private readonly model: string;
  private readonly retry?: StructuredRetryOptions;
  private readonly raw: RawGenerate;

  constructor(opts: ClaudeProviderOptions = {}) {
    this.model = opts.model ?? CLAUDE_MODEL;
    this.retry = opts.retry;
    this.raw = opts.rawGenerate ?? sdkRawGenerate(this.model);
  }

  async generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<T> {
    return generateStructuredWithRetry({
      system: args.system,
      user: args.user,
      schema: args.schema,
      raw: this.raw,
      options: this.retry,
    });
  }

  async runAgentTurn(_args: RunAgentTurnArgs): Promise<ChatMessage> {
    throw new Error("ClaudeProvider.runAgentTurn is implemented in M4 (Task 4.2).");
  }
}
