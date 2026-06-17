/**
 * Minimal unified-diff generation for staged edits (Task 4.1/4.3). Produces a
 * line-based unified diff (current → proposed) for display in the approval
 * modal. This is for presentation; application uses the staged find→replace,
 * not the diff, so a simple LCS-free hunk builder is sufficient.
 *
 * For an exact, well-formed diff we use a standard LCS over lines.
 */

/** Longest-common-subsequence over lines → unified diff hunks. */
export function makeUnifiedDiff(
  before: string,
  after: string,
  context = 3,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = diffLines(a, b);

  // Group ops into hunks separated by runs of >2*context equal lines.
  const lines: string[] = [];
  let aLine = 0;
  let bLine = 0;

  // Build a flat annotated list first.
  type Tagged = { tag: " " | "-" | "+"; text: string; a?: number; b?: number };
  const tagged: Tagged[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      tagged.push({ tag: " ", text: op.line, a: aLine++, b: bLine++ });
    } else if (op.type === "del") {
      tagged.push({ tag: "-", text: op.line, a: aLine++ });
    } else {
      tagged.push({ tag: "+", text: op.line, b: bLine++ });
    }
  }

  // Find change regions and emit hunks with `context` surrounding equal lines.
  const changed = tagged.map((t) => t.tag !== " ");
  let i = 0;
  while (i < tagged.length) {
    if (!changed[i]) {
      i++;
      continue;
    }
    // Expand back/forward by context.
    let start = i;
    while (start > 0 && tagged[start - 1]!.tag === " " && i - start < context) start--;
    // include up to `context` leading equal lines
    let lead = i;
    while (lead > 0 && tagged[lead - 1]!.tag === " " && i - lead < context) lead--;
    let j = i;
    while (j < tagged.length && (changed[j] || withinTrailingContext(tagged, changed, j, context))) {
      j++;
    }
    const slice = tagged.slice(Math.min(start, lead), j);
    const aStart = (slice.find((t) => t.a !== undefined)?.a ?? 0) + 1;
    const bStart = (slice.find((t) => t.b !== undefined)?.b ?? 0) + 1;
    const aCount = slice.filter((t) => t.tag !== "+").length;
    const bCount = slice.filter((t) => t.tag !== "-").length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const t of slice) lines.push(`${t.tag}${t.text}`);
    i = j;
  }

  return lines.join("\n");
}

function withinTrailingContext(
  tagged: { tag: string }[],
  changed: boolean[],
  j: number,
  context: number,
): boolean {
  // Keep an equal line in the hunk if a change occurs within `context` ahead.
  for (let k = j; k < Math.min(tagged.length, j + context + 1); k++) {
    if (changed[k]) return true;
  }
  return false;
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "del"; line: string }
  | { type: "ins"; line: string };

/** Classic dynamic-programming LCS diff over arrays of lines. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of LCS of a[i:], b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! });
      i++;
    } else {
      ops.push({ type: "ins", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++]! });
  while (j < m) ops.push({ type: "ins", line: b[j++]! });
  return ops;
}
