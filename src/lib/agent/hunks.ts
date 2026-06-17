/**
 * Unified-diff hunk parsing + selective application (Task 4.3). The approval
 * modal renders hunks individually so the user can approve/reject each. Applying
 * a subset reconstructs the new text by taking, for each hunk, either the "+"
 * (accepted) or "-" (rejected) side, with shared context lines passed through.
 */

export interface DiffLine {
  tag: " " | "-" | "+";
  text: string;
}

export interface Hunk {
  /** 1-based start line in the original (`before`) file. */
  beforeStart: number;
  lines: DiffLine[];
}

/** Parse a unified diff (no file headers) into hunks. */
export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const raw of diff.split("\n")) {
    const header = raw.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (header) {
      current = { beforeStart: Number(header[1]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    const tag = raw[0];
    if (tag === " " || tag === "-" || tag === "+") {
      current.lines.push({ tag, text: raw.slice(1) });
    }
  }
  return hunks;
}

/**
 * Apply selected hunks to `before`, returning the new text. For each hunk:
 *   - accepted → use the "+" side (and context)
 *   - rejected → use the "-" side (and context), i.e. leave that region unchanged
 *
 * Hunks are anchored by their `beforeStart` line and consume exactly the "-"/" "
 * lines they cover from the original, so non-overlapping hunks compose cleanly.
 */
export function applySelectedHunks(
  before: string,
  hunks: Hunk[],
  accepted: boolean[],
): string {
  const beforeLines = before.split("\n");
  const out: string[] = [];
  let cursor = 0; // 0-based index into beforeLines

  hunks.forEach((hunk, i) => {
    const start = hunk.beforeStart - 1; // to 0-based
    // Emit untouched original lines up to this hunk.
    while (cursor < start && cursor < beforeLines.length) {
      out.push(beforeLines[cursor]!);
      cursor++;
    }
    const isAccepted = accepted[i] ?? false;
    for (const line of hunk.lines) {
      if (line.tag === " ") {
        out.push(line.text);
        cursor++; // context consumes one original line
      } else if (line.tag === "-") {
        // Original line: consumed either way; kept only when rejected.
        if (!isAccepted) out.push(line.text);
        cursor++;
      } else {
        // Added line: emitted only when accepted; consumes no original line.
        if (isAccepted) out.push(line.text);
      }
    }
  });

  // Tail of the original file after the last hunk.
  while (cursor < beforeLines.length) {
    out.push(beforeLines[cursor]!);
    cursor++;
  }

  return out.join("\n");
}
