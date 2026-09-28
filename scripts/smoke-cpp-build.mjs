import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// Verify both deployment traces and the actual built route. No external calls.
for (const name of ["analyze", "analyze-repo"]) {
  const trace = JSON.parse(readFileSync(new URL(`../.next/server/app/api/${name}/route.js.nft.json`, import.meta.url), "utf8"));
  assert.ok(trace.files.some((path) => path.endsWith("tree-sitter-cpp/tree-sitter-cpp.wasm")));
  assert.ok(trace.files.some((path) => path.endsWith("prettier-plugin-java/dist/tree-sitter-java_orchard.wasm")));
}
const require = createRequire(import.meta.url);
const { routeModule } = require("../.next/server/app/api/analyze/route.js");
await routeModule.ensureUserland();
const originalFetch = globalThis.fetch;
const originalKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
try {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "smoke-test-key";
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "cpp-build-smoke" }] });
  };
  const request = (code) => new Request("https://critiq.test/api/analyze", {
    method: "POST",
    headers: {
      origin: "https://critiq.test",
      "Content-Type": "application/json",
      Authorization: "Bearer build-smoke-token",
    },
    body: JSON.stringify({ code, language: "C++" }),
  });
  const response = await routeModule.userland.POST(request("void f() { ; work(); }"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.analysis.engine, "Critiq C++ / Tree-sitter");
  assert.ok(result.refactoring.appliedRules.includes("CPP404"));
  const rechecked = await routeModule.userland.POST(request(result.refactoredCode));
  assert.equal(rechecked.status, 200);
  const revised = await rechecked.json();
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.ok(revised.overallScore > result.overallScore);
  console.log(`C++ production-bundle smoke test passed: ${result.overallScore} -> ${revised.overallScore}.`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = originalKey;
}
