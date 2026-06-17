import { describe, it, expect } from "vitest";

import {
  parseSections,
  toSectionAnchor,
  type ParsedSection,
} from "./parseSections";

/** Helper: find a section by id (sections are unique by id after dedupe). */
function byId(sections: ParsedSection[], id: string): ParsedSection {
  const s = sections.find((x) => x.sectionId === id);
  if (!s) throw new Error(`expected a section with id "${id}"`);
  return s;
}

describe("parseSections — standard \\section / \\subsection (AC 1)", () => {
  const tex = String.raw`\documentclass{article}
\begin{document}
\section{Experience}
Worked at Acme.
\subsection{Senior Engineer}
Led the team.
\section{Education}
B.S. Computer Science
\end{document}`;

  const sections = parseSections(tex);

  it("detects each heading with the right id, title and level", () => {
    expect(sections.map((s) => s.sectionId)).toEqual([
      "experience",
      "senior-engineer",
      "education",
    ]);
    expect(byId(sections, "experience").title).toBe("Experience");
    expect(byId(sections, "experience").level).toBe(1);
    expect(byId(sections, "senior-engineer").level).toBe(2);
    expect(byId(sections, "education").level).toBe(1);
  });

  it("computes contiguous, informational char ranges to the next heading", () => {
    const exp = byId(sections, "experience");
    const sub = byId(sections, "senior-engineer");
    const edu = byId(sections, "education");

    // ranges are ordered and contiguous
    expect(exp.texRange.start).toBeLessThan(sub.texRange.start);
    expect(exp.texRange.end).toBe(sub.texRange.start);
    expect(sub.texRange.end).toBe(edu.texRange.start);
    expect(edu.texRange.end).toBe(tex.length);

    // the range actually spans the heading text in the source
    expect(tex.slice(exp.texRange.start, exp.texRange.end)).toContain(
      "Experience",
    );
  });

  it("converts to a SectionAnchor compatible with spec §5", () => {
    const anchor = toSectionAnchor(byId(sections, "experience"), "bullet-0");
    expect(anchor).toMatchObject({
      sectionId: "experience",
      sectionTitle: "Experience",
      subBlock: "bullet-0",
    });
    expect(anchor.texRange).toBeDefined();
  });
});

