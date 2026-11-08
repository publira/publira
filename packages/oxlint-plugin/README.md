# oxlint-plugin

The repository's own oxlint rules. The root `oxlint.config.ts` loads `src/index.ts` through `jsPlugins` as the `publira` plugin, so `pnpm check` runs the rules beside every other one. The module is TypeScript that oxlint loads directly, so the package has no build step.

## Rules

| Rule | Fails on | Where |
| --- | --- | --- |
| `publira/no-jsx-svg` | An `<svg>` element in JSX | Everywhere, except the paths an `oxlint.config.ts` override lists with their reasons |
| `publira/design-tokens` | `rounded-2xl`, `rounded-3xl`, `rounded-[`, `shadow-(sm\|md\|lg\|xl\|2xl)`, `uppercase`, `tracking-[`, and a `font-mono` written anywhere but on a `<code>` or `<pre>` element, in a string or template literal | `apps/` and `packages/`, except test files |

Why each rule exists is in the **Icons** and **Radius, shadow, and the face data is set in** sections of [`apps/AGENTS.md`](../../apps/AGENTS.md).

## Development

```bash
pnpm run test --filter @publira/oxlint-plugin
pnpm typecheck --filter @publira/oxlint-plugin
```

oxlint reads the rules from `src/index.ts` on every run, so a change is picked up by the next `pnpm check` with nothing to rebuild.
