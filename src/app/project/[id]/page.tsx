"use client";

import { use, useEffect, useState } from "react";

import { Workspace } from "@/components/Workspace";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Project workspace page. Hydrates the editor store from the server (source +
 * whether a PDF exists), then renders the 3-pane workspace.
 */
export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const setProject = useEditorStore((s) => s.setProject);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? `Failed to load project (${res.status}).`);
        }
        const data = (await res.json()) as {
          source: string;
          hasPdf: boolean;
        };
        if (cancelled) return;
        setProject(id, data.source, data.hasPdf ? `/api/projects/${id}/pdf` : null);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, setProject]);

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-red-600">
        {error}
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        Loading project…
      </main>
    );
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-1">
      <Workspace />
    </div>
  );
}
