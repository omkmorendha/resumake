"use client";

import { useMemo, useState } from "react";

import { parseHunks } from "@/lib/agent/hunks";

/**
 * Diff approval modal (Task 4.3). Renders a proposed edit as a reviewable
 * unified diff with per-hunk approve/reject checkboxes. Reject (or close)
 * writes nothing. Approve sends the accepted-hunk selection to the parent,
 * which applies it via /edits/apply (Task 4.4).
 */
export function DiffModal({
  diff,
  rationale,
  applying,
  onApprove,
  onReject,
}: {
  diff: string;
  rationale: string;
  applying: boolean;
  onApprove: (acceptedHunks: boolean[]) => void;
  onReject: () => void;
}) {
  const hunks = useMemo(() => parseHunks(diff), [diff]);
  const [accepted, setAccepted] = useState<boolean[]>(() => hunks.map(() => true));

  const anyAccepted = accepted.some(Boolean);

  return (
    <div
      role="dialog"
      aria-label="Review proposed edit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Proposed edit</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{rationale}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
          {hunks.length === 0 && (
            <p className="text-zinc-500">No changes to display.</p>
          )}
          {hunks.map((hunk, i) => (
            <div
              key={i}
              className="mb-3 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800"
            >
              <label className="flex items-center gap-2 bg-zinc-50 px-2 py-1 text-[11px] dark:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={accepted[i] ?? false}
                  onChange={(e) =>
                    setAccepted((prev) => {
                      const next = [...prev];
                      next[i] = e.target.checked;
                      return next;
                    })
                  }
                  data-hunk-index={i}
                />
                <span>Hunk {i + 1}</span>
              </label>
              <pre className="overflow-x-auto">
                {hunk.lines.map((line, j) => (
                  <div
                    key={j}
                    className={
                      line.tag === "+"
                        ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                        : line.tag === "-"
                          ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                          : "text-zinc-500"
                    }
                  >
                    {line.tag}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onReject}
            disabled={applying}
            className="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onApprove(accepted)}
            disabled={applying || !anyAccepted}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {applying ? "Applying…" : "Approve & apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}
