function memberName(node) {
  if (node?.type !== "MemberExpression") return null;
  return node.computed ? node.property.value : node.property.name;
}

// Review candidates, not proven exploits. No automatic security rewrites.
const securityRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const report = (node, message) => context.report({ node, message });
    return {
      AssignmentExpression(node) {
        if (["innerHTML", "outerHTML"].includes(memberName(node.left))) {
          report(node, "HTML assignment requires review: sanitize untrusted HTML or use textContent when markup is not required.");
        }
      },
      CallExpression(node) {
        if (node.callee.type === "MemberExpression" && node.callee.object.name === "document" && ["write", "writeln"].includes(memberName(node.callee))) {
          report(node, "document.write can introduce XSS. Use DOM APIs and validate untrusted content.");
        }
        if (node.callee.type === "MemberExpression" && node.callee.object.name === "localStorage" && memberName(node.callee) === "setItem" && /password|secret|token/i.test(String(node.arguments[0]?.value || ""))) {
          report(node, "Potential sensitive data in localStorage. Review your authentication and storage design.");
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && /^(?:password|secret|api_?key|access_?token)$/i.test(node.id.name) && node.init?.type === "Literal" && typeof node.init.value === "string" && node.init.value.length > 0) {
          report(node, "Potential hardcoded credential. Use an appropriate secret store; do not expose server secrets in client code.");
        }
      },
      Property(node) {
        const name = node.computed ? node.key.value : (node.key.name || node.key.value);
        if (name === "rejectUnauthorized" && node.value?.value === false) {
          report(node, "TLS certificate verification is disabled. Enable verification and configure trusted certificates.");
        }
      },
    };
  },
};

export default securityRule;
