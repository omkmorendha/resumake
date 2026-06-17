"use client";

/**
 * Right pane: feedback / chat. Placeholder for M1 — the structured feedback
 * list (M2) and per-point agent chat (M4) render here. Kept as a labelled
 * empty state so the 3-pane layout is complete and visually balanced now.
 */
export function FeedbackPane() {
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
        Feedback
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-400">
        Feedback and chat appear here once analysis runs (M2+).
      </div>
    </div>
  );
}
