# Local compatibility patch

Upstream: `braces@3.0.3`, MIT license (retained).
Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

The parser stops before pushing an AST nesting level beyond 64, including
parenthesis nodes. Compile, expand and stringify perform an iterative check
before their recursive walkers: maximum depth 64, maximum 65,536 nodes, no
repeated/cyclic child nodes. Parent and previous-node links are not traversed.
Normal glob syntax and expansion algorithms are unchanged. Excessive syntax
now produces a controlled `SyntaxError` before a recursive traversal starts.
The guards cannot be disabled by an options object.

This is a development-only dependency reached by Tailwind/fast-glob/chokidar;
wallet runtime inputs are not passed into it. No upstream patched release was
available on 2026-10-04. Version-based npm audit still reports this package and
its dependent chains; the local patch does not suppress or rename the advisory.

Verification: `tests/dependency-guards.test.cjs`, full CSS/application build and
the GUI checks. Exact original/patched file hashes are retained in
`local-checks/audit-2026-10-04/braces-provenance.json`.
