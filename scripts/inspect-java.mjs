import { withJavaTree, walk, field } from '../lib/analyzers/java/parser.js';
withJavaTree(`import java.text.SimpleDateFormat;
class Foo { public String password="abc"; static SimpleDateFormat format=new SimpleDateFormat();
  public boolean equals(Object x){return true;}
  void f(String a, String b) { ; if (a == b) {} try { f(a,b); } catch(Exception e) { /* skip */ } }
}`, root => {
  console.log(root.toString());
  for(const node of walk(root)) {
    if(['binary_expression','method_declaration','variable_declarator','field_declaration','catch_clause','empty_statement'].includes(node.type))
      console.log(node.type, node.text, Object.fromEntries(['name','type','body','left','right','operator','parameters','value','condition'].map(k=>[k,field(node,k)?.text])));
  }
});
