import { lintJavaScript } from "./analyzers/javascript/engine.js";
import { fixPython } from "./analyzers/python/engine.js";
import { fixJava } from "./analyzers/java/engine.js";
import { fixCpp } from "./analyzers/cpp/engine.js";

export async function suggestRefactor(code, language) {
  if (["c++", "cpp"].includes(language.toLowerCase())) return fixCpp(code);
  if (language.toLowerCase() === "java") return fixJava(code);
  if (language.toLowerCase() === "python") return fixPython(code);
  if (!["javascript", "react"].includes(language.toLowerCase())) {
    return {
      code,
      appliedRules: [],
      supported: false,
      message: "Automatic fixes are not enabled for this language yet. The original code is preserved; review the reported findings manually.",
    };
  }
  const result = lintJavaScript(code, language, true);
  if (result.messages.some((message) => message.fatal)) {
    return { code, appliedRules: [], supported: true, message: "Resolve syntax errors before applying automatic fixes." };
  }
  return {
    code: result.output,
    appliedRules: result.appliedRules,
    supported: true,
    message: result.output === code
      ? "No supported automatic fixes are available. Remaining findings need manual review; an unchanged score is expected."
      : "Applied vetted ESLint fixes. Test the changes in your project; static checks cannot prove behavioral equivalence.",
  };
}

export async function refactorCode(code, language) {
  return (await suggestRefactor(code, language)).code;
}

export default refactorCode;
