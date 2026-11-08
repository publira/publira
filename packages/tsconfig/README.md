# tsconfig

The package that provides the TypeScript configuration shared across the workspace.

## What it provides

- `@publira/tsconfig/base.json`
- `@publira/tsconfig/library.json`: `base.json` plus `isolatedDeclarations`, for a package whose declarations tsdown emits
- `@publira/tsconfig/next.json`

## Usage

```json
{
  "extends": "@publira/tsconfig/base.json"
}
```

For a package that tsdown builds with `dts`:

```json
{
  "extends": "@publira/tsconfig/library.json"
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
