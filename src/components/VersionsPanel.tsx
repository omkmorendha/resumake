"use client";

import { useCallback, useEffect, useState } from "react";

import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Minimal version history UI (Task 4.6). Lists snapshots and restores one
 * (which snapshots the current source first, recompiles, and re-parses). Used
 * both for browsing history and as the one-click undo target after a failed
 * self-heal (Task 4.5).
 */
interface VersionEntry {
  version: number;
  ts: string;
  summary: string;
}

export function VersionsPanel() {
  const projectId = useEditorStore((s) => s.projectId);
  const setSource = useEditorStore((s) => s.setSource);
  const markPersisted = useEditorStore((s) => s.markPersisted);
  const setPdfUrl = useEditorStore((s) => s.setPdfUrl);

  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`);
      if (!res.ok) return;
      const body = (await res.json()) as { versions: VersionEntry[] };
      setVersions(body.versions ?? []);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    // load() only setStates after an awaited fetch, so it cannot cascade
    // synchronously; the rule's heuristic flags it as a false positive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
  }, [open, load]);

  const restore = useCallback(
    async (version: number) => {
      if (!projectId) return;
      setBusy(version);
      try {
        const res = await fetch(`/api/projects/${projectId}/versions/${version}/restore`, {
          method: "POST",
        });
        const body = (await res.json()) as { source?: string };
        if (res.ok && body.source) {
          setSource(body.source);
          markPersisted(body.source);
          setPdfUrl(`/api/projects/${projectId}/pdf?t=${Date.now()}`);
          await load();
        }
      } finally {
        setBusy(null);
      }
    },
    [projectId, setSource, markPersisted, setPdfUrl, load],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        History
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 max-h-72 w-64 overflow-auto rounded border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {versions.length === 0 ? (
            <p className="p-2 text-xs text-zinc-400">No snapshots yet.</p>
          ) : (
            <ul className="space-y-1" data-testid="versions-list">
              {versions
                .slice()
                .reverse()
                .map((v) => (
                  <li
                    key={v.version}
                    data-version={v.version}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="truncate" title={v.summary}>
                      v{v.version} · {v.summary}
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(v.version)}
                      disabled={busy !== null}
                      className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
                    >
                      {busy === v.version ? "…" : "Restore"}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
