import { withCppTree, walk } from "../lib/analyzers/cpp/parser.js";

// Developer fixture helper; parses but never executes the supplied source.
const source =
  process.argv[2] ??
  `
int f(int n) {
  int *p = new int[3]; delete p; delete[] p; *p = 2;
  if(n); ; return n; foo();
}
class Base { public: virtual void f() {} };
void g() { printf(input); scanf("%s", buf); auto p = new int; }
`;
withCppTree(source, (root) => {
  console.log(root.toString());
  for (const node of walk(root)) {
    if (node.isNamed)
      console.log(
        node.type,
        JSON.stringify(node.text),
        node.children.map((child, i) => [
          node.fieldNameForChild(i),
          child.type,
        ]),
      );
  }
});
