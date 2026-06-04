# How to code here

Mostly in plain, simple TypeScript. Keep the package small and avoid heavy
runtime dependencies unless they clearly pay for themselves.

Use scripts only for repository tooling, experiments, and one-off data processing.
Library behavior should live in `src` and be covered by Vitest tests.

Keep public API names aligned with the existing RepTree vocabulary: tree, node,
operation, state vector, move op, and property op.

Keep serialization contracts explicit and documented. Do not duplicate wire formats
across files without a clear source of truth.
