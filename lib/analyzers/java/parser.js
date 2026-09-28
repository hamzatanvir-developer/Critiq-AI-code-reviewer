import { join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

await Parser.init();
// Use the same pinned grammar as the formatter. No repository code/config is loaded.
// A project-root asset path avoids bundlers rewriting require.resolve to a module ID.
// next.config.mjs explicitly includes this asset in both route deployment traces.
const grammar = await Language.load(join(
  process.cwd(), "node_modules", "prettier-plugin-java", "dist",
  "tree-sitter-java_orchard.wasm",
));

export function withJavaTree(source, inspect) {
  if (typeof source !== "string" || source.length > 50_000) {
    throw new RangeError("Java analysis requires a string of at most 50,000 characters.");
  }
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(grammar);
    const deadline = Date.now() + 2_000;
    tree = parser.parse(source, null, { progressCallback: () => Date.now() > deadline });
    if (!tree) throw new Error("Java parsing exceeded its resource budget.");
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
export const isComment = (node) => ["line_comment", "block_comment"].includes(node.type);
export const statements = (node) => node?.namedChildren.filter((child) => !isComment(child)) ?? [];

export function modifiers(node) {
  return new Set(node.namedChildren.find((child) => child.type === "modifiers")?.children.map((child) => child.text) ?? []);
}

export function nearest(node, types) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (types.includes(parent.type)) return parent;
  }
  return null;
}