describe("parseSections — Jake's-Resume style macros + itemize bullets (AC 2)", () => {
  const tex = String.raw`\section{Experience}
\resumeSubHeadingListStart
  \resumeSubheading
    {Software Engineer}{Jun 2020 -- Present}
    {Acme Corp}{Remote}
    \resumeItemListStart
      \item{Built a distributed cache that cut latency 40\%}
      \item{Mentored three junior engineers}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\section{Projects}
\resumeProjectHeading
  {\textbf{Resumake} \emph{Local-first}}{2024}
  \begin{itemize}
    \item Shipped the section parser
  \end{itemize}`;

  const sections = parseSections(tex);

  it("detects the \\section headings", () => {
    expect(sections.map((s) => s.sectionId)).toEqual(["experience", "projects"]);
  });

  it("captures \\resumeSubheading / \\resumeProjectHeading as subheading sub-blocks", () => {
    const exp = byId(sections, "experience");
    const subheadings = exp.subBlocks.filter((b) => b.kind === "subheading");
    expect(subheadings.map((b) => b.text)).toContain("Software Engineer");

    const proj = byId(sections, "projects");
    const projHeads = proj.subBlocks.filter((b) => b.kind === "subheading");
    // the macro label is the cleaned first brace arg (formatting stripped)
    expect(projHeads.map((b) => b.text)).toContain("Resumake Local-first");
  });

  it("captures \\item bullets as bullet sub-blocks within their section", () => {
    const exp = byId(sections, "experience");
    const bullets = exp.subBlocks.filter((b) => b.kind === "bullet");
    expect(bullets.map((b) => b.text)).toEqual([
      "Built a distributed cache that cut latency 40%",
      "Mentored three junior engineers",
    ]);

    const proj = byId(sections, "projects");
    const projBullets = proj.subBlocks.filter((b) => b.kind === "bullet");
    expect(projBullets.map((b) => b.text)).toEqual([
      "Shipped the section parser",
    ]);
  });

  it("keeps sub-blocks in document order", () => {
    const exp = byId(sections, "experience");
    const starts = exp.subBlocks.map((b) => b.texRange.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });
});

describe("parseSections — environment-based class \\begin{rSection}{...} (AC 3)", () => {
  const tex = String.raw`\begin{rSection}{Skills}
\begin{tabular}{ ... }
Languages & TypeScript, Python \\
\end{tabular}
\end{rSection}

\begin{rSection}{Education}
B.S. in CS
\end{rSection}`;

  const sections = parseSections(tex);

  it("derives the section from the environment's first argument", () => {
    expect(sections.map((s) => s.sectionId)).toEqual(["skills", "education"]);
    expect(byId(sections, "skills").title).toBe("Skills");
    expect(byId(sections, "skills").level).toBe(1);
  });

  it("does not treat unrelated environments (tabular) as sections", () => {
    expect(sections.some((s) => s.sectionId === "tabular")).toBe(false);
  });
});

describe("parseSections — exotic class with NO recognized headings (AC 4)", () => {
  const tex = String.raw`\documentclass{my-bespoke-cv}
\name{Jane Doe}
\contact{jane@example.com}
\customblock{Some entirely custom layout with no standard sections}
\anotherthing{More content}`;

  it("returns exactly one synthetic 'document' section", () => {
    const sections = parseSections(tex);
    expect(sections).toHaveLength(1);
    const only = sections[0]!;
    expect(only.sectionId).toBe("document");
    expect(only.synthetic).toBe(true);
    expect(only.texRange).toEqual({ start: 0, end: tex.length });
  });

  it("never throws on this or other unparseable input", () => {
    expect(() => parseSections(tex)).not.toThrow();
    expect(() => parseSections("\\begin{ unbalanced {{{ ")).not.toThrow();
    expect(() => parseSections("\\section{ no closing brace")).not.toThrow();
    // hostile non-string input still degrades instead of throwing
    expect(() =>
      parseSections(undefined as unknown as string),
    ).not.toThrow();
  });
});

describe("parseSections — \\subsubsection flattening (AC 5)", () => {
  const tex = String.raw`\section{Experience}
Intro text.
\subsubsection{Detail About A Role}
Some detail.
\section{Education}
Done.`;

  const sections = parseSections(tex);

  it("does not create a top-level section for \\subsubsection", () => {
    expect(sections.map((s) => s.sectionId)).toEqual([
      "experience",
      "education",
    ]);
    expect(
      sections.some((s) => s.sectionId === "detail-about-a-role"),
    ).toBe(false);
  });

  it("records the \\subsubsection as a subsubsection sub-block of the nearest section", () => {
    const exp = byId(sections, "experience");
    const deep = exp.subBlocks.filter((b) => b.kind === "subsubsection");
    expect(deep.map((b) => b.text)).toEqual(["Detail About A Role"]);
  });

  it("flattens even deeper levels (\\paragraph-equivalent depth) too", () => {
    const deeper = parseSections(
      String.raw`\section{X}
\subsubsection{Lvl3}
\subsubsubsection{Lvl4}`,
    );
    expect(deeper.map((s) => s.sectionId)).toEqual(["x"]);
    const x = byId(deeper, "x");
    expect(
      x.subBlocks.filter((b) => b.kind === "subsubsection").map((b) => b.text),
    ).toEqual(["Lvl3", "Lvl4"]);
  });
});

describe("parseSections — duplicate titles get unique ids (AC 6)", () => {
  const tex = String.raw`\section{Projects}
First batch.
\section{Projects}
Second batch.
\section{Projects}
Third batch.`;

  const sections = parseSections(tex);

  it("assigns deterministic, collision-deduped ids", () => {
    expect(sections.map((s) => s.sectionId)).toEqual([
      "projects",
      "projects-2",
      "projects-3",
    ]);
  });

  it("keeps the human-facing title identical across the duplicates", () => {
    expect(sections.every((s) => s.title === "Projects")).toBe(true);
  });

  it("is stable across re-parses (anchors must re-resolve to the same ids)", () => {
    const again = parseSections(tex);
    expect(again.map((s) => s.sectionId)).toEqual(
      sections.map((s) => s.sectionId),
    );
  });
});

describe("parseSections — empty / whitespace-only input (AC 7)", () => {
  it("does not throw and returns the synthetic document fallback for empty string", () => {
    expect(() => parseSections("")).not.toThrow();
    const sections = parseSections("");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.sectionId).toBe("document");
    expect(sections[0]!.texRange).toEqual({ start: 0, end: 0 });
  });

  it("does not throw and falls back for whitespace-only input", () => {
    const ws = "   \n\t  \n";
    expect(() => parseSections(ws)).not.toThrow();
    const sections = parseSections(ws);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.sectionId).toBe("document");
    expect(sections[0]!.synthetic).toBe(true);
  });
});
