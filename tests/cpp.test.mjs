import test from "node:test";
import assert from "node:assert/strict";
import analyzeCpp from "../lib/analyzers/cppAnalyzer.js";
import { fixCpp, inspectCpp } from "../lib/analyzers/cpp/engine.js";
import { reviewCode } from "../lib/reviewCode.js";

const findings = (code) => {
  const result = analyzeCpp(code);
  assert.equal(result.analysis.syntaxValid, true, JSON.stringify(result.bugs));
  return [
    result.bugs,
    result.security,
    result.performance,
    result.quality,
  ].flat();
};
const ids = (code) => findings(code).map((issue) => issue.ruleId);

test("grammar limitations fail visibly rather than producing a clean report", () => {
  // Valid C++ comma/new expression currently unsupported by grammar 0.23.4.
  const source = "void f(int* p) { delete p; *p = (p = new int, 2); }";
  const report = inspectCpp(source);
  assert.equal(report.syntaxValid, false);
  assert.ok(report.issues.some((issue) => issue.ruleId === "CPP001"));
  assert.equal(fixCpp(source).code, source);
});

test("invalid C++ has diagnostics, no fabricated score or rewrite", async () => {
  const source = "int broken( {";
  const result = await reviewCode(source, "C++");
  assert.equal(result.analysis.syntaxValid, false);
  assert.equal(result.overallScore, 0);
  assert.equal(result.refactoredCode, source);
  assert.ok(result.bugs.some((issue) => issue.ruleId === "CPP001"));
  assert.deepEqual(result.bestPractices, []);
});

test("Hello World is not penalized for normal output or small constants", () => {
  assert.deepEqual(
    ids('#include <iostream>\nint main() { std::cout << "Hello"; return 0; }'),
    [],
  );
});

test("comments and raw strings are not scanned as executable C++", () => {
  const source =
    'const char* text = R"tag(if(x); gets(x); delete p; delete p; while(true))tag";\n// password = "secret";';
  assert.deepEqual(ids(source), []);
  assert.equal(analyzeCpp(source).metrics.decisionPoints, 0);
});

test("empty catch has source locations and throwing catches stay clean", () => {
  const finding = findings(
    "void f() {\ntry { work(); }\ncatch(...) { /* ignored */ }\n}",
  ).find((item) => item.ruleId === "CPP101");
  assert.equal(finding.line, 3);
  assert.equal(finding.column, 1);
  assert.ok(
    !ids("void f() { try { work(); } catch(...) { throw; } }").includes(
      "CPP101",
    ),
  );
});

test("control-flow semicolons are reported but never automatically removed", () => {
  const source =
    "void f(bool ok) { if(ok); else; while(ok); for(;;); label:; }";
  const result = fixCpp(source);
  assert.equal(result.code, source);
  assert.equal(ids(source).filter((id) => id === "CPP102").length, 4);
});

test("direct unreachable code respects labels and conditional returns", () => {
  assert.ok(ids("int f() { return 1; work(); }").includes("CPP103"));
  assert.ok(ids("void f() { throw 1; work(); }").includes("CPP103"));
  assert.ok(
    !ids("int f(bool ok) { if(ok) return 1; return 0; }").includes("CPP103"),
  );
  assert.ok(!ids("int f() { goto end; end: return 0; }").includes("CPP103"));
});

test("new/delete array mismatch checks both forms, preserving matched pairs", () => {
  for (const code of [
    "void f() { int* p = new int[4]; delete p; }",
    "void f() { auto p = new int; delete[] p; }",
  ])
    assert.ok(ids(code).includes("CPP104"));
  for (const code of [
    "void f() { int* p = new int[4]; delete[] p; }",
    "void f() { auto p = new int; delete p; }",
  ])
    assert.ok(!ids(code).includes("CPP104"));
});

test("adjacent lifetime checks do not cross reassignments or branches", () => {
  assert.ok(ids("void f(int* p) { delete p; delete p; }").includes("CPP105"));
  assert.ok(ids("void f(int* p) { delete p; *p = 2; }").includes("CPP106"));
  assert.ok(
    !ids("void f(int* p) { delete p; p = new int; *p = 2; }").includes(
      "CPP106",
    ),
  );
  assert.ok(
    !ids("void f(int* p) { delete p; *p = restore(p); }").includes(
      "CPP106",
    ),
  );
  assert.ok(
    !ids("void f(bool b, int* p) { if(b) delete p; else delete p; }").includes(
      "CPP105",
    ),
  );
});

test("polymorphic destructors allow public virtual and protected nonvirtual", () => {
  assert.ok(
    ids("class Base { public: virtual void f() {} };").includes("CPP107"),
  );
  assert.ok(
    !ids(
      "class Base { public: virtual void f() {} virtual ~Base() = default; };",
    ).includes("CPP107"),
  );
  assert.ok(
    !ids(
      "class Base { public: virtual void f() {} protected: ~Base() = default; };",
    ).includes("CPP107"),
  );
  assert.ok(
    !ids("class Child : public Base { public: virtual void f() {} };").includes(
      "CPP107",
    ),
  );
});

