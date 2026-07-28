import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { pdfTextToMarkdown, collapseRepeats } from "@/server/ingest/pdf/toMarkdown";

it("probe", () => {
  const out: Record<string, unknown> = {};
  out["collapse big cat"] = collapseRepeats("big cat big cat");
  out["collapse foo bar dup"] = collapseRepeats("foo bar foo bar and then baz qux baz qux");
  out["collapse word dbl"] = collapseRepeats("word  word  word");
  out["collapse ab cd"] = collapseRepeats("ab cd ab cd");
  out["spaced title"] = pdfTextToMarkdown("body.", "  Spaced Title  ").markdown;
  out["title+caps"] = pdfTextToMarkdown("INTRODUCTION TO STUFF\nbody.", "My Chapter").markdown;
  out["two-line para"] = pdfTextToMarkdown("first line\nsecond line").markdown;
  out["alpha triple sp"] = pdfTextToMarkdown("alpha   beta").markdown;
  out["para merge"] = pdfTextToMarkdown("First paragraph.\n\nSecond paragraph.").markdown;
  out["tab"] = pdfTextToMarkdown("word\tother").markdown;
  out["lead space section"] = pdfTextToMarkdown("   8.1 Intro");
  out["intro ALLCAPS"] = pdfTextToMarkdown("intro ALLCAPS HEADING").markdown;
  out["HELLO WORLD then lc"] = pdfTextToMarkdown("HELLO WORLD then lowercase").markdown;
  out["8-word caps"] = pdfTextToMarkdown("ALPHA BETA GAMMA DELTA EPSILON ZETA ETA THETA").markdown;
  out["9-word caps"] = pdfTextToMarkdown("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE").markdown;
  out["HELLO dbl WORLD"] = pdfTextToMarkdown("HELLO  WORLD").markdown;
  out["caps title stryker"] = pdfTextToMarkdown("SOME CAPS TITLE\nbody.").markdown;
  out["two caps"] = pdfTextToMarkdown("FIRST CAPS TITLE\nSECOND CAPS LINE").markdown;
  out["8.2.35 deep"] = pdfTextToMarkdown("8.2.35 Deep");
  out["see 8.1"] = pdfTextToMarkdown("see 8.1 introduction here");
  out["10.1"] = pdfTextToMarkdown("10.1 Ten point one");
  out["8.12"] = pdfTextToMarkdown("8.12 Twelve");
  out["8.1 dbl sp"] = pdfTextToMarkdown("8.1  Intro");
  out["x123"] = pdfTextToMarkdown("x123");
  out["12abc"] = pdfTextToMarkdown("12abc");
  out["note marker"] = pdfTextToMarkdown("note -- 3 of 9 --");
  out["marker extra"] = pdfTextToMarkdown("-- 3 of 9 -- extra text");
  out["xx marker"] = pdfTextToMarkdown("xx-- 3 of 9 --");
  out["--3"] = pdfTextToMarkdown("--3 of 9 --");
  out["-- 33"] = pdfTextToMarkdown("-- 33 of 9 --");
  out["-- 3  of"] = pdfTextToMarkdown("-- 3  of 9 --");
  out["-- 3 of  9"] = pdfTextToMarkdown("-- 3 of  9 --");
  out["-- 3 of 99"] = pdfTextToMarkdown("-- 3 of 99 --");
  out["-- 3 of 9--"] = pdfTextToMarkdown("-- 3 of 9--");
  out["marker xx tail"] = pdfTextToMarkdown("-- 3 of 9 --xx");
  out["see MATH 114"] = pdfTextToMarkdown("see MATHEMATICS 114");
  out["MATH 114 extra"] = pdfTextToMarkdown("MATHEMATICS 114 extra");
  out["MATH 114x"] = pdfTextToMarkdown("MATHEMATICS 114x");
  out["188 MATH then"] = pdfTextToMarkdown("188 MATHEMATICS then lower");
  out["see 188 MATH"] = pdfTextToMarkdown("see 188 MATHEMATICS");
  out["188 dbl MATH"] = pdfTextToMarkdown("188  MATHEMATICS");
  out["188 MATH SCIENCE"] = pdfTextToMarkdown("188 MATH SCIENCE");
  writeFileSync(
    "/private/tmp/claude-501/-Users-tanveersidhu-Desktop-Agabi/4ee00e06-2dd1-4230-918b-fcaa49547408/scratchpad/probe.json",
    JSON.stringify(out, null, 2),
  );
  expect(true).toBe(true);
});
