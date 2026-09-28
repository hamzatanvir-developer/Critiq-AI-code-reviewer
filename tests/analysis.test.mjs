import test from "node:test";
import assert from "node:assert/strict";
import { reviewCode } from "../lib/reviewCode.js";
import { runStaticAnalysis } from "../lib/staticAnalyzer.js";
import { refactorCode } from "../lib/refactorer.js";
import { calculateScore } from "../lib/analyzers/scorer.js";

test("a real fix improves the independently measured score and is idempotent", async () => {
  const code = "export function add(a, b) { var result = a + b; return result; }";
  const review = await reviewCode(code, "JavaScript");
  assert.match(review.refactoredCode, /const result/);
  const revised = await reviewCode(review.refactoredCode, "JavaScript");
  assert.ok(revised.overallScore > review.overallScore);
  assert.equal(revised.overallScore, review.refactoring.resultingScore);
  assert.equal(revised.refactoredCode, review.refactoredCode);
  assert.equal(revised.refactoring.status, "unchanged");
});

test("strings, comments, regexes and directive prologues are preserved", async () => {
  const code = `'use client';
// var x = 5; eval(x); console.log(x); TODO
export const example = "var x == 2; document.write(x); eval(x)";
export const pattern = /var|==|console.log/;`;
  const review = await reviewCode(code, "React");
  assert.equal(review.refactoredCode, code);
  assert.equal(review.bugs.length, 0);
  assert.equal(review.security.length, 0);
  assert.equal(review.quality.length, 0);
});

test("no forced score improvement or destructive security rewrites", async () => {
  const code = 'export function render(html) { document.write(html); console.log(html); return html; }';
  const result = await reviewCode(code, "JavaScript");
  assert.equal(result.refactoredCode, code);
  assert.equal(result.refactoring.originalScore, result.refactoring.resultingScore);
  assert.equal(result.refactoring.status, "unchanged");
  assert.ok(result.security.length > 0);
});

test("division, nullable parameters and exception propagation are unchanged", async () => {
  const code = 'export async function divide(a = null, b) { return a / b; }';
  const result = await reviewCode(code, "JavaScript");
  assert.equal(result.refactoredCode, code);
  assert.equal(result.bugs.length, 0);
});

test("reassigned bindings remain mutable", async () => {
  const fixed = await refactorCode('export function count() { var total = 0; total += 1; return total; }', "JavaScript");
  assert.match(fixed, /let total/);
  assert.doesNotMatch(fixed, /const total/);
});

test("hoisted var dependencies are not blindly converted", async () => {
  const code = 'export function f() { console.info(value); var value = 2; return value; }';
  const fixed = await refactorCode(code, "JavaScript");
  assert.match(fixed, /var value/);
});

test("syntax errors block fixes and invalidate scoring", async () => {
  const code = "export function broken( {";
  const review = await reviewCode(code, "JavaScript");
  assert.equal(review.analysis.syntaxValid, false);
  assert.equal(review.overallScore, 0);
  assert.equal(review.refactoredCode, code);
  assert.equal(review.bestPractices.length, 0);
});

test("scope-aware undefined variables, duplicate keys and unreachable statements", async () => {
  const result = runStaticAnalysis('export function f() { const a = {x: 1, x: 2}; return missing + a.x; console.info(a); }', "JavaScript");
  const ids = result.bugs.map((item) => item.ruleId);
  for (const id of ["no-dupe-keys", "no-undef", "no-unreachable"]) assert.ok(ids.includes(id), id);
});

test("pasted code cannot disable the reviewer rules", async () => {
  const result = runStaticAnalysis('/* eslint-disable */\nexport const x = missing;', "JavaScript");
  assert.ok(result.bugs.some((bug) => bug.ruleId === "no-undef"));
});

test("React uses Hook rules and JSX list keys", async () => {
  const result = runStaticAnalysis(`import { useState } from 'react';
export default function List({ items, enabled }) {
  if (enabled) { useState(0); }
  return <ul>{items.map(item => <li>{item.name}</li>)}</ul>;
}`, "React");
  assert.equal(result.analysis.syntaxValid, true);
  assert.ok(result.bugs.some((bug) => bug.ruleId === "react-hooks/rules-of-hooks"));
  assert.ok(result.bugs.some((bug) => bug.ruleId === "react/jsx-key"));
});

test("best-practice summaries cannot double-penalize or cancel defects", async () => {
  const issue = { ruleId: "no-undef", line: 1, column: 10, severity: "high" };
  const analysis = { bugs: [issue, issue], bestPractices: [{ status: "fail" }, { status: "pass" }] };
  assert.equal(calculateScore(analysis).score, 90);
  assert.equal(calculateScore({ bugs: [issue] }).score, 90);
});

test("complexity ignores words and operators inside strings and comments", async () => {
  const result = runStaticAnalysis('/* if while switch && */\nexport const text = "if for while ?? &&";', "JavaScript");
  assert.equal(result.complexity.score, 1);
  assert.ok(result.complexity.reasons.includes("The code contains 0 decision points."));
});

for (const [language, code] of [
  ["C++", '#include <iostream>\nint main() { std::cout << "Hello"; return 0; }'],
]) {
  test(`${language} retains source rather than applying unsafe unvalidated rewrites`, async () => {
    const result = await reviewCode(code, language);
    assert.equal(result.refactoredCode, code);
    assert.equal(result.analysis.mode, "parser");
    assert.equal(result.refactoring.supported, true);
  });
}
