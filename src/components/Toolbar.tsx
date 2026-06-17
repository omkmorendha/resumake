"use client";

import { useCallback } from "react";

import { selectIsDirty, useEditorStore } from "@/lib/store/editorStore";

/**
 * Workspace toolbar (Task 1.2): explicit Recompile action. Compiles the live
 * editor buffer via the compile API, then refreshes the PDF preview on success
 * or surfaces the LaTeX error on failure. The PDF is refreshed by busting the
 * cache with a timestamp query so the <img>/pdf.js reload picks up new bytes.
 */
export function Toolbar() {
  const projectId = useEditorStore((s) => s.projectId);
  const source = useEditorStore((s) => s.source);
  const compiling = useEditorStore((s) => s.compiling);
  const dirty = useEditorStore(selectIsDirty);
  const setCompiling = useEditorStore((s) => s.setCompiling);
  const setCompileError = useEditorStore((s) => s.setCompileError);
  const setPdfUrl = useEditorStore((s) => s.setPdfUrl);
  const markPersisted = useEditorStore((s) => s.markPersisted);

  const recompile = useCallback(async () => {
    if (!projectId) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tex: source }),
      });
      const body = (await res.json()) as {
        compiled?: boolean;
        compileError?: { message: string; line?: number } | null;
        error?: { message?: string };
      };
      if (!res.ok) {
        setCompileError({ message: body.error?.message ?? "Compile request failed." });
        return;
      }
      markPersisted(source);
      if (body.compiled) {
        // Cache-bust so the preview reloads the new PDF bytes.
        setPdfUrl(`/api/projects/${projectId}/pdf?t=${encodeURIComponent(nonce())}`);
      } else if (body.compileError) {
        setCompileError(body.compileError);
      } else {
        setCompileError({ message: "Compile failed." });
      }
    } catch (e) {
      setCompileError({ message: e instanceof Error ? e.message : "Compile failed." });
    } finally {
      setCompiling(false);
    }
  }, [projectId, source, setCompiling, setCompileError, setPdfUrl, markPersisted]);

  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={recompile}
        disabled={compiling || !projectId}
        className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
      >
        {compiling ? "Compiling…" : "Recompile"}
      </button>
      {dirty && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          Unsaved edits — recompile to update the PDF.
        </span>
      )}
    </div>
  );
}

/** A monotonic-ish nonce without Date.now (kept testable); good enough for cache-busting. */
let counter = 0;
function nonce(): string {
  counter += 1;
  return `${counter}-${performance.now().toFixed(0)}`;
}
