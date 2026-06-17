"use client";

import { useEffect, useRef } from "react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Left pane: a CodeMirror 6 editor over the LaTeX source. Edits flow into the
 * Zustand store (`setSource`) so the rest of the workspace sees the live
 * buffer. The view is created once; external source changes (e.g. loading a
 * project or applying an edit) are reconciled by dispatching a replace
 * transaction only when the store value actually diverges from the view, so we
 * don't clobber the cursor on every keystroke.
 */
export function SourceEditor() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setSource = useEditorStore((s) => s.setSource);
  const source = useEditorStore((s) => s.source);

  // Create the view once.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: useEditorStore.getState().source,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          StreamLanguage.define(stex),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "var(--font-geist-mono), monospace" },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setSource(u.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [setSource]);

  // Reconcile external source changes into the view without disrupting typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== source) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: source },
      });
    }
  }, [source]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
