import type { InlineConfig } from "vitest/node";

/**
 * The Vitest options every package here shares, spread into its own
 * `defineConfig` so a package still owns its environment and setup files.
 *
 * `turbo run test` already runs the packages in parallel, one Vitest per
 * package. Left to itself each of those sizes a worker pool from the machine's
 * core count as though it were the only thing running, so the workers across
 * all of them outnumber the cores several times over. What that costs is not
 * throughput but determinism: a timeout is wall clock, so a worker waiting for
 * a core spends the budget without running, and tests that pass in well under
 * a second on their own fail with `Test timed out`. Past a certain pressure
 * Vitest stops being able to start a worker at all.
 *
 * One worker per package leaves the parallelism to turbo, the layer that knows
 * how many packages there are. Raising `testTimeout` instead was tried and does
 * not fix it — at 30s the same tests still timed out — and it would have cost
 * the timeout its only real use, catching a test that has genuinely hung.
 */
export const sharedTestOptions = {
  maxWorkers: 1,
} as const satisfies InlineConfig;
