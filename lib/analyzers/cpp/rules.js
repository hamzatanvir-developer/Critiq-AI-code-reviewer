import { field, nearest, statements, walk } from "./parser.js";

const LOOPS = [
  "for_statement",
  "for_range_loop",
  "while_statement",
  "do_statement",
];
const CALLABLES = ["function_definition", "lambda_expression"];
const STRINGS = ["string_literal", "raw_string_literal", "concatenated_string"];
const LITERALS = [
  ...STRINGS,
  "char_literal",
  "comment",
  "preproc_arg",
  "system_lib_string",
];

// A bounded structural profile, not a compiler or ownership checker.
export const CPP_RULES = {
  CPP101: [
    "bugs",
    "high",
    "Empty catch block discards the exception.",
    "Handle or propagate the exception; review any intentional suppression.",
  ],
  CPP102: [
    "bugs",
    "medium",
    "Empty control-flow body may be an accidental semicolon.",
    "Review the intended loop or branch body before changing it.",
  ],
  CPP103: [
    "bugs",
    "medium",
    "Statement follows an unconditional transfer in the same block.",
    "Remove unreachable code or correct the control flow.",
  ],
  CPP104: [
    "bugs",
    "high",
    "Adjacent new and delete use mismatched array forms.",
    "Match new[] with delete[] and scalar new with delete. Prefer explicit RAII ownership.",
  ],
  CPP105: [
    "bugs",
    "high",
    "The same pointer is deleted in consecutive statements.",
    "Release an allocation only once and make ownership explicit.",
  ],
  CPP106: [
    "bugs",
    "high",
    "A pointer is directly dereferenced immediately after deletion.",
    "Do not access an allocation after its lifetime ends.",
  ],
  CPP107: [
    "bugs",
    "medium",
    "Polymorphic class has no public virtual or protected non-virtual destructor.",
    "Review destruction through base pointers. Use a public virtual destructor, or a protected non-virtual destructor if base deletion is forbidden.",
  ],
  CPP201: [
    "security",
    "high",
    "A C buffer-writing function without a destination-size argument is called.",
    "Use a size-aware API or an appropriate standard container; verify bounds and termination. Do not blindly substitute strncpy.",
  ],
  CPP202: [
    "security",
    "medium",
    "A formatted-output call uses a non-literal format expression.",
    "Verify the format is trusted. Pass untrusted text as a data argument, not the format string.",
  ],
  CPP203: [
    "security",
    "high",
    "A scanf string conversion has no field width.",
    "Specify a width that leaves space for the terminator, or use a bounds-aware input API.",
  ],
  CPP204: [
    "security",
    "high",
    "Potential hardcoded credential.",
    "Use a secure secret store and rotate any exposed credential.",
  ],
  CPP205: [
    "security",
    "medium",
    "A shell command execution call requires security review.",
    "Avoid shell interpolation; validate inputs and use an argument-based process API when appropriate.",
  ],
  CPP301: [
    "performance",
    "low",
    "Explicit dynamic allocation occurs in a loop.",
    "Measure allocation cost and review ownership before reusing or moving allocations.",
  ],
  CPP302: [
    "performance",
    "low",
    "A loop is nested inside another loop.",
    "Review input sizes and algorithmic cost; nesting alone does not prove quadratic complexity.",
  ],
  CPP303: [
    "performance",
    "low",
    "std::endl requests a stream flush inside a loop.",
    "Use a newline if flushing on each iteration is unnecessary. Preserve intentional flushes.",
  ],
  CPP401: [
    "quality",
    "low",
    "C-style cast obscures the intended conversion.",
    "Review the types and choose an appropriate named C++ cast; no automatic cast is assumed safe.",
  ],
  CPP402: [
    "quality",
    "low",
    "Callable has more than five parameters.",
    "Consider a cohesive parameter object without blindly changing the API.",
  ],
  CPP403: [
    "quality",
    "low",
    "Function exceeds 50 token-bearing lines.",
    "Consider extracting focused functions while preserving lifetimes and behavior.",
  ],
  CPP404: [
    "quality",
    "low",
    "Redundant standalone empty statement inside a block.",
    "Remove the standalone semicolon, not a loop, branch or label body.",
  ],
  CPP405: [
    "quality",
    "low",
    "A raw allocation is assigned directly to a local variable.",
    "Review ownership and exception safety. Consider RAII; this finding does not prove a memory leak.",
  ],
};

const directExpression = (statement) =>
  statement?.type === "expression_statement" ? statements(statement)[0] : null;

