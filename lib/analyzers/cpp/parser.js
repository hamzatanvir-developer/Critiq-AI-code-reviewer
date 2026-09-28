import { join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

await Parser.init();
// Only the pinned WASM grammar is loaded, never the package's native binding.
// Explicitly traced by next.config.mjs for both deployed analysis routes.
const grammar = await Language.load(
  join(
    process.cwd(),
    "node_modules",
    "tree-sitter-cpp",
    "tree-sitter-cpp.wasm",
  ),
);

export function withCppTree(source, inspect) {
  if (typeof source !== "string" || source.length > 50_000) {
    throw new RangeError(
      "C++ analysis requires a string of at most 50,000 characters.",
    );
  }
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(grammar);
    const deadline = Date.now() + 2_000;
    tree = parser.parse(source, null, {
      progressCallback: () => Date.now() > deadline,
    });
    if (!tree) throw new Error("C++ parsing exceeded its resource budget.");
    return inspect(tree.rootNode);
  } finally {
    tree?.delete();
    parser.delete();
  }
}

export function* walk(root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    yield node;
    pending.push(...node.children.reverse());
  }
}

export const field = (node, name) => node?.childForFieldName(name) ?? null;
export const statements = (node) =>
  node?.namedChildren.filter((child) => child.type !== "comment") ?? [];

export function nearest(node, types) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (types.includes(parent.type)) return parent;
  }
  return null;
}
