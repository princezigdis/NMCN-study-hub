import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, QUESTION_TEMPLATE, rowsToObjects, toCsv, validateQuestionRows } from "../src/lib/csv.ts";

test("parseCsv handles quotes, escaped quotes, commas and newlines inside fields", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\n\n1,2,3');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'he said "hi"', "line1\nline2"], ["1", "2", "3"]]);
});

test("parseCsv strips a UTF-8 BOM from Excel exports", () => {
  assert.deepEqual(parseCsv("﻿stem,correct\nQ?,A"), [["stem", "correct"], ["Q?", "A"]]);
});

test("rowsToObjects normalises headers and reports unknown columns", () => {
  const { rows, unknownColumns } = rowsToObjects([["Stem", "Correct", "Option A", "Mystery"], ["Q here?", "A", "Yes", "?"]]);
  assert.equal(rows[0].stem, "Q here?");
  assert.equal(rows[0].option_a, "Yes");
  assert.deepEqual(unknownColumns, ["mystery"]);
});

test("the downloadable template validates cleanly", () => {
  const { rows } = rowsToObjects(parseCsv(QUESTION_TEMPLATE));
  const [r] = validateQuestionRows(rows);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("validateQuestionRows catches missing answers, bad letters, bad programmes and in-file duplicates", () => {
  const base = { topic_title: "Vital Signs", stem: "Normal adult respiratory rate?", option_a: "12-20", option_b: "30-40", rationale_a: "r", rationale_b: "r", correct: "A", source: "x" };
  const out = validateQuestionRows([
    base,
    { ...base, correct: "C" },
    { ...base, stem: "Another question here?", correct: "Z", programmes: "RN,XX" },
    { ...base, stem: "  normal   ADULT respiratory rate? " },
    { ...base, stem: "Missing rationale question?", rationale_b: "" },
  ]);
  assert.deepEqual(out[0].errors, []);
  assert.match(out[1].errors.join(), /correct answer C has no option text/);
  assert.match(out[2].errors.join(), /single letter/);
  assert.match(out[2].errors.join(), /programmes/);
  assert.match(out[3].errors.join(), /duplicate of row 1/);
  assert.match(out[4].warnings.join(), /option B has no rationale/);
});

test("toCsv escapes quotes and neutralises spreadsheet formulas", () => {
  const csv = toCsv(["a", "b"], [{ a: '=HYPERLINK("x")', b: "plain, text" }]);
  assert.equal(csv.split("\r\n")[1], `"'=HYPERLINK(""x"")","plain, text"`);
});
