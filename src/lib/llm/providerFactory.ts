/**
 * Construct the active LLMProvider from app config (Task 2.5). Claude is the
 * default; OpenAI is used only when selected AND a key is present. The OpenAI
 * key is read server-side from config.json and never leaves this module.
 */
import { readConfig } from "@/lib/config/appConfig";

import { ClaudeProvider } from "./claudeProvider";
import { OpenAIProvider } from "./openaiProvider";
import type { LLMProvider } from "./types";

export type ProviderName = "claude" | "openai";

export async function getProvider(
  override?: ProviderName,
  dataRoot?: string,
): Promise<LLMProvider> {
  const config = await readConfig(dataRoot);
  const name = override ?? config.provider;

  if (name === "openai") {
    if (!config.openaiApiKey) {
      throw new Error(
        "OpenAI provider selected but no API key is configured. Add one in settings.",
      );
    }
    return new OpenAIProvider({ apiKey: config.openaiApiKey });
  }
  return new ClaudeProvider();
}
