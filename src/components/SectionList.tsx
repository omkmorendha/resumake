"use client";

import { useMemo } from "react";

import { parseSections } from "@/lib/parser";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * A clickable list of the resume's parsed sections (Task 1.4). Selecting one
 * sets `selectedSectionId` in the store, which the editor reacts to by
 * scrolling to and highlighting that section's range. Re-derives from the live
 * source so it stays in sync as the user edits.
 */
export function SectionList() {
  const source = useEditorStore((s) => s.source);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);

  const sections = useMemo(() => parseSections(source), [source]);

  if (sections.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      {sections.map((s) => {
        const active = s.sectionId === selectedSectionId;
        return (
          <button
            key={s.sectionId}
            type="button"
            data-section-id={s.sectionId}
            onClick={() => selectSection(active ? null : s.sectionId)}
            className={
              "rounded px-2 py-0.5 text-xs transition-colors " +
              (active
                ? "bg-blue-600 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700") +
              (s.level === 2 ? " ml-3" : "")
            }
          >
            {s.title}
          </button>
        );
      })}
    </div>
  );
}