function allocation(statement) {
  if (statement?.type !== "declaration") return null;
  const declarations = statement.childrenForFieldName("declarator");
  if (declarations.length !== 1) return null;
  const init = declarations[0];
  const value = field(init, "value");
  if (value?.type !== "new_expression" || field(value, "placement"))
    return null;
  let name = field(init, "declarator");
  if (name?.type === "pointer_declarator") name = field(name, "declarator");
  if (name?.type !== "identifier") return null;
  return {
    name: name.text,
    array: Boolean(field(value, "declarator")),
    node: value,
  };
}

function deletion(statement) {
  const expression = directExpression(statement);
  if (expression?.type !== "delete_expression") return null;
  const operand = statements(expression)[0];
  if (operand?.type !== "identifier") return null;
  return {
    name: operand.text,
    array: expression.children.some((child) => child.type === "["),
    node: expression,
  };
}

function dereference(node, name) {
  if (!node) return false;
  if (node.type === "pointer_expression")
    return (
      field(node, "operator")?.text === "*" &&
      field(node, "argument")?.text === name
    );
  if (node.type === "subscript_expression")
    return field(node, "argument")?.text === name;
  if (node.type === "field_expression")
    return (
      field(node, "operator")?.text === "->" &&
      field(node, "argument")?.text === name
    );
  return false;
}

const inLoop = (node) =>
  LOOPS.includes(nearest(node, [...LOOPS, ...CALLABLES])?.type);

function callName(node) {
  const callee = field(node, "function");
  if (!callee || !["identifier", "qualified_identifier"].includes(callee.type))
    return "";
  const name = callee.text.replace(/\s+/g, "");
  // Object methods and arbitrary namespaces are not assumed to be libc.
  return /^(?:(?:::)?std::|::)?[A-Za-z_]\w*$/.test(name)
    ? name.replace(/^(?:(?:::)?std::|::)/, "")
    : "";
}

function tokenLines(root) {
  const lines = new Set();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (
      node.type === "comment" ||
      [
        "preproc_def",
        "preproc_function_def",
        "preproc_include",
        "preproc_call",
      ].includes(node.type)
    )
      continue;
    if (LITERALS.includes(node.type) || !node.childCount)
      lines.add(node.startPosition.row);
    else pending.push(...node.children);
  }
  return lines;
}

function checkBlock(block, report) {
  const children = statements(block);
  let terminated = false;
  for (let i = 0; i < children.length; i++) {
    const current = children[i];
    if (
      ["labeled_statement", "case_statement"].includes(current.type) ||
      current.type.startsWith("preproc_")
    )
      terminated = false;
    else if (terminated) {
      report("CPP103", current);
      terminated = false;
    }
    if (
      [
        "return_statement",
        "throw_statement",
        "break_statement",
        "continue_statement",
        "goto_statement",
      ].includes(current.type)
    )
      terminated = true;
    const next = children[i + 1];
    const allocated = allocation(current);
    const releasedNext = deletion(next);
    if (
      allocated &&
      releasedNext?.name === allocated.name &&
      releasedNext.array !== allocated.array
    )
      report("CPP104", releasedNext.node);
    const released = deletion(current);
    if (!released) continue;
    if (releasedNext?.name === released.name)
      report("CPP105", releasedNext.node);
    const expression = directExpression(next);
    // Never scan past calls, alias updates, blocks, branches or reassignments.
    // C++17 evaluates the RHS before the LHS: a call or reassignment there
    // could restore the pointer. Restrict assignments to literal RHS values.
    const literalAssignment =
      expression?.type === "assignment_expression" &&
      ["number_literal", "true", "false", "char_literal", "null"].includes(
        field(expression, "right")?.type,
      ) &&
      dereference(field(expression, "left"), released.name);
    if (dereference(expression, released.name) || literalAssignment)
      report("CPP106", expression);
  }
}

function checkDestructor(node, report) {
  if (node.children.some((child) => child.type === "base_class_clause")) return;
  const members = statements(field(node, "body"));
  if (
    !members.some((member) =>
      member.children.some((child) => child.type === "virtual"),
    )
  )
    return;
  let access = node.type === "struct_specifier" ? "public" : "private";
  let destructor;
  for (const member of members) {
    if (member.type === "access_specifier") access = member.text;
    const declarator = field(member, "declarator");
    if (field(declarator, "declarator")?.type === "destructor_name") {
      destructor = {
        access,
        virtual: member.children.some((child) => child.type === "virtual"),
      };
    }
  }
  if (
    !destructor ||
    (!(destructor.access === "public" && destructor.virtual) &&
      !(destructor.access === "protected" && !destructor.virtual))
  )
    report("CPP107", field(node, "name") ?? node);
}

