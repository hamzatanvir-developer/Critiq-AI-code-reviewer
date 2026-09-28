import { field, isComment, modifiers, nearest, statements, walk } from "./parser.js";

const CLASS_TYPES = ["class_declaration", "record_declaration", "enum_declaration", "interface_declaration"];
const CALLABLE_TYPES = ["method_declaration", "constructor_declaration", "lambda_expression"];
const LOOP_TYPES = ["for_statement", "enhanced_for_statement", "while_statement", "do_statement"];
const TYPE_NAMES = new Set(["List", "Set", "Map", "Collection", "Iterable", "Queue", "Deque"]);

function typeName(node) {
  if (!node) return "";
  if (node.type === "generic_type") return typeName(node.namedChildren[0]);
  if (node.type === "scoped_type_identifier") return node.namedChildren.at(-1)?.text ?? "";
  return node.text;
}

function stringValue(node) {
  // Only literal arguments. Do not guess values from arbitrary expressions.
  return node?.type === "string_literal" ? node.text.slice(1, -1) : null;
}

function parameters(node) {
  return field(node, "parameters")?.namedChildren.filter((child) => ["formal_parameter", "spread_parameter"].includes(child.type)) ?? [];
}

function directDeclaration(scope, name, before) {
  for (const child of scope.namedChildren) {
    if (!["local_variable_declaration", "field_declaration", "resource"].includes(child.type)) continue;
    if (child.type !== "field_declaration" && child.startIndex >= before) continue;
    if (child.namedChildren.some((item) => item.type === "variable_declarator" && field(item, "name")?.text === name)) {
      return field(child, "type");
    }
  }
  return undefined;
}

function declaredType(identifier) {
  if (identifier?.type !== "identifier") return "";
  const name = identifier.text;
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    const local = directDeclaration(scope, name, identifier.startIndex);
    if (local !== undefined) return typeName(local);
    if (CALLABLE_TYPES.includes(scope.type)) {
      const parameter = parameters(scope).find((item) => field(item, "name")?.text === name);
      if (parameter) return typeName(field(parameter, "type"));
      // Lambda parameters with inferred types must shadow outer bindings too.
      const lambdaParams = field(scope, "parameters");
      if (scope.type === "lambda_expression" && (lambdaParams?.text === name || lambdaParams?.namedChildren.some((item) => item.type === "identifier" && item.text === name))) return "";
    }
    if (scope.type === "catch_clause") {
      const parameter = scope.namedChildren.find((item) => item.type === "catch_formal_parameter");
      if (field(parameter, "name")?.text === name) return "";
    }
    if (scope.type === "enhanced_for_statement" && field(scope, "name")?.text === name) return typeName(field(scope, "type"));
  }
  return "";
}

function isString(node) {
  return node?.type === "string_literal" || declaredType(node) === "String";
}

function receiverName(node) {
  const object = field(node, "object");
  return object?.text.replace(/\s+/g, "") ?? "";
}

function inLoop(node) {
  const boundary = nearest(node, [...LOOP_TYPES, ...CALLABLE_TYPES]);
  return Boolean(boundary && LOOP_TYPES.includes(boundary.type));
}

