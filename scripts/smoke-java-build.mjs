import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Run after `npm run build`. This tests the packaged route, with Firebase mocked.
// No submitted code is executed and no external service is contacted.
const require = createRequire(import.meta.url);
const { routeModule } = require("../.next/server/app/api/analyze/route.js");
await routeModule.ensureUserland();
const originalFetch = globalThis.fetch;
const originalKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
try {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "smoke-test-key";
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/"));
    return Response.json({ users: [{ localId: "java-build-smoke" }] });
  };
  const request = (code) => new Request("https://critiq.test/api/analyze", {
    method: "POST",
    headers: {
      origin: "https://critiq.test",
      "Content-Type": "application/json",
      Authorization: "Bearer build-smoke-token",
    },
    body: JSON.stringify({ code, language: "Java" }),
  });
  const response = await routeModule.userland.POST(request("class Example { void run() { ; work(); } }"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.analysis.engine, "Critiq Java / Tree-sitter");
  assert.ok(result.refactoredCode.includes("\n"));
  assert.ok(result.refactoring.appliedRules.includes("JAVA406"));
  const rechecked = await routeModule.userland.POST(request(result.refactoredCode));
  assert.equal(rechecked.status, 200);
  const revised = await rechecked.json();
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.ok(revised.overallScore > result.overallScore);
  console.log(`Java production-bundle smoke test passed: ${result.overallScore} -> ${revised.overallScore}.`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = originalKey;
}
