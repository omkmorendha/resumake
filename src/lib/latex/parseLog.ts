/**
 * Minimal LaTeX log parser: extracts the *first* error and its line number
 * from `latexmk`/TeX output, for surfacing near the source pane.
 *
 * We intentionally keep this small and robust rather than fully modeling the
 * TeX log grammar. TeX emits errors in a few recognizable shapes:
 *
 *   ! Undefined control sequence.
 *   l.42 \badmacro
 *
 *   ./resume.tex:42: Undefined control sequence
 *
 *   ! LaTeX Error: Something is wrong.
 *
 * We scan for the first `!`-prefixed error line (classic TeX) or a
 * `file:line:`-prefixed error (file-line-error style), then look nearby for
 * an `l.<n>` line-number marker.
 */

export interface LatexError {
  /** The error message (without the leading `! `). */
  message: string;
  /** 1-based source line number, if one could be determined. */
  line?: number;
  /** Source file the error was attributed to, if reported. */
  file?: string;
  /** The raw log line(s) the error was extracted from, for debugging. */
  raw: string;
}

/** Matches the file-line-error format: `./resume.tex:42: <message>`. */
const FILE_LINE_RE = /^(.*?):(\d+):\s*(.*)$/;
/** Matches the classic TeX error marker: `! <message>`. */
const BANG_RE = /^!\s?(.*)$/;
/** Matches the line marker TeX prints under a classic error: `l.42 ...`. */
const L_LINE_RE = /^l\.(\d+)\b/;

/**
 * Parse the first LaTeX error (message + line number) from compiler output.
 *
 * @param log Combined stdout/stderr and/or the contents of the `.log` file.
 * @returns The first error found, or `undefined` if none is recognizable.
 */
export function parseFirstLatexError(log: string): LatexError | undefined {
  const lines = log.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // 1) file-line-error style: `./resume.tex:42: Undefined control sequence`
    const fileLine = FILE_LINE_RE.exec(line);
    if (fileLine && looksLikeError(fileLine[3] ?? "")) {
      const lineNo = Number(fileLine[2]);
      return {
        message: cleanMessage(fileLine[3] ?? ""),
        line: Number.isFinite(lineNo) ? lineNo : undefined,
        file: fileLine[1],
        raw: line,
      };
    }

    // 2) classic TeX error: `! Undefined control sequence.`
    const bang = BANG_RE.exec(line);
    if (bang) {
      const message = cleanMessage(bang[1] ?? "");
      // TeX prints the offending line a few lines later as `l.<n> ...`.
      const lineNo = findLineMarker(lines, i + 1);
      const rawBlock = lines
        .slice(i, Math.min(lines.length, i + 6))
        .filter((l): l is string => l !== undefined)
        .join("\n");
      return {
        message,
        line: lineNo,
        raw: rawBlock,
      };
    }
  }

  return undefined;
}

/** Looks ahead a bounded window for the `l.<n>` line marker. */
function findLineMarker(lines: readonly (string | undefined)[], from: number): number | undefined {
  const limit = Math.min(lines.length, from + 12);
  for (let i = from; i < limit; i++) {
    const l = lines[i];
    if (l === undefined) continue;
    const m = L_LINE_RE.exec(l);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

/**
 * Heuristic: a file-line-prefixed line is an error (not a warning/info) when
 * it mentions "error" or a known TeX error phrasing. The file-line-error
 * format is only emitted for errors by default, but be conservative.
 */
function looksLikeError(message: string): boolean {
  if (message.length === 0) return false;
  return (
    /error/i.test(message) ||
    /undefined control sequence/i.test(message) ||
    /missing/i.test(message) ||
    /runaway argument/i.test(message) ||
    /emergency stop/i.test(message) ||
    /! /.test(message)
  );
}

/** Trim trailing periods/whitespace and collapse to a single clean line. */
function cleanMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}
