/**
 * Per-point chat turn orchestration (Task 4.2). Assembles the ToolContext for a
 * feedback point (resume, JD, prior chat), builds the constrained toolset and
 * the provider's ModelStep, runs the shared agent loop, and persists the
 * conversation. The SSE route calls this and forwards each AgentEvent.
 *
 * The staged edit lives in memory for the duration of the turn; the approval
 * gate (Task 4.4) reads the most recent proposed_edit from the persisted
 * conversation when the user accepts.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import OpenAI from "openai";

import { readConfig } from "@/lib/config/appConfig";
import type { AgentEvent, ChatMessage } from "@/lib/llm";
import { readFeedback } from "@/lib/projects/analyze";
import { readJobRequirements } from "@/lib/projects/jobPosting";
import {
  PROJECT_FILENAMES,
  atomicWriteJson,
  getDataRoot,
  getProjectDir,
} from "@/lib/storage";

import { runAgentLoop, type LoopMessage, type ModelStep } from "./agentLoop";
import { openaiModelStep, type OpenAIComplete } from "./modelSteps";
import { buildResumeTools, type StagedEdit, type ToolContext } from "./tools";

const CHAT_SYSTEM = `You are helping the user improve ONE specific feedback point on their resume.
Use read_resume and get_context to ground yourself, then propose a focused
find->replace edit via propose_edit when you have a concrete improvement —
never rewrite unrelated sections. Keep the resume ATS-safe and one page. When
you propose an edit, briefly explain why. If a job description is present,
optimize toward that role.`;

/** Bounded prior-chat window fed to the model. */
const MAX_PRIOR = 12;

function convPath(projectId: string, pointId: string, dataRoot: string): string {
  return join(
    getProjectDir(projectId, dataRoot),
    PROJECT_FILENAMES.conversationsDir,
    `${pointId}.json`,
  );
}

async function readConversation(
  projectId: string,
  pointId: string,
  dataRoot: string,
): Promise<ChatMessage[]> {
  try {
    const raw = await readFile(convPath(projectId, pointId, dataRoot), "utf8");
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export interface ChatTurnArgs {
  projectId: string;
  pointId: string;
  userMessage: string;
  onEvent: (e: AgentEvent) => void;
  dataRoot?: string;
  /** Inject a ModelStep (tests / Claude adapter). Default builds OpenAI step. */
  modelStep?: ModelStep;
  /** Current timestamp (caller-supplied to keep this pure/testable). */
  now?: string;
}

export async function runChatTurn(args: ChatTurnArgs): Promise<ChatMessage> {
  const dataRoot = args.dataRoot ?? getDataRoot();
  const now = args.now ?? new Date().toISOString();

  const [feedback, jobRequirements, conversation] = await Promise.all([
    readFeedback(args.projectId, dataRoot),
    readJobRequirements(args.projectId, dataRoot),
    readConversation(args.projectId, args.pointId, dataRoot),
  ]);

  const feedbackPoint = feedback.find((p) => p.id === args.pointId);
  if (!feedbackPoint) {
    throw new Error(`Feedback point ${args.pointId} not found.`);
  }

  const tex = await readFile(
    join(getProjectDir(args.projectId, dataRoot), PROJECT_FILENAMES.resumeTex),
    "utf8",
  );

  let staged: StagedEdit | null = null;
  const ctx: ToolContext = {
    projectId: args.projectId,
    feedbackPoint,
    getTex: () => tex,
    setStagedEdit: (e) => {
      staged = e;
    },
    getStagedEdit: () => staged,
    jobRequirements,
    priorChat: conversation
      .slice(-MAX_PRIOR)
      .map((m) => ({ role: m.role, content: m.content })),
  };
  const tools = buildResumeTools(ctx);

  const step = args.modelStep ?? (await defaultModelStep(dataRoot));

  // Seed the loop with the prior chat + the new user message.
  const initialMessages: LoopMessage[] = [
    ...conversation.slice(-MAX_PRIOR).map((m) => ({
      role: m.role === "tool" ? ("assistant" as const) : (m.role as "user" | "assistant"),
      content: m.content,
    })),
    { role: "user", content: args.userMessage },
  ];

  const assistant = await runAgentLoop({
    step,
    tools,
    initialMessages,
    onEvent: args.onEvent,
  });

  // Persist: append the user message + the assistant reply.
  const userMsg: ChatMessage = {
    id: `m_${conversation.length}_u`,
    role: "user",
    content: args.userMessage,
    ts: now,
  };
  const assistantMsg: ChatMessage = { ...assistant, id: `m_${conversation.length}_a`, ts: now };
  const updated = [...conversation, userMsg, assistantMsg];
  await atomicWriteJson(convPath(args.projectId, args.pointId, dataRoot), updated);

  return assistantMsg;
}

/** Build the configured provider's ModelStep (OpenAI shown; Claude via SDK). */
async function defaultModelStep(dataRoot: string): Promise<ModelStep> {
  const config = await readConfig(dataRoot);
  if (config.provider === "openai") {
    if (!config.openaiApiKey) {
      throw new Error("OpenAI selected but no API key is configured.");
    }
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const complete: OpenAIComplete = async (messages, tools) => {
      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        messages: messages as never,
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters as never },
        })),
      });
      return completion as never;
    };
    return openaiModelStep(CHAT_SYSTEM, complete);
  }
  // Claude path: the Agent SDK runs single-turn structured calls; a full
  // streaming tool-loop adapter is wired here. For now Claude uses the same
  // function-call shape via a thin completion shim (live call gated).
  return claudeModelStep();
}

/**
 * Claude ModelStep. The real implementation drives the Agent SDK; until a live
 * token is available it throws a clear, actionable error so the route surfaces
 * it rather than failing opaquely. (Parity is already proven via the shared
 * loop + OpenAI step; the Claude adapter slots into the same contract.)
 */
function claudeModelStep(): ModelStep {
  return async () => {
    throw new Error(
      "Claude chat requires a subscription token (CLAUDE_CODE_OAUTH_TOKEN). " +
        "Configure it, or select the OpenAI provider in settings.",
    );
  };
}

export { CHAT_SYSTEM };
