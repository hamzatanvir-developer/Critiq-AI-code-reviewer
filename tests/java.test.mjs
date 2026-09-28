import test from "node:test";
import assert from "node:assert/strict";
import analyzeJava from "../lib/analyzers/javaAnalyzer.js";
import { fixJava, inspectJava } from "../lib/analyzers/java/engine.js";
import { reviewCode } from "../lib/reviewCode.js";

const allIssues = (source) => {
  const report = analyzeJava(source);
  return [report.bugs, report.security, report.performance, report.quality].flat();
};
const ids = (source) => allIssues(source).map((item) => item.ruleId);

test("invalid Java returns syntax diagnostics and unchanged source", async () => {
  const source = "class Broken { void run( { }";
  const result = await reviewCode(source, "Java");
  assert.equal(result.analysis.syntaxValid, false);
  assert.equal(result.overallScore, 0);
  assert.ok(result.bugs.some((item) => item.ruleId === "JAVA001"));
  assert.equal(result.refactoredCode, source);
});

test("ordinary Hello World is not punished for normal console output", () => {
  const result = analyzeJava('public class Hello { public static void main(String[] args) { System.out.println("Hello"); } }');
  assert.equal(result.analysis.syntaxValid, true);
  assert.equal(result.bugs.length + result.quality.length + result.security.length, 0);
});

test("comments, literals and text blocks are not scanned as executable code", () => {
  const code = 'class Example { String text = """\npassword = \\"secret\\"; catch(Exception e){}\n"""; /* if(true); */ }';
  const result = analyzeJava(code);
  assert.equal(result.analysis.syntaxValid, true);
  assert.equal(result.bugs.length, 0);
  assert.equal(result.security.length, 0);
  assert.equal(result.metrics.decisionPoints, 0);
});

test("empty catch with only a comment is detected at its actual line", () => {
  const source = 'class Example { void run() {\ntry { work(); }\ncatch (Exception e) { /* ignored */ }\n} }';
  const finding = allIssues(source).find((item) => item.ruleId === "JAVA101");
  assert.equal(finding.line, 3);
  assert.equal(finding.column, 1);
  assert.ok(!ids('class Example { void run() { try { work(); } catch(Exception e) { throw e; } } }').includes("JAVA101"));
});

test("String comparisons use local parameter types and exclude null checks", () => {
  assert.ok(ids('class Example { boolean same(String a, String b) { return a == b; } }').includes("JAVA103"));
  assert.ok(!ids('class Example { boolean same(String a) { return a == null; } }').includes("JAVA103"));
  assert.ok(!ids('class Example { String a; boolean same(int a, int b) { return a == b; } }').includes("JAVA103"));
});

test("String fields are shadowed by catch and inferred lambda parameters", () => {
  const source = 'class Example { String e; void run() { try { work(); } catch(Exception e) { if (e == other) { work(); } } } }';
  assert.ok(!ids(source).includes("JAVA103"));
});

test("equals/hashCode checks signatures and stay within the owning class", () => {
  assert.ok(ids('class Example { public boolean equals(Object other) { return true; } }').includes("JAVA104"));
  assert.ok(!ids('class Example { public boolean equals(String other) { return true; } }').includes("JAVA104"));
  assert.ok(!ids('class Example { public boolean equals(Object other) { return true; } public int hashCode() { return 1; } }').includes("JAVA104"));
  assert.ok(ids('class Example { public boolean equals(Object other) { return true; } class Nested { public int hashCode() { return 1; } } }').includes("JAVA104"));
});

test("collection-null findings exclude nullable scalar and lambda returns", () => {
  assert.ok(ids('class Example { java.util.List<String> names() { return null; } }').includes("JAVA105"));
  assert.ok(!ids('class Example { String name() { return null; } }').includes("JAVA105"));
  assert.ok(!ids('class Example { java.util.List<String> names() { Runnable task = () -> { return; }; return java.util.List.of(); } }').includes("JAVA105"));
});

test("static date formatters and public mutable fields are review findings", () => {
  const rules = ids('class Example { static java.text.SimpleDateFormat format = new java.text.SimpleDateFormat(); public int count; public final int limit = 1; }');
  assert.ok(rules.includes("JAVA106"));
  assert.equal(rules.filter((id) => id === "JAVA401").length, 1);
});