export const JAVA_RULES = {
  "JAVA101": ["bugs", "high", "Empty catch block discards the exception.", "Handle the exception explicitly, propagate it, or document and review why ignoring it is safe."],
  "JAVA102": ["bugs", "medium", "Empty control-flow body may be an accidental semicolon.", "Check the intended body; do not remove the semicolon without reviewing behavior."],
  "JAVA103": ["bugs", "medium", "String reference comparison may not compare text content.", "Use an appropriate null-safe value comparison if text equality is intended."],
  "JAVA104": ["bugs", "medium", "equals(Object) is declared without a matching local hashCode().", "Review the equals/hashCode contract, including inherited implementations."],
  "JAVA105": ["bugs", "medium", "A collection-returning method returns null.", "Consider an empty collection, or clearly document the nullable contract."],
  "JAVA106": ["bugs", "high", "A static SimpleDateFormat may be shared across threads.", "Use a thread-safe DateTimeFormatter or explicitly isolate and synchronize access."],
  "JAVA107": ["bugs", "medium", "Statement follows an unconditional return or throw in the same block.", "Remove unreachable statements or correct the control flow."],
  "JAVA201": ["security", "high", "Potential hardcoded credential.", "Load secrets from a secure server-side secret store; rotate exposed credentials."],
  "JAVA202": ["security", "high", "Weak digest algorithm selected.", "Use a modern algorithm appropriate to the use case; password storage requires a password hashing scheme."],
  "JAVA203": ["security", "high", "Weak or insecure cipher configuration selected.", "Review the cryptographic design and use authenticated encryption with appropriate key and nonce handling."],
  "JAVA204": ["security", "medium", "SQL execution receives a concatenated expression.", "Use parameterized queries; verify whether untrusted values can reach this expression."],
  "JAVA205": ["security", "medium", "Potential sensitive value is passed to a logging call.", "Remove or redact sensitive data before logging it."],
  "JAVA301": ["performance", "low", "String concatenation occurs inside a loop.", "Consider StringBuilder when repeated concatenation creates a measurable bottleneck."],
  "JAVA302": ["performance", "low", "An object is allocated inside a loop.", "Review allocation cost. Move creation only if reuse preserves behavior and ownership."],
  "JAVA401": ["quality", "low", "Public mutable field exposes implementation state.", "Review encapsulation; do not change visibility without checking callers."],
  "JAVA402": ["quality", "low", "Class name does not follow the usual PascalCase convention.", "Use a descriptive PascalCase name if the public API can be safely migrated."],
  "JAVA403": ["quality", "low", "Method name does not follow the usual camelCase convention.", "Use a descriptive camelCase name where framework and API contracts permit."],
  "JAVA404": ["quality", "low", "Callable has more than five parameters.", "Consider cohesive parameter objects without changing the public contract blindly."],
  "JAVA405": ["quality", "low", "Callable exceeds 50 token-bearing lines.", "Consider extracting focused methods while preserving behavior."],
  "JAVA406": ["quality", "low", "Redundant empty statement inside a block or type body.", "Remove the standalone empty statement."],
};

