import eslint from "eslint/universal";
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import securityRule from "./securityRule.js";

const { Linter } = eslint;
// Never load repository configuration or execute submitted code.
const FIX_RULES = new Set(["no-var", "prefer-const", "eqeqeq"]);

function configuration(language, collectMetrics) {
  const isReact = language.toLowerCase() === "react";
  return {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    plugins: {
      react,
      "react-hooks": hooks,
      critiq: { rules: { security: securityRule, metrics: { create: collectMetrics } } },
    },
    settings: { react: { version: "19.2" } },
    rules: {
      ...js.configs.recommended.rules,
      ...(isReact ? react.configs.recommended.rules : {}),
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/display-name": "off",
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": isReact ? "error" : "off",
      "react-hooks/exhaustive-deps": isReact ? "warn" : "off",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-unsafe-optional-chaining": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "max-params": ["warn", 5],
      "max-depth": ["warn", 4],
      "complexity": ["warn", 10],
      "max-lines-per-function": ["warn", { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }],
      "critiq/security": "warn",
      "critiq/metrics": "warn",
    },
  };
}

function measure(context, metrics) {
  const decision = () => { metrics.decisionPoints += 1; };
  return {
    "Program:exit"() {
      const lines = new Set();
      for (const token of context.sourceCode.ast.tokens) {
        for (let line = token.loc.start.line; line <= token.loc.end.line; line += 1) lines.add(line);
      }
      metrics.linesOfCode = lines.size;
    },
    IfStatement: decision,
    ForStatement: decision,
    ForInStatement: decision,
    ForOfStatement: decision,
    WhileStatement: decision,
    DoWhileStatement: decision,
    CatchClause: decision,
    ConditionalExpression: decision,
    LogicalExpression: decision,
    SwitchCase(node) { if (node.test) decision(); },
  };
}

export function lintJavaScript(code, language = "JavaScript", fix = false) {
  const linter = new Linter();
  const metrics = { linesOfCode: 0, decisionPoints: 0 };
  const config = configuration(language, (context) => measure(context, metrics));
  const options = { filename: "snippet.js", allowInlineConfig: false };
  if (!fix) return { messages: linter.verify(code, config, options), metrics };
  const appliedRules = new Set();
  const fixed = linter.verifyAndFix(code, config, {
    ...options,
    fix(message) {
      if (!FIX_RULES.has(message.ruleId)) return false;
      appliedRules.add(message.ruleId);
      return true;
    },
  });
  return { ...fixed, appliedRules: [...appliedRules] };
}
