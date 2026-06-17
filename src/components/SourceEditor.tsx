"use client";

import { useEffect, useRef } from "react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { parseSections } from "@/lib/parser";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * A line-level highlight for the currently-selected section's range. Driven by
 * an effect so the React layer can imperatively set/clear it (Task 1.4).
 */
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

const highlightMark = Decoration.line({ class: "cm-section-highlight" });

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (e.value === null) {
          next = Decoration.none;
        } else {
          const { from, to } = e.value;
          const doc = tr.state.doc;
          const fromLine = doc.lineAt(Math.max(0, Math.min(from, doc.length)));
          const toLine = doc.lineAt(Math.max(0, Math.min(to, doc.length)));
          const marks = [];
          for (let n = fromLine.number; n <= toLine.number; n++) {
            marks.push(highlightMark.range(doc.line(n).from));
          }
          next = Decoration.set(marks);
        }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function SourceEditor() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setSource = useEditorStore((s) => s.setSource);
  const source = useEditorStore((s) => s.source);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

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
          highlightField,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "var(--font-geist-mono), monospace" },
            ".cm-section-highlight": {
              backgroundColor: "rgba(59, 130, 246, 0.14)",
            },
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

  // Highlight + scroll to the selected section's range.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!selectedSectionId) {
      view.dispatch({ effects: setHighlight.of(null) });
      return;
    }
    const section = parseSections(view.state.doc.toString()).find(
      (s) => s.sectionId === selectedSectionId,
    );
    if (!section) {
      view.dispatch({ effects: setHighlight.of(null) });
      return;
    }
    const from = Math.min(section.texRange.start, view.state.doc.length);
    const to = Math.min(section.texRange.end, view.state.doc.length);
    view.dispatch({
      effects: [
        setHighlight.of({ from, to }),
        EditorView.scrollIntoView(from, { y: "start" }),
      ],
    });
  }, [selectedSectionId]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
