"use client";

import { useCallback, useRef, useState } from "react";

import { FeedbackPane } from "./FeedbackPane";
import { PdfPreview } from "./PdfPreview";
import { SourceEditor } from "./SourceEditor";

/**
 * The 3-pane workspace (spec §4 UI): LaTeX source · PDF preview · Feedback/chat.
 * Panes are resizable via two drag handles; widths are kept as flex-basis
 * fractions so the layout reflows on window resize. A lightweight pointer-drag
 * implementation avoids pulling in a panel library for three columns.
 */
export function Workspace() {
  // Fractions for the two left panes; the third fills the remainder.
  const [leftFr, setLeftFr] = useState(0.34);
  const [midFr, setMidFr] = useState(0.36);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback(
    (which: "left" | "mid") => (e: React.PointerEvent) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const move = (ev: PointerEvent) => {
        const rect = root.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        if (which === "left") {
          setLeftFr(Math.min(0.7, Math.max(0.15, x)));
        } else {
          setMidFr(Math.min(0.7, Math.max(0.15, x - leftFr)));
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [leftFr],
  );

  const rightFr = Math.max(0.15, 1 - leftFr - midFr);

  return (
    <div ref={rootRef} className="flex h-full w-full overflow-hidden">
      <section
        className="h-full min-w-0 border-r border-zinc-200 dark:border-zinc-800"
        style={{ flex: `${leftFr} 1 0` }}
        aria-label="LaTeX source"
      >
        <SourceEditor />
      </section>

      <Divider onPointerDown={startDrag("left")} />

      <section
        className="h-full min-w-0"
        style={{ flex: `${midFr} 1 0` }}
        aria-label="PDF preview"
      >
        <PdfPreview />
      </section>

      <Divider onPointerDown={startDrag("mid")} />

      <section
        className="h-full min-w-0 border-l border-zinc-200 dark:border-zinc-800"
        style={{ flex: `${rightFr} 1 0` }}
        aria-label="Feedback and chat"
      >
        <FeedbackPane />
      </section>
    </div>
  );
}

function Divider({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="separator"
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-zinc-200 transition-colors hover:bg-blue-400 dark:bg-zinc-800"
    />
  );
}
