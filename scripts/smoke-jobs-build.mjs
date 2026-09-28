import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Configuration-disabled smoke checks: no credentials or network required.
const require = createRequire(import.meta.url);
const previous = process.env.REPO_JOBS_ENABLED;
process.env.REPO_JOBS_ENABLED = "false";
try {
  for (const name of ["repo-jobs", "repo-jobs/[id]", "inngest"]) {
    const { routeModule } = require(`../.next/server/app/api/${name}/route.js`);
    await routeModule.ensureUserland();
    const response = await routeModule.userland.GET(
      new Request("https://critiq.test/api/" + name),
      { params: Promise.resolve({ id: "invalid" }) },
    );
    assert.equal(response.status, 503, name);
    assert.match((await response.json()).error, /configur/i);
  }
  const trace = JSON.parse(
    readFileSync(
      new URL(
        "../.next/server/app/api/inngest/route.js.nft.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const asset of ["tree-sitter-cpp.wasm", "tree-sitter-java_orchard.wasm"])
    assert.ok(
      trace.files.some((path) => path.endsWith(asset)),
      asset,
    );
  console.log(
    "Background-job production routes load, fail closed without configuration, and include parser assets.",
  );
} finally {
  if (previous === undefined) delete process.env.REPO_JOBS_ENABLED;
  else process.env.REPO_JOBS_ENABLED = previous;
}