test("unreachable statements are detected without blaming conditional returns", () => {
  assert.ok(ids('class Example { int f() { return 1; work(); } }').includes("JAVA107"));
  assert.ok(!ids('class Example { int f(boolean ok) { if(ok) { return 1; } return 0; } }').includes("JAVA107"));
});

test("credentials, weak crypto, SQL and sensitive logging are scoped to expressions", () => {
  const source = 'class Example { void run(String input) { String password = "secret"; MessageDigest.getInstance("MD5"); Cipher.getInstance("DES/ECB/PKCS5Padding"); stmt.executeQuery("SELECT * FROM users WHERE id=" + input); logger.info(password); } }';
  const rules = ids(source);
  for (const id of ["JAVA201", "JAVA202", "JAVA203", "JAVA204", "JAVA205"]) assert.ok(rules.includes(id), id);
  assert.ok(!ids('class Example { void run() { MessageDigest.getInstance("SHA-256"); } }').includes("JAVA202"));
});

test("loop allocations are flagged without treating unrelated allocations as hot loops", () => {
  assert.ok(ids('class Example { void run() { for(int i=0;i<10;i++) { Object value = new Object(); use(value); } } }').includes("JAVA302"));
  assert.ok(!ids('class Example { void run() { Object value = new Object(); use(value); } }').includes("JAVA302"));
});

test("safe empty-statement fixes improve measured scores and are idempotent", async () => {
  const source = 'class Example { void run() { ; work(); ; } }';
  const result = await reviewCode(source, "Java");
  assert.equal(result.refactoring.status, "changed");
  assert.ok(result.refactoring.appliedRules.includes("JAVA406"));
  const after = await reviewCode(result.refactoredCode, "Java");
  assert.ok(after.overallScore > result.overallScore);
  assert.equal(after.overallScore, result.refactoring.resultingScore);
  assert.equal(after.refactoredCode, result.refactoredCode);
});

test("control-flow semicolons are never removed automatically", async () => {
  const source = 'class Example { void run(boolean ok) { if(ok); while(ok); } }';
  const result = await fixJava(source);
  assert.equal(ids(result.code).filter((id) => id === "JAVA102").length, 2);
  assert.ok(!result.appliedRules.includes("JAVA406"));
});

test("no guessing null guards, visibility, equality or exception behavior", async () => {
  const source = 'class Example { public String value; boolean same(String other) { return value == other; } }';
  const result = await fixJava(source);
  assert.match(result.code, /public String value/);
  assert.match(result.code, /value == other/);
  assert.doesNotMatch(result.code, /Objects.equals|try\s*\{|!= null/);
});

test("formatting preserves Unicode strings and comments", async () => {
  const source = 'class Example{/* keep */String text="😀";void run(){work();}}';
  const result = await fixJava(source);
  assert.match(result.code, /"😀"/);
  assert.match(result.code, /\/\* keep \*\//);
  assert.ok(result.code.includes("\n"));
});

test("records and switch expressions are parsed without legacy regex assumptions", () => {
  const source = 'record Point(int x, int y) { int value(int n) { return switch(n) { case 1 -> x; default -> y; }; } }';
  assert.equal(analyzeJava(source).analysis.syntaxValid, true);
});

test("Java input limits are enforced", () => {
  assert.throws(() => inspectJava("x".repeat(50_001)), /50,000/);
});

test("switch case branches contribute to the complexity estimate", () => {
  const result = analyzeJava('class Example { int f(int n) { return switch(n) { case 1 -> 10; case 2 -> 20; default -> 0; }; } }');
  assert.equal(result.metrics.decisionPoints, 2);
});

test("empty else bodies are flagged and never automatically removed", async () => {
  const source = 'class Example { void f(boolean ok) { if(ok) { work(); } else; } }';
  assert.ok(ids(source).includes("JAVA102"));
  const output = await fixJava(source);
  assert.ok(ids(output.code).includes("JAVA102"));
});

test("fix offsets after non-BMP characters and CRLF preserve the surrounding source", async () => {
  const source = 'class Example {\r\nString message = "😀"; void f() { ; work(); }\r\n}';
  const result = await reviewCode(source, "Java");
  assert.equal(result.analysis.syntaxValid, true);
  assert.match(result.refactoredCode, /"😀"/);
  assert.match(result.refactoredCode, /work\(\)/);
  assert.ok(!ids(result.refactoredCode).includes("JAVA406"));
});
