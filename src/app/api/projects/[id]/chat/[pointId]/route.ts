import { NextResponse } from "next/server";

import type { AgentEvent } from "@/lib/llm";
import { runChatTurn } from "@/lib/agent/chatTurn";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseError(message: string, status: number) {
  return NextResponse.json({ error: { code: "CHAT_ERROR", message } }, { status });
}

/**
 * POST /api/projects/:id/chat/:pointId — run one agent turn for a feedback
 * point and stream AgentEvents as Server-Sent Events (spec §10). Body:
 * { message }. Each event is emitted as `data: <json>\n\n`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; pointId: string }> },
) {
  const { id, pointId } = await params;
  if (!isValidProjectId(id)) {
    return sseError("Invalid project id.", 400);
  }
  const meta = await readProject(id);
  if (!meta) {
    return sseError("Project not found.", 404);
  }

  let message: string | undefined;
  try {
    const body = (await req.json()) as { message?: string };
    message = body.message;
  } catch {
    return sseError("Could not parse request body.", 400);
  }
  if (typeof message !== "string" || message.trim() === "") {
    return sseError("A non-empty message is required.", 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runChatTurn({
          projectId: id,
          pointId,
          userMessage: message as string,
          onEvent: send,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Chat turn failed.";
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
