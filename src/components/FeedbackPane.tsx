"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Category, FeedbackPoint, Severity } from "@/lib/llm";
import { useEditorStore } from "@/lib/store/editorStore";

import { ChatPanel } from "./ChatPanel";
import { JdPanel } from "./JdPanel";

/**
 * Right pane: the anchored, sorted, filterable feedback list (Task 2.5).
 * Loads persisted feedback on project change, runs analysis on demand, and
 * lets the user filter by category/severity. Clicking a point selects its
 * section (reusing the cross-pane highlight from Task 1.4).
 */

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "nit"];
const CATEGORIES: Category[] = [
  "impact",
  "clarity",
  "ats",
  "relevance",
  "formatting",
  "consistency",
  "grammar",
];

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  nit: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function FeedbackPane() {
  const projectId = useEditorStore((s) => s.projectId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);

  const [points, setPoints] = useState<FeedbackPoint[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [catFilter, setCatFilter] = useState<Category | "all">("all");
  const [chatPointId, setChatPointId] = useState<string | null>(null);

  // Load persisted feedback when the project changes.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/analyze`);
        if (!res.ok) return;
        const body = (await res.json()) as { points: FeedbackPoint[] };
        if (!cancelled) setPoints(body.points ?? []);
      } catch {
        /* ignore load errors — empty list is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const analyze = useCallback(async () => {
    if (!projectId) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as {
        points?: FeedbackPoint[];
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "Analysis failed.");
        return;
      }
      setPoints(body.points ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }, [projectId]);

  const filtered = useMemo(
    () =>
      points.filter(
        (p) =>
          (sevFilter === "all" || p.severity === sevFilter) &&
          (catFilter === "all" || p.category === catFilter),
      ),
    [points, sevFilter, catFilter],
  );

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-zinc-950">
      <JdPanel />
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Feedback {points.length > 0 && `(${points.length})`}
        </span>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing || !projectId}
          className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {analyzing ? "Analyzing…" : "Analyze"}
        </button>
      </header>

      {points.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs dark:border-zinc-900">
          <select
            aria-label="Filter by severity"
            value={sevFilter}
            onChange={(e) => setSevFilter(e.target.value as Severity | "all")}
            className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by category"
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value as Category | "all")}
            className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}
        {points.length === 0 && !error && (
          <p className="p-6 text-center text-sm text-zinc-400">
            No feedback yet. Click <span className="font-medium">Analyze</span> to review this resume.
          </p>
        )}
        <ul>
          {filtered.map((p) => {
            const active = p.anchor.sectionId === selectedSectionId;
            return (
              <li
                key={p.id}
                data-feedback-id={p.id}
                data-section-id={p.anchor.sectionId}
                onClick={() => selectSection(active ? null : p.anchor.sectionId)}
                className={
                  "cursor-pointer border-b border-zinc-100 px-4 py-3 dark:border-zinc-900 " +
                  (active ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-900")
                }
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " + SEVERITY_STYLE[p.severity]}>
                    {p.severity}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                    {p.category}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {p.anchor.sectionTitle}
                  </span>
                </div>
                <p className="text-sm text-zinc-800 dark:text-zinc-200">{p.issue}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{p.suggestion}</p>
                <button
                  type="button"
                  data-discuss-id={p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatPointId(p.id);
                    selectSection(p.anchor.sectionId);
                  }}
                  className="mt-1.5 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Discuss →
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {chatPointId && (
        <div className="h-1/2 min-h-0 shrink-0">
          <ChatPanel pointId={chatPointId} onClose={() => setChatPointId(null)} />
        </div>
      )}
    </div>
  );
}
