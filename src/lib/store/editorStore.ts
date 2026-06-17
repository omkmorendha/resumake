"use client";

import { create } from "zustand";

/**
 * Client-side editor state for the 3-pane workspace (spec §4 UI). Holds the
 * working LaTeX source (which the user edits live before recompiling), the
 * active project id, the URL of the currently-rendered PDF, and the selected
 * section anchor for cross-pane highlighting.
 *
 * This is deliberately the single source of truth for *unsaved* edits — the
 * server holds the last compiled/persisted `resume.tex`; the editor buffer can
 * diverge until a recompile/save action reconciles them (Task 1.2).
 */
export interface EditorState {
  projectId: string | null;
  /** Live editor buffer (may differ from the last persisted source). */
  source: string;
  /** Last persisted source, for dirty-state detection. */
  persistedSource: string;
  /** Object URL / route for the current PDF, or null when none compiled. */
  pdfUrl: string | null;
  /** sectionId selected in any pane, for cross-pane highlight (Task 1.4). */
  selectedSectionId: string | null;

  setProject: (id: string, source: string, pdfUrl: string | null) => void;
  setSource: (source: string) => void;
  markPersisted: (source: string) => void;
  setPdfUrl: (url: string | null) => void;
  selectSection: (sectionId: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  projectId: null,
  source: "",
  persistedSource: "",
  pdfUrl: null,
  selectedSectionId: null,

  setProject: (id, source, pdfUrl) =>
    set({
      projectId: id,
      source,
      persistedSource: source,
      pdfUrl,
      selectedSectionId: null,
    }),
  setSource: (source) => set({ source }),
  markPersisted: (source) => set({ persistedSource: source, source }),
  setPdfUrl: (url) => set({ pdfUrl: url }),
  selectSection: (sectionId) => set({ selectedSectionId: sectionId }),
}));

/** True when the live buffer differs from the last persisted source. */
export function selectIsDirty(s: EditorState): boolean {
  return s.source !== s.persistedSource;
}
