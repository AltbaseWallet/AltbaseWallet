'use strict';
// Bound recursive AST walkers before entering them. Parent/prev links are
// intentionally excluded; parser-created ASTs have those back references.
module.exports = ast => {
  const pending = [[ast, 0]], seen = new Set();
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) throw new SyntaxError('Invalid brace syntax tree');
    if (depth > 64 || ++count > 65536) throw new SyntaxError('Brace syntax tree exceeds the traversal limit');
    seen.add(node);
    if (node.nodes) {
      if (!Array.isArray(node.nodes) || node.nodes.length > 65536 - count) throw new SyntaxError('Invalid brace syntax tree');
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};