test("buffer and shell calls exclude unrelated object/namespace methods", () => {
  const rules = ids(
    'void f(char* buf, const char* command) { gets(buf); std::strcpy(buf, "x"); system(command); }',
  );
  assert.ok(rules.includes("CPP201"));
  assert.ok(rules.includes("CPP205"));
  assert.deepEqual(ids("void f() { object.gets(); custom::system(); }"), []);
});

test("format-string and unbounded scanf checks are argument-specific", () => {
  assert.ok(
    ids("void f(const char* input) { printf(input); }").includes("CPP202"),
  );
  assert.ok(
    !ids('void f(const char* input) { printf("%s", input); }').includes(
      "CPP202",
    ),
  );
  assert.ok(ids('void f(char* buf) { scanf("%s", buf); }').includes("CPP203"));
  assert.ok(
    ids('void f(char* buf) { scanf("%[a-z]", buf); }').includes("CPP203"),
  );
  assert.ok(
    !ids('void f(char* buf) { scanf("%%s %9s %*s", buf); }').includes("CPP203"),
  );
});

test("credential checks inspect literal initializers, not names alone", () => {
  assert.ok(
    ids('void f() { const char* password = "secret"; }').includes("CPP204"),
  );
  assert.ok(
    !ids("void f() { auto password = readSecret(); }").includes("CPP204"),
  );
});

test("loop performance checks stop at deferred lambda bodies", () => {
  assert.ok(
    ids("void f() { for(int i=0;i<3;++i) { auto p = new int; } }").includes(
      "CPP301",
    ),
  );
  assert.ok(
    ids(
      "void f() { for(int i=0;i<3;++i) { while(ready()) work(); } }",
    ).includes("CPP302"),
  );
  assert.ok(
    !ids(
      "void f() { for(int i=0;i<3;++i) { auto make = []() { return new int; }; } }",
    ).includes("CPP301"),
  );
  assert.ok(
    ids("void f() { while(ready()) { std::cout << std::endl; } }").includes(
      "CPP303",
    ),
  );
});

test("casts are review findings, but explicit void discard is accepted", () => {
  assert.ok(ids("int f(double n) { return (int)n; }").includes("CPP401"));
  assert.ok(!ids("void f(int n) { (void)n; }").includes("CPP401"));
  assert.ok(
    !ids("int f(double n) { return static_cast<int>(n); }").includes("CPP401"),
  );
});

test("function-size rules inspect syntax, not commas and lines inside strings", () => {
  assert.ok(
    ids("void f(int a,int b,int c,int d,int e,int f) {}").includes("CPP402"),
  );
  assert.ok(ids(`void f() {\n${"work();\n".repeat(51)}}`).includes("CPP403"));
  assert.ok(
    !ids(`void f() {\n/* ${"comment\n".repeat(60)} */\n}`).includes("CPP403"),
  );
});

test("safe fixes improve independently measured scores and are idempotent", async () => {
  const source = "void f() { ; work(); ; }";
  const result = await reviewCode(source, "C++");
  assert.equal(result.refactoring.status, "changed");
  assert.deepEqual(result.refactoring.appliedRules, ["CPP404"]);
  const revised = await reviewCode(result.refactoredCode, "C++");
  assert.ok(revised.overallScore > result.overallScore);
  assert.equal(revised.overallScore, result.refactoring.resultingScore);
  assert.equal(revised.refactoredCode, result.refactoredCode);
});

test("Unicode, CRLF, comments and macro directives survive fixes", () => {
  const source =
    '#include <string>\r\nvoid f() { auto text = "😀"; /* keep */ ; work(); }';
  assert.equal(
    fixCpp(source).code,
    source.replace("/* keep */ ;", "/* keep */ "),
  );
});

test("behavior-sensitive ownership, NULL, casts and flushing stay unchanged", () => {
  const source =
    "void f() { int* p = NULL; p = new int[3]; delete p; printf(input); std::cout << std::endl; }";
  assert.equal(fixCpp(source).code, source);
});

test("templates, lambdas, smart pointers and structured bindings parse", () => {
  const source =
    "#include <memory>\ntemplate<class T> T add(T a,T b) { return a+b; }\nvoid f() { auto p = std::make_unique<int>(1); auto [a,b] = pair; auto g = [](int n) { return n+1; }; }";
  assert.equal(analyzeCpp(source).analysis.syntaxValid, true);
});

test("complexity uses syntax and the C++ input limit is enforced", () => {
  const result = analyzeCpp(
    "int f(int n) { switch(n) { case 1: return 1; default: return n > 1 && n < 3 ? 2 : 0; } }",
  );
  assert.equal(result.metrics.decisionPoints, 3);
  assert.throws(() => inspectCpp("x".repeat(50_001)), /50,000/);
});
