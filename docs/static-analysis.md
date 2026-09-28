# Static analysis: current contract and next stages

## Stage 1 — scoring and refactoring

- JavaScript/React use ESLint's parser and recommended checks, React recommended checks (modern JSX runtime), and Hooks rules. A small AST-based security rule flags operations needing review.
- Submitted code is never executed. Repository ESLint configuration and inline disable comments are not loaded.
- Automatic fixes are restricted to ESLint's `no-var`, `prefer-const`, and supported `eqeqeq` fixes. No blanket exception handlers, parameter guards, deleted output statements, or changed division semantics.
- The output is reanalyzed with the same configuration. New findings, syntax failures, or a lower score cause the proposed rewrite to be discarded.
- A score staying the same is correct when no supported automatic fix exists. Behavioral equivalence still requires project tests.
- Scores start at 100 with deductions for unique findings. Best-practice summaries neither double-penalize findings nor award bonuses that conceal defects. Invalid JavaScript syntax produces an invalid report with score 0.
- Complexity is a labeled 1–10 heuristic; it is not a standardized complexity measurement. JavaScript uses parsed tokens/control-flow nodes instead of scanning comments and strings.
- Active code/repository routes make no AI requests. Firebase authentication and GitHub retrieval still use their respective APIs.

Run `npm test`, `npm run lint`, and `npm run build` before shipping. The test harness requires Node 22.15+ (tested on Node 24). Tests cover repeatability, reanalysis, scope, JSX, Hooks, invalid syntax, comments/strings, conservative source preservation, and API responses with mocked Firebase/GitHub services. Live account/database and browser interaction testing are separate deployment checks.

## Stage 2 — remaining language engines

### Python — implemented

Python now uses the pinned `@astral-sh/ruff-wasm-nodejs` 0.16.8 package in Node, without spawning Python, executing submitted code, loading repository configuration, or making AI calls. The target is Python 3.10; results expose engine version, target, selected rule groups and limitations.

- Selected rules: pycodestyle E4/E7/E9 and W, Pyflakes F, Bugbear B, Bandit-derived S, builtins A, comprehensions C4, simplify SIM, naming N, return RET, PERF, McCabe C90, ANN001/ANN201, D101/D102/D103, PLR0911/0912/0913/0915 and PLW0602/0603. This is not the complete Pylint/Bandit rule set or a type checker.
- Syntax errors invalidate the score. Diagnostics preserve Ruff rule IDs and UTF-16 line/column locations.
- Lexer tokens distinguish comments/strings from code and supply the heuristic complexity metrics. `noqa` is masked only within lexer-recognized comments for analysis; the returned code preserves the comments. The WASM token serialization is version-pinned and validated; unrecognized serialization fails rather than yielding a falsely clean report.
- Only F541 and whitespace fixes W291/W293 outside string values are eligible for automatic edits. Ruff formatting follows; the complete output passes the same reanalysis/regression gate. Formatting alone need not improve a score.
- Equality comparisons, mutable defaults, unused imports (which can have side effects), error handling and security changes remain manual. The WASM API exposes unsafe fixes without safety metadata, so applying all returned edits is expressly forbidden.
- Sources and formatted results are limited to 50,000 characters; edit passes are bounded at 50. Large-repository job isolation is still pending.
- Tests cover actual rule detection, suppression bypass, strings/comments, Unicode/CRLF locations, syntax failures, output formatting, unchanged behavior-sensitive constructs, and independently reproducible before/after scores.

