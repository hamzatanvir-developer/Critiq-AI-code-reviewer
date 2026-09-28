import test from "node:test";
import assert from "node:assert/strict";
import { filterImportantFiles, getFullFileTree } from "../lib/repoTree.js";
import analyzeRepo from "../lib/analyzers/repoAnalyzer.js";

test("selection excludes unsupported syntax rather than mislabeling it", () => {
  const paths = ["package.json", "src/types.ts", "src/view.tsx", "src/program.c", "src/app.js", "src/view.jsx", "src/main.py"];
  assert.deepEqual(new Set(filterImportantFiles(paths)), new Set(["src/app.js", "src/view.jsx", "src/main.py"]));
  const overview = getFullFileTree(paths);
  assert.equal(overview.totalFiles, 7);
  assert.equal(overview.analyzableFiles, 3);
  assert.equal(overview.languages.TypeScript, 2);
});

test("ignored folders and secrets cannot be promoted by importance scores", () => {
  const paths = ["src/.env", "src/.env.local", "src/core/lib/services/node_modules/index.js", "src/app.js", "dist/src/main.js", "src/app.min.js"];
  assert.deepEqual(filterImportantFiles(paths), ["src/app.js"]);
});

test("file overview tolerates adversarial directory names", () => {
  const result = getFullFileTree(["__proto__/a.js", "constructor/b.py"]);
  assert.deepEqual(result.structure.__proto__, ["a.js"]);
  assert.deepEqual(result.structure.constructor, ["b.py"]);
});

test("repository files retain analysis coverage metadata", () => {
  const result = analyzeRepo([
    { path: "a.js", language: "JavaScript", content: "export const answer = 42;" },
    { path: "b.py", language: "Python", content: 'print("hello")' },
    { path: "Hello.java", language: "Java", content: "class Hello { void run() { ; } }" },
    { path: "main.cpp", language: "C++", content: "void f() { ; }" },
  ]);
  assert.equal(result.summary.totalFiles, 4);
  assert.equal(result.fileReports.find((file) => file.path === "a.js").analysis.engine, "ESLint");
  assert.equal(result.fileReports.find((file) => file.path === "b.py").analysis.engine, "Ruff");
  assert.equal(result.fileReports.find((file) => file.path === "Hello.java").analysis.mode, "parser");
  assert.ok(result.fileReports.find((file) => file.path === "Hello.java").quality.some((item) => item.ruleId === "JAVA406"));
  assert.equal(result.fileReports.find((file) => file.path === "main.cpp").analysis.mode, "parser");
  assert.ok(result.fileReports.find((file) => file.path === "main.cpp").quality.some((item) => item.ruleId === "CPP404"));
  assert.throws(() => analyzeRepo([{ path: "a.ts", content: "", language: "TypeScript" }]), /Unsupported/);
});
