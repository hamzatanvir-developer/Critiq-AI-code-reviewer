import test from "node:test";
import assert from "node:assert/strict";
import analyzePython from "../lib/analyzers/pythonAnalyzer.js";
import { lintPython, fixPython } from "../lib/analyzers/python/engine.js";
import { reviewCode } from "../lib/reviewCode.js";

const findings = (result) => [result.bugs, result.security, result.performance, result.quality].flat();
const ruleIds = (source) => findings(analyzePython(source)).map((item) => item.ruleId);

test("Ruff catches genuine Python syntax errors", async () => {
  const result = await reviewCode("def broken(:\n    return 1\n", "Python");
  assert.equal(result.analysis.engine, "Ruff");
  assert.equal(result.analysis.syntaxValid, false);
  assert.equal(result.overallScore, 0);
  assert.equal(result.refactoring.status, "unchanged");
  assert.ok(result.bugs.some((item) => item.ruleId === "invalid-syntax"));
});

test("scope-aware undefined names and mutable defaults are detected", async () => {
  const ids = ruleIds("def collect(items=[]):\n    return missing + items\n");
  assert.ok(ids.includes("B006"));
  assert.ok(ids.includes("F821"));
});

test("bare except is reported once, not as two duplicate rules", async () => {
  const ids = ruleIds("try:\n    int('abc')\nexcept:\n    print('invalid')\n");
  assert.ok(ids.includes("E722"));
  assert.ok(!ids.includes("B001"));
});

test("comments and triple-quoted strings are not executable code", async () => {
  const source = '# eval(missing)\ntext = """exec(missing)\nif x = 2:\nexcept:\n"""\n';
  const result = analyzePython(source);
  assert.equal(result.bugs.length, 0);
  assert.equal(result.security.length, 0);
  assert.equal(result.metrics.decisionPoints, 0);
});

test("security rules recognize aliases and unsafe subprocess arguments", async () => {
  const ids = ruleIds("import pickle as p\nimport subprocess as sp\np.loads(b'data')\nsp.run('echo test', shell=True)\n");
  assert.ok(ids.includes("S301"));
  assert.ok(ids.some((id) => /^S60[237]$/.test(id)));
});

test("noqa directives cannot hide findings, but noqa strings remain intact", async () => {
  const source = 'text = "# noqa"\n# ruff: noqa\nmissing()  # noqa: F821\n';
  const result = analyzePython(source);
  assert.ok(result.bugs.some((item) => item.ruleId === "F821"));
  assert.match(fixPython(source).code, /# ruff: noqa/);
  assert.match(fixPython(source).code, /text = "# noqa"/);
});

test("safe fixes improve the score and reanalysis matches the claimed result", async () => {
  const source = 'message = f"hello"  \n';
  const original = await reviewCode(source, "Python");
  assert.equal(original.analysis.syntaxValid, true);
  assert.equal(original.refactoredCode, 'message = "hello"\n');
  assert.ok(original.refactoring.appliedRules.includes("F541"));
  const after = await reviewCode(original.refactoredCode, "Python");
  assert.ok(after.overallScore > original.overallScore);
  assert.equal(after.overallScore, original.refactoring.resultingScore);
  assert.equal(after.refactoredCode, original.refactoredCode);
});

test("formatting is deterministic and preserves simple Python semantics", async () => {
  const source = 'def add(a: int,b: int)->int:\n """Add two integers."""\n return a+b\n';
  const result = await reviewCode(source, "Python");
  assert.match(result.refactoredCode, /def add\(a: int, b: int\) -> int:/);
  assert.match(result.refactoredCode, /    return a \+ b/);
  assert.equal((await reviewCode(result.refactoredCode, "Python")).refactoredCode, result.refactoredCode);
});

test("unsafe equality, mutable defaults and imports are never silently rewritten", async () => {
  const source = 'import side_effects\n\ndef collect(items=[]):\n    if items == None:\n        return []\n    return items\n';
  const result = await reviewCode(source, "Python");
  assert.match(result.refactoredCode, /import side_effects/);
  assert.match(result.refactoredCode, /items=\[\]/);
  assert.match(result.refactoredCode, /items == None/);
  assert.ok(result.refactoring.remainingFindings > 0);
});

test("print, eval and exception behavior are not removed to game the score", async () => {
  const source = 'print(eval("1 + 1"))\n';
  const result = await reviewCode(source, "Python");
  assert.equal(result.refactoredCode, source);
  assert.ok(result.security.some((item) => item.ruleId === "S307"));
});

test("UTF-16 diagnostic positions and UTF-8 lexer positions handle emoji and CRLF", async () => {
  const source = 'emoji = "😀"\r\nmessage = f"hello"  \r\n';
  const result = await reviewCode(source, "Python");
  assert.match(result.refactoredCode, /emoji = "😀"/);
  assert.match(result.refactoredCode, /message = "hello"/);
  assert.equal(result.analysis.syntaxValid, true);
  const sameLine = fixPython('emoji = "😀"; message = f"hello"\n').code;
  assert.match(sameLine, /emoji = "😀"/);
  assert.match(sameLine, /message = "hello"/);
});

test("whitespace inside string values is preserved", async () => {
  const source = 'text = """first  \n   \nlast"""\n';
  const output = fixPython(source).code;
  assert.ok(output.includes('first  \n   \nlast'));
});

test("f-string literal brace escaping is preserved by Ruff's F541 fix", async () => {
  const output = fixPython('text = f"{{hello}}"\n').code;
  assert.equal(output, 'text = "{hello}"\n');
});

test("complexity counts Python control tokens, not words inside comments/strings", async () => {
  const result = lintPython('text = "if for while and"\n# if x or y\nif text:\n    print(text)\n');
  assert.equal(result.metrics.decisionPoints, 1);
});

test("simplification rules are quality findings, not security vulnerabilities", async () => {
  const result = analyzePython('def f(x):\n    if x:\n        return True\n    else:\n        return False\n');
  assert.ok(!result.security.some((item) => item.ruleId.startsWith("SIM")));
});

test("code length bounds apply to linting and refactoring", async () => {
  assert.throws(() => lintPython("x".repeat(50_001)), /50,000/);
  assert.throws(() => fixPython("x".repeat(50_001)), /50,000/);
});
