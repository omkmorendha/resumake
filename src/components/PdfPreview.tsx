"use client";

import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Middle pane: renders the current PDF with pdf.js. The PDF source is the URL
 * in the store (`pdfUrl`), which the recompile flow (Task 1.2) updates. All
 * pages are rendered stacked into a scroll container.
 *
 * pdf.js is imported dynamically (client-only) so its worker setup never runs
 * during SSR. Rendering errors surface a message rather than a blank pane.
 */
export function PdfPreview() {
  const pdfUrl = useEditorStore((s) => s.pdfUrl);
  const compileError = useEditorStore((s) => s.compileError);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    if (!pdfUrl) return;

    (async () => {
      setError(null);
      setLoading(true);
      try {
        const pdfjs = await import("pdfjs-dist");
        // Wire the worker from the bundled asset URL. `new URL(..., import.meta.url)`
        // is understood by both webpack and Turbopack and yields a real URL to
        // the worker module (no CDN dependency, no `?url` loader needed).
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const doc = await pdfjs.getDocument({ url: pdfUrl }).promise;
        if (cancelled) return;

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto my-2 shadow";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render PDF.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // A compile error with an existing PDF → show the stale PDF behind a banner.
  // A compile error with no PDF → show the error prominently (never blank).
  const showStaleBanner = compileError !== null && pdfUrl !== null;

  return (
    <div className="relative h-full w-full overflow-auto bg-zinc-100 dark:bg-zinc-900">
      {compileError && (
        <div
          role="alert"
          className="sticky top-0 z-10 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
        >
          <span className="font-semibold">Compile failed:</span>{" "}
          {compileError.message}
          {compileError.line ? ` (line ${compileError.line})` : ""}
          {showStaleBanner && (
            <span className="ml-1 text-red-600/80 dark:text-red-400/80">
              — showing the last successful PDF.
            </span>
          )}
        </div>
      )}
      {!pdfUrl && !error && !compileError && (
        <p className="p-6 text-center text-sm text-zinc-500">
          No PDF yet — recompile to preview.
        </p>
      )}
      {!pdfUrl && compileError && (
        <p className="p-6 text-center text-sm text-zinc-500">
          No PDF to show yet — fix the error above and recompile.
        </p>
      )}
      {loading && (
        <p className="absolute right-2 top-2 text-xs text-zinc-400">Rendering…</p>
      )}
      {error && (
        <p className="p-6 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div ref={containerRef} />
    </div>
  );
}
