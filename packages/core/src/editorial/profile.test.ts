import test from "node:test";
import assert from "node:assert/strict";
import { groundedCandidates, editorialInstruction } from "./profile.ts";
const source = {
  url: "https://official.test/news",
  content: "An official announcement confirms this precise event today.",
  published_date: "2026-09-29",
};
const candidate = {
  title: "A specific announcement",
  hook: "What actually changed in this announcement?",
  angle: "Explain the announcement and its limitations.",
  why_now: "An official announcement was published today.",
  limitation: "No evidence of popularity or audience growth.",
  source_url: source.url,
  evidence_quote: source.content,
};
test("discovery rejects fabricated source and fabricated evidence", () => {
  assert.equal(
    groundedCandidates(
      [{ ...candidate, source_url: "https://fake.test" }],
      [source],
    ).length,
    0,
  );
  assert.equal(
    groundedCandidates(
      [
        {
          ...candidate,
          evidence_quote: "Completely fabricated evidence does not count.",
        },
      ],
      [source],
    ).length,
    0,
  );
});
test("discovery deduplicates and dates the verified evidence without popularity claims", () => {
  const rows = groundedCandidates(
    [candidate, candidate],
    [source],
    new Date("2026-09-29T12:00:00Z"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.published_at, "2026-09-29");
  assert.equal(rows[0]?.signal, "recent_source");
});
test("editorial profiles separate finance and fiction, and reject unsupported profiles", () => {
  assert.match(
    editorialInstruction({ theme: "finance" }),
    /Sem aconselhamento individual/,
  );
  assert.match(editorialInstruction({ theme: "novelas" }), /spoilers/);
  assert.equal(editorialInstruction({ theme: "unknown" }), "");
});
