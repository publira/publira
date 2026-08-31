# tsconfig

The package that provides the TypeScript configuration shared across the workspace.

## What it provides

- `@publira/tsconfig/base.json`
- `@publira/tsconfig/next.json`

## Usage

```json
{
  "extends": "@publira/tsconfig/base.json"
}
```

For a Next.js app:

```json
{
  "extends": "@publira/tsconfig/next.json"
}
```

## Notes

- A configuration change reaches every package, so type-check everything it affects.
- The `lib` in `base.json` includes TypeScript 6.0's `esnext.temporal` (for the `Temporal` types; the runtime polyfill is imported as `temporal-polyfill/global` from each app's `instrumentation` and from the vitest setup).
