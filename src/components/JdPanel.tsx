"use client";

import { useCallback, useEffect, useState } from "react";

import type { JobRequirements } from "@/lib/llm";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Job-description panel (Task 3.1): paste a posting, extract structured
 * requirements via /jd, and show a summary. When a JD is present, analysis
 * becomes JD-aware (Task 3.2). Collapsible to stay out of the way.
 *
 * Calls `onJdChange` so the parent (FeedbackPane) knows a JD now exists and can
 * hint that re-running analysis will use it.
 */
export function JdPanel({ onJdChange }: { onJdChange?: (has: boolean) => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [requirements, setRequirements] = useState<JobRequirements | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/jd`);
        if (!res.ok) return;
        const body = (await res.json()) as { requirements: JobRequirements | null };
        if (!cancelled) {
          setRequirements(body.requirements);
          onJdChange?.(body.requirements !== null);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, onJdChange]);

  const extract = useCallback(async () => {
    if (!projectId || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/jd`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json()) as {
        requirements?: JobRequirements;
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "Extraction failed.");
        return;
      }
      setRequirements(body.requirements ?? null);
      onJdChange?.(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }, [projectId, text, onJdChange]);

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <span>
          Job description{" "}
          {requirements ? (
            <span className="text-green-600 dark:text-green-400">• added</span>
          ) : (
            <span className="text-zinc-400">— none</span>
          )}
        </span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <textarea
            aria-label="Job posting text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the job posting here…"
            rows={6}
            className="w-full rounded border border-zinc-300 bg-transparent p-2 text-xs dark:border-zinc-700"
          />
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={extract}
            disabled={busy || text.trim() === ""}
            className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
          >
            {busy ? "Extracting…" : "Extract requirements"}
          </button>
        </div>
      )}

      {requirements && !open && (
        <div className="px-3 pb-2 text-[11px] text-zinc-500">
          {requirements.mustHaveSkills.length} must-have ·{" "}
          {requirements.keywords.length} keywords
        </div>
      )}
    </div>
  );
}