function checkCall(node, report) {
  const name = callName(node);
  const args = statements(field(node, "arguments"));
  if (["gets", "strcpy", "strcat", "sprintf", "vsprintf"].includes(name))
    report("CPP201", node);
  const formatIndex = { printf: 0, fprintf: 1, sprintf: 1, snprintf: 2 }[name];
  if (
    formatIndex !== undefined &&
    args[formatIndex] &&
    !STRINGS.includes(args[formatIndex].type)
  )
    report("CPP202", node);
  const scanIndex = { scanf: 0, fscanf: 1, sscanf: 1 }[name];
  const format = args[scanIndex];
  if (format && STRINGS.includes(format.type)) {
    const conversions = format.text.matchAll(
      /%(?:%|\*?\d*(?:hh|ll|[hlLjzt])?(?:\[[^\]]*\]|[A-Za-z]))/g,
    );
    if (
      [...conversions].some(([conversion]) =>
        /^%(?:l)?(?:s|\[)/.test(conversion),
      )
    )
      report("CPP203", node);
  }
  if (name === "system" || name === "popen") report("CPP205", node);
}

export function collectCppFindings(root) {
  const issues = [];
  const edits = [];
  const seen = new Set();
  const report = (id, node) => {
    const key = `${id}:${node.startIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [category, severity, issue, advice] = CPP_RULES[id];
    issues.push({
      category,
      ruleId: id,
      severity,
      issue,
      description: advice,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      confidence: [
        "CPP101",
        "CPP103",
        "CPP104",
        "CPP105",
        "CPP106",
        "CPP404",
      ].includes(id)
        ? "structural"
        : "review-required",
      fixable: id === "CPP404",
      ...(category === "security" && { recommendation: advice }),
      ...(category === "performance" && { suggestion: advice }),
      ...(category === "quality" && { improvement: advice }),
    });
  };
  let decisionPoints = 0;
  for (const node of walk(root)) {
    if (
      LOOPS.includes(node.type) ||
      ["if_statement", "catch_clause", "conditional_expression"].includes(
        node.type,
      )
    )
      decisionPoints++;
    if (
      node.type === "binary_expression" &&
      ["&&", "||", "and", "or"].includes(field(node, "operator")?.text)
    )
      decisionPoints++;
    if (node.type === "case_statement" && field(node, "value"))
      decisionPoints++;
    if (
      node.type === "catch_clause" &&
      statements(field(node, "body")).length === 0
    )
      report("CPP101", node);
    if (LOOPS.includes(node.type) || node.type === "if_statement") {
      for (const name of ["body", "consequence", "alternative"]) {
        let body = field(node, name);
        if (body?.type === "else_clause") body = statements(body)[0];
        if (
          body?.type === "expression_statement" &&
          statements(body).length === 0
        )
          report("CPP102", body);
      }
    }
    if (node.type === "compound_statement") checkBlock(node, report);
    if (["class_specifier", "struct_specifier"].includes(node.type))
      checkDestructor(node, report);
    if (node.type === "call_expression") checkCall(node, report);
    if (node.type === "init_declarator") {
      let name = field(node, "declarator");
      if (name?.type === "pointer_declarator") name = field(name, "declarator");
      const value = field(node, "value");
      if (
        name?.type === "identifier" &&
        /(?:password|passwd|secret|api_?key|access_?token)/i.test(name.text) &&
        value &&
        STRINGS.includes(value.type) &&
        value.text.length > 2
      )
        report("CPP204", name);
    }
    if (node.type === "new_expression" && inLoop(node)) report("CPP301", node);
    if (LOOPS.includes(node.type) && inLoop(node)) report("CPP302", node);
    if (
      node.type === "qualified_identifier" &&
      node.text.replace(/\s+/g, "") === "std::endl" &&
      inLoop(node)
    )
      report("CPP303", node);
    if (node.type === "cast_expression" && field(node, "type")?.text !== "void")
      report("CPP401", node);
    if (node.type === "function_declarator") {
      const parameters = statements(field(node, "parameters")).filter((child) =>
        child.type.includes("parameter_declaration"),
      );
      if (parameters.length > 5) report("CPP402", node);
    }
    if (node.type === "function_definition" && tokenLines(node).size > 50)
      report("CPP403", node);
    if (
      node.type === "expression_statement" &&
      statements(node).length === 0 &&
      node.parent?.type === "compound_statement"
    ) {
      report("CPP404", node);
      const semicolon = node.children.find((child) => child.type === ";");
      if (semicolon)
        edits.push({ start: semicolon.startIndex, end: semicolon.endIndex });
    }
    const allocated = allocation(node);
    if (allocated && nearest(node, CALLABLES)) report("CPP405", allocated.node);
  }
  return {
    issues,
    edits,
    metrics: { linesOfCode: tokenLines(root).size, decisionPoints },
  };
}