export function collectJavaFindings(root) {
  const issues = [];
  const edits = [];
  const report = (id, node) => {
    const [category, severity, issue, advice] = JAVA_RULES[id];
    issues.push({
      category, ruleId: id, severity, issue, description: advice,
      line: node.startPosition.row + 1, column: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
      confidence: ["JAVA101", "JAVA107", "JAVA406"].includes(id) ? "structural" : "review-required",
      fixable: id === "JAVA406",
      ...(category === "security" && { recommendation: advice }),
      ...(category === "performance" && { suggestion: advice }),
      ...(category === "quality" && { improvement: advice }),
    });
  };
  const lines = new Set();
  let decisionPoints = 0;
  for (const node of walk(root)) {
    if (isComment(node)) continue;
    if (node.childCount === 0) {
      for (let line = node.startPosition.row; line <= node.endPosition.row; line += 1) lines.add(line);
    }
    if (["if_statement", ...LOOP_TYPES, "catch_clause", "ternary_expression"].includes(node.type)) decisionPoints += 1;
    if (node.type === "switch_label" && node.children.some((child) => child.type === "case")) decisionPoints += 1;
    if (node.type === "binary_expression" && ["&&", "||"].includes(field(node, "operator")?.text)) decisionPoints += 1;

    if (node.type === "catch_clause" && statements(field(node, "body")).length === 0) report("JAVA101", node);
    if (["if_statement", ...LOOP_TYPES].includes(node.type)) {
      const body = field(node, node.type === "if_statement" ? "consequence" : "body");
      if (body?.type === ";" || body?.type === "empty_statement") report("JAVA102", body);
      const alternative = node.type === "if_statement" ? field(node, "alternative") : null;
      if (alternative?.type === ";" || alternative?.type === "empty_statement") report("JAVA102", alternative);
    }
    if (node.type === "binary_expression" && ["==", "!="].includes(field(node, "operator")?.text)) {
      const left = field(node, "left");
      const right = field(node, "right");
      if (left?.type !== "null_literal" && right?.type !== "null_literal" && (isString(left) || isString(right))) report("JAVA103", node);
    }
    if (CLASS_TYPES.includes(node.type)) {
      const name = field(node, "name");
      if (name && !/^\p{Lu}[\p{L}\p{N}]*$/u.test(name.text)) report("JAVA402", name);
      const methods = field(node, "body")?.namedChildren.filter((item) => item.type === "method_declaration") ?? [];
      const equals = methods.find((item) => field(item, "name")?.text === "equals" && field(item, "type")?.text === "boolean" && !modifiers(item).has("static") && parameters(item).length === 1 && ["Object", "java.lang.Object"].includes(field(parameters(item)[0], "type")?.text));
      const hashCode = methods.some((item) => field(item, "name")?.text === "hashCode" && field(item, "type")?.text === "int" && !modifiers(item).has("static") && parameters(item).length === 0);
      if (equals && !hashCode) report("JAVA104", equals);
    }
    if (node.type === "return_statement" && statements(node)[0]?.type === "null_literal") {
      const callable = nearest(node, CALLABLE_TYPES);
      if (callable?.type === "method_declaration" && TYPE_NAMES.has(typeName(field(callable, "type")))) report("JAVA105", node);
    }
    if (node.type === "field_declaration") {
      const flags = modifiers(node);
      if (flags.has("static") && typeName(field(node, "type")) === "SimpleDateFormat") report("JAVA106", node);
      if (flags.has("public") && !flags.has("final")) report("JAVA401", node);
    }
    if (["block", "constructor_body"].includes(node.type)) {
      let terminal = false;
      for (const statement of statements(node)) {
        if (terminal) report("JAVA107", statement);
        if (["return_statement", "throw_statement"].includes(statement.type)) terminal = true;
      }
    }
    if (node.type === "variable_declarator") {
      const value = stringValue(field(node, "value"));
      if (value && /^(?:password|passwd|secret|api_?key|access_?token)$/i.test(field(node, "name")?.text ?? "")) report("JAVA201", node);
    }
    if (node.type === "method_invocation") {
      const name = field(node, "name")?.text;
      const receiver = receiverName(node);
      const args = statements(field(node, "arguments"));
      const literal = stringValue(args[0]);
      if (["MessageDigest", "java.security.MessageDigest"].includes(receiver) && name === "getInstance" && /^(?:MD5|SHA-?1)$/i.test(literal ?? "")) report("JAVA202", node);
      if (["Cipher", "javax.crypto.Cipher"].includes(receiver) && name === "getInstance" && /^(?:DES|DESede|RC4)(?:\/|$)|\/ECB(?:\/|$)/i.test(literal ?? "")) report("JAVA203", node);
      if (["execute", "executeQuery", "executeUpdate"].includes(name) && args[0]?.type === "binary_expression" && field(args[0], "operator")?.text === "+") report("JAVA204", node);
      if (["log", "logger", "LOGGER", "System.out", "System.err"].includes(receiver) && ["info", "debug", "warn", "error", "trace", "println", "printf", "log"].includes(name)) {
        if (args.some((arg) => [...walk(arg)].some((item) => item.type === "identifier" && /^(password|secret|token|apiKey)$/i.test(item.text)))) report("JAVA205", node);
      }
    }
    if (node.type === "assignment_expression" && field(node, "operator")?.text === "+=" && isString(field(node, "left")) && inLoop(node)) report("JAVA301", node);
    if (node.type === "object_creation_expression" && inLoop(node)) report("JAVA302", node);
    if (["method_declaration", "constructor_declaration"].includes(node.type)) {
      const name = field(node, "name");
      if (node.type === "method_declaration" && name && !/^\p{Ll}[\p{L}\p{N}]*$/u.test(name.text)) report("JAVA403", name);
      if (parameters(node).length > 5) report("JAVA404", node);
      const methodLines = new Set();
      for (const child of walk(node)) {
        if (!child.childCount && !isComment(child)) methodLines.add(child.startPosition.row);
      }
      if (methodLines.size > 50) report("JAVA405", node);
    }
    if (node.type === ";" && ["block", "class_body", "interface_body", "constructor_body"].includes(node.parent?.type)) {
      report("JAVA406", node);
      edits.push({ start: node.startIndex, end: node.endIndex });
    }
  }
  return { issues, edits, metrics: { linesOfCode: lines.size, decisionPoints } };
}
