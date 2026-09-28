import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Resolve Next aliases and its environment marker for isolated route tests.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.js`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { POST: analyze } = await import("../app/api/analyze/route.js");
const { POST: analyzeRepository } = await import("../app/api/analyze-repo/route.js");

function request(path, body, token = "test-token") {
  return new Request(`https://critiq.test${path}`, {
    method: "POST",
    headers: { origin: "https://critiq.test", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("code API preserves auth, returns verified static fixes, and never calls AI", async (t) => {
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-public-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "code-test-user" }] });
  });
  const response = await analyze(request("/api/analyze", { code: "export function getAnswer() { var answer = 42; return answer; }", language: "JavaScript" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.isStaticAnalysis, true);
  assert.equal(result.analysis.engine, "ESLint");
  assert.match(result.refactoredCode, /const answer/);
  assert.equal(calls.length, 1);
  const unauthenticated = await analyze(request("/api/analyze", { code: "x", language: "JavaScript" }, ""));
  assert.equal(unauthenticated.status, 401);
  const invalid = await analyze(request("/api/analyze", { code: "", language: "JavaScript" }));
  assert.equal(invalid.status, 400);
});

test("Python API returns Ruff diagnostics and reproducible suggested code without AI", async (t) => {
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-public-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "python-test-user" }] });
  });
  const first = await analyze(request("/api/analyze", { code: 'message = f"hello"  \n', language: "Python" }));
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.analysis.engine, "Ruff");
  assert.ok(result.quality.some((item) => item.ruleId === "F541"));
  const second = await analyze(request("/api/analyze", { code: result.refactoredCode, language: "Python" }));
  assert.equal(second.status, 200);
  const revised = await second.json();
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.ok(revised.overallScore > result.overallScore);
});

test("Java API returns a completed report and reproducible fix scores without AI", async (t) => {
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-public-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "java-test-user" }] });
  });
  const first = await analyze(request("/api/analyze", { code: "class Example { void run() { ; work(); } }", language: "Java" }));
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.analysis.engine, "Critiq Java / Tree-sitter");
  assert.ok(result.quality.some((item) => item.ruleId === "JAVA406"));
  assert.ok(result.refactoredCode);
  const second = await analyze(request("/api/analyze", { code: result.refactoredCode, language: "Java" }));
  const revised = await second.json();
  assert.equal(second.status, 200);
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.ok(revised.overallScore > result.overallScore);
});

test("C++ API returns reproducible static fixes without executing code or calling AI", async (t) => {
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-public-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "cpp-test-user" }] });
  });
  const first = await analyze(request("/api/analyze", { code: "void f() { ; work(); }", language: "C++" }));
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.analysis.engine, "Critiq C++ / Tree-sitter");
  assert.ok(result.quality.some((issue) => issue.ruleId === "CPP404"));
  const second = await analyze(request("/api/analyze", { code: result.refactoredCode, language: "C++" }));
  assert.equal(second.status, 200);
  const revised = await second.json();
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.ok(revised.overallScore > result.overallScore);
});

test("repo API analyzes complete files beyond 3000 characters and discloses skips", async (t) => {
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-public-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
  });
  const code = `export const text = '${"a".repeat(4000)}';`;
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = String(url);
    if (path.includes("identitytoolkit")) return Response.json({ users: [{ localId: "repo-test-user" }] });
    assert.ok(path.startsWith("https://api.github.com/"), "No AI request is allowed");
    if (path.endsWith("/commits/HEAD")) return Response.json({ sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } });
    if (path.includes("/git/trees/")) return Response.json({ truncated: true, tree: [
      { type: "blob", path: "app.js", mode: "100644", sha: "c".repeat(40), size: Buffer.byteLength(code) }, { type: "blob", path: "big.js", mode: "100644", sha: "d".repeat(40), size: 50001 },
    ] });
    if (path.includes("/git/blobs/")) return Response.json({ sha: path.split("/").at(-1), encoding: "base64", content: Buffer.from(path.endsWith("d".repeat(40)) ? "a".repeat(50_001) : code).toString("base64") });
    return Response.json({ private: false, name: "example", default_branch: "main" });
  });
  const response = await analyzeRepository(request("/api/analyze-repo", { repoUrl: "https://github.com/example/project" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.summary.totalFiles, 1);
  assert.equal(result.fileReports[0].analysis.syntaxValid, true);
  assert.deepEqual(result.fullRepoOverview.unreadableOrOversizedFiles, ["big.js"]);
  assert.equal(result.fullRepoOverview.treeTruncated, true);
  assert.equal(result.commitSha, "a".repeat(40));
  assert.ok(result.projectSummary);
  assert.equal(result.aiSummary, undefined);
});