References: [Ruff rules](https://docs.astral.sh/ruff/rules/), [fix safety](https://docs.astral.sh/ruff/linter/#fix-safety), [why E711 is not auto-applied](https://docs.astral.sh/ruff/rules/none-comparison/).

### Java — structural engine implemented; compiler analysis pending

Java uses `web-tree-sitter` 0.27.0 with the Java Orchard grammar bundled in `prettier-plugin-java` 2.11.0, and Prettier 3.9.9. No Java code, build scripts or repository configuration are executed. A JDK is not required.

- `JAVA001` reports grammar errors. The structural rule catalog is in `lib/analyzers/java/rules.js`: empty catch/control bodies, String comparison candidates, equals/hashCode contracts, nullable collection returns, static date formatters, unreachable statements, credentials/crypto/SQL/logging candidates, loop allocations/concatenation, naming, encapsulation and method size.
- Findings include stable rule IDs, line/column locations and structural versus review-required confidence. Comments, string literals and text blocks are parsed as syntax, not searched for fake executable code.
- Only standalone redundant empty statements (`JAVA406`) are removed automatically. Control-flow semicolons are preserved. Formatter output is accepted only if the remaining tokens and comment texts match the input to formatting. The final report uses the same before/after analysis gate as the other languages.
- The review/refactoring API is asynchronous to await Prettier. Repository aggregation remains synchronous and uses the same static analyzer.
- Input is limited to 50,000 characters; parsing has a cooperative two-second budget. This is not a hard CPU/time limit for the full analysis/formatting pipeline. Worker-level isolation remains a separate stage.
- Both API deployment traces include the pinned grammar asset. Production builds must be verified: bundlers can rewrite module-resolution calls differently from Node's test environment.

After `npm run build`, run `node scripts/smoke-java-build.mjs` to exercise the packaged Java route with mocked authentication. This verifies grammar loading, formatting and independently reproduced fix scores without calling Firebase or an AI provider. It uses the installed Next.js route-module test interface and should be rechecked when Next.js is upgraded.

This is **Critiq's structural profile**, not PMD, SpotBugs, a full OWASP audit, or `javac`. It does not resolve the project classpath or perform bytecode/type/data-flow analysis. Null dereferences, leaks, overflow and thread safety cannot be proven. A syntactically accepted compilation unit can still fail compilation, and suggested code still needs project tests.

References: [Tree-sitter syntax nodes](https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types), [Prettier Java](https://www.jhipster.tech/prettier-java/).

### C++ — structural engine implemented; compiler analysis pending

C++ uses `web-tree-sitter` 0.27.0 with the official `tree-sitter-cpp` 0.23.4 WASM grammar. Only the grammar asset is loaded, not the package's native binding. No compiler, submitted code, build scripts or AI service is executed.

- `CPP001` reports invalid or unsupported grammar syntax. `CPP101–107` cover empty catch/control bodies, directly unreachable statements, adjacent mismatched new/delete forms, consecutive deletion, immediate dereferences after deletion and polymorphic destructor review.
- `CPP201–205` cover size-unaware C buffer operations, nonliteral format strings, unbounded scanf string conversions, literal credential candidates and shell execution review. Library names are syntactic matches, not resolved symbols.
- `CPP301–303` identify loop allocations, nested loops and loop flush candidates. `CPP401–405` cover C-style casts, function size/parameters, redundant empty statements and raw-allocation ownership review. Nesting does not prove quadratic complexity; raw allocation does not prove a leak.
- Memory rules intentionally inspect adjacent statements only. They do not follow aliases or prove lifetimes across calls, branches or files. Security and performance suggestions require human context.
- Only `CPP404` is auto-fixed. It removes a standalone semicolon inside a block, preserving comments, line breaks and loop/branch/label bodies. The shared reanalysis gate rejects syntax failures, new findings or a lower score. There are no guessed smart-pointer rewrites, NULL conversions, casts or added exception handlers.
- Syntax nodes separate comments, string/raw-string contents and macro bodies from executable constructs. Includes/macros are not expanded; both conditional-preprocessor branches may be reported. Complete translation units are expected. The grammar is not an ISO language-version selector, type checker, or guarantee that compilation succeeds.
- Sources are capped at 50,000 characters and parsing has a cooperative two-second budget, not hard worker isolation. Both API deployment traces include the WASM grammar.

Run `node scripts/smoke-cpp-build.mjs` after the production build to verify the packaged route, grammar loading and reproducible before/after scores with mocked authentication.

This is **Critiq's own structural profile**, not Cppcheck, clang-tidy, or MISRA/CERT certification. Full bounds, overflow, ownership, concurrency and project-wide type checking remain out of scope.

Reference: [official C++ grammar and package](https://github.com/tree-sitter/tree-sitter-cpp/tree/v0.23.4).

Remaining compiler-aware work:

- Java follow-up: compiler/project-aware analysis with an explicit classpath/build model.
- C++: compiler-aware checks with compilation databases; distinguish C from C++.

Each adapter must declare supported language versions, rule IDs, locations, severity, confidence, fix eligibility, tool failures, and unsupported syntax. Do not execute repository install/build scripts or user code on the web server. External tools require an isolated worker with memory/CPU/time/network limits.

## Stage 3 — full repository analysis

The quick endpoint remains a **sample of up to 20 prioritized files**. Optional durable background jobs now process up to 5,000 files / 25 MB with commit pinning, transactional batch progress, owner-checked APIs, cancellation and paginated reports. See [deployment, limits and staging verification](background-scans.md). Both modes preserve complete source, disclose incomplete trees and skip unsupported/oversized files.

The larger-repository roadmap (cross-job caching and dedicated worker isolation remain pending):

1. Pin a commit SHA; retrieve a complete tree with truncation/pagination handling.
2. Queue a job; return its ID immediately and poll/stream progress.
3. Analyze batches in isolated workers with bounded concurrency and cancellation.
4. Cache by blob hash + engine/rule version; skip unchanged files.
5. Persist partial results, failures and exact coverage; paginate findings in the UI.
6. Apply explicit per-job byte/file/time quotas and tenant ownership checks.

There is no unlimited-resource guarantee and no guarantee of “perfect” refactored code. Rule checks, coverage, uncertainties and manual work must remain visible.

Reference: [ESLint integration API](https://eslint.org/docs/latest/integrate/nodejs-api), [no-var fixer limitations](https://eslint.org/docs/latest/rules/no-var).
