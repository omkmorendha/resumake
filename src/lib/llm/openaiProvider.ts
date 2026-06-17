/**
 * OpenAIProvider — the secondary LLM backend (spec §6).
 *
 * `generateStructured` calls the OpenAI Chat Completions API in JSON mode and
 * validates the output through the shared Zod-retry loop, so Claude and OpenAI
 * honor an identical structured-output contract. The API key comes from
 * `config.json` (mode 0600) and is used server-side only — it is never sent to
 * the browser and never logged.
 *
 * `runAgentTurn` (the manual tool loop) is implemented in M4 (Task 4.2).
 */
import OpenAI from "openai";

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

export const OPENAI_MODEL = "gpt-4o";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  retry?: StructuredRetryOptions;
  /** Inject the raw generator (tests avoid live calls / a real key). */
  rawGenerate?: RawGenerate;
}

/** Build the default raw generator backed by the OpenAI SDK in JSON mode. */
function sdkRawGenerate(apiKey: string, model: string): RawGenerate {
  const client = new OpenAI({ apiKey });
  return async ({ system, user, previousError }) => {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildRetryUser(user, previousError) },
      ],
    });
    return completion.choices[0]?.message?.content ?? "";
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  private readonly model: string;
  private readonly retry?: StructuredRetryOptions;
  private readonly raw: RawGenerate;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.model = opts.model ?? OPENAI_MODEL;
    this.retry = opts.retry;
    if (opts.rawGenerate) {
      this.raw = opts.rawGenerate;
    } else {
      if (!opts.apiKey) {
        throw new Error(
          "OpenAIProvider requires an apiKey (from config.json) unless a rawGenerate override is supplied.",
        );
      }
      this.raw = sdkRawGenerate(opts.apiKey, this.model);
    }
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
    throw new Error("OpenAIProvider.runAgentTurn is implemented in M4 (Task 4.2).");
  }
}
