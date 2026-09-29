# TypeScript executed directly by Node.js

For TypeScript that Node.js can execute by stripping types, use Node.js directly. The default development command is `node --watch path/to/entry.ts`; do not add `tsx` merely by convention or to omit relative import extensions. Type stripping and `node --watch` do not type-check; use `pnpm preflight` to verify types.

Use this policy only for code executed directly by Node.js, not for existing build, test, or framework toolchains. Node.js ignores `tsconfig.json` at runtime, so direct execution must not depend on TypeScript-only transforms or resolution settings such as `paths` or `moduleResolution`. Node.js still resolves `package.json` `imports` and `exports` at runtime.

The directly executed code must stay within Node.js's erasable TypeScript syntax:

- Relative ESM imports, including dynamic `import()` expressions, include their `.ts` extension: `import { run } from "./run.ts"`; `await import("./run.ts")`.
- Type-only bindings use `import type` (and `export type` when re-exporting).
- Do not use syntax that needs transformation, including `enum`, parameter properties, runtime namespaces, JSX, or decorators. Prefer JavaScript equivalents such as objects/unions, explicit fields assigned in a constructor, modules, and functions.

Consider `tsx` or another runtime only when a concrete requirement cannot be met by Node.js type stripping. State that requirement with the dependency—for example, non-erasable TypeScript syntax that must be transformed, JSX/other source transforms, or required resolution/configuration behavior that Node.js does not provide. Keep the runtime scoped to that need.
