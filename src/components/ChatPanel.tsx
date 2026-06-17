"use client";

import { useCallback, useRef, useState } from "react";

import type { AgentEvent } from "@/lib/llm";
import { useEditorStore } from "@/lib/store/editorStore";

import { DiffModal } from "./DiffModal";

/**
 * Per-point chat (Tasks 4.2/4.3). Sends a message to the SSE chat route, parses
 * streamed AgentEvents, renders the conversation, and on a proposed_edit opens
 * the DiffModal for per-hunk approval. Approve calls /edits/apply (Task 4.4);
 * reject closes the modal and writes nothing.
 */

interface ChatLine {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
}

interface PendingEdit {
  diff: string;
  rationale: string;
  targetSectionId?: string;
}

export function ChatPanel({ pointId, onClose }: { pointId: string; onClose: () => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const setPdfUrl = useEditorStore((s) => s.setPdfUrl);
  const setSource = useEditorStore((s) => s.setSource);
  const markPersisted = useEditorStore((s) => s.markPersisted);

  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [applying, setApplying] = useState(false);
  const assistantBuf = useRef("");

  const send = useCallback(async () => {
    if (!projectId || input.trim() === "" || streaming) return;
    const userText = input.trim();
    setInput("");
    setLines((l) => [...l, { role: "user", text: userText }]);
    setStreaming(true);
    assistantBuf.current = "";

    try {
      const res = await fetch(`/api/projects/${projectId}/chat/${pointId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      if (!res.body) throw new Error("No response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.replace(/^data: /, "").trim();
          if (!line) continue;
          handleEvent(JSON.parse(line) as AgentEvent);
        }
      }
    } catch (e) {
      setLines((l) => [
        ...l,
        { role: "system", text: e instanceof Error ? e.message : "Chat failed." },
      ]);
    } finally {
      setStreaming(false);
    }
  }, [projectId, input, streaming, pointId]);

  function handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "token":
        assistantBuf.current += event.text;
        setLines((l) => {
          const last = l[l.length - 1];
          if (last?.role === "assistant") {
            return [...l.slice(0, -1), { role: "assistant", text: assistantBuf.current }];
          }
          return [...l, { role: "assistant", text: assistantBuf.current }];
        });
        break;
      case "tool_call":
        setLines((l) => [...l, { role: "tool", text: `→ ${event.tool}` }]);
        break;
      case "proposed_edit":
        setPendingEdit({
          diff: event.diff,
          rationale: event.rationale,
          targetSectionId: event.targetSectionId,
        });
        break;
      case "error":
        setLines((l) => [...l, { role: "system", text: event.message }]);
        break;
      default:
        break;
    }
  }

  const approve = useCallback(
    async (acceptedHunks: boolean[]) => {
      if (!projectId || !pendingEdit) return;
      setApplying(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/edits/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pointId,
            diff: pendingEdit.diff,
            acceptedHunks,
          }),
        });
        const body = (await res.json()) as {
          source?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          setLines((l) => [
            ...l,
            { role: "system", text: body.error?.message ?? "Apply failed." },
          ]);
          return;
        }
        if (body.source) {
          setSource(body.source);
          markPersisted(body.source);
        }
        setPdfUrl(`/api/projects/${projectId}/pdf?t=${Date.now()}`);
        setPendingEdit(null);
        setLines((l) => [...l, { role: "system", text: "Edit applied and recompiled." }]);
      } catch (e) {
        setLines((l) => [
          ...l,
          { role: "system", text: e instanceof Error ? e.message : "Apply failed." },
        ]);
      } finally {
        setApplying(false);
      }
    },
    [projectId, pendingEdit, pointId, setSource, markPersisted, setPdfUrl],
  );

  return (
    <div className="flex h-full flex-col border-t border-zinc-200 dark:border-zinc-800">
      <header className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-500">
        <span>Discussing this point</span>
        <button type="button" onClick={onClose} className="hover:text-zinc-800 dark:hover:text-zinc-200">
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-sm">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.role === "user"
                ? "text-zinc-900 dark:text-zinc-100"
                : line.role === "assistant"
                  ? "text-blue-700 dark:text-blue-300"
                  : line.role === "tool"
                    ? "text-[11px] text-zinc-400"
                    : "text-[11px] italic text-zinc-500"
            }
          >
            {line.text}
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <input
          aria-label="Chat message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={streaming}
          placeholder="Ask the agent to improve this point…"
          className="flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <button
          type="button"
          onClick={send}
          disabled={streaming || input.trim() === ""}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {pendingEdit && (
        <DiffModal
          diff={pendingEdit.diff}
          rationale={pendingEdit.rationale}
          applying={applying}
          onApprove={approve}
          onReject={() => setPendingEdit(null)}
        />
      )}
    </div>
  );
}
