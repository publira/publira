/**
 * Claude Code hook: runs `task deps` in a worktree Claude Code created, so that
 * its first commit finds the `node_modules/.bin/oxfmt` lefthook's `pre-commit`
 * runs.
 *
 *     node scripts/worktree-deps.ts < hook-input.json
 *
 * `.claude/settings.json` runs it on `SessionStart` (a session started with
 * `claude --worktree` or resumed into one) and after `EnterWorktree`. It acts
 * only on a checkout under `.claude/worktrees/` that has no `node_modules/`:
 * `SessionStart` fires in the main checkout too, and a worktree added by hand
 * is its owner's to set up.
 *
 * `task deps` writes to stderr. Stdout carries the one line it prints after an
 * install, because Claude Code reads a `SessionStart` hook's stdout into the
 * conversation.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { text } from "node:stream/consumers";

import { isJsonObject, isJsonString } from "./json-value.ts";
import type { JsonValue } from "./json-value.ts";

const WORKTREES = "/.claude/worktrees/";

/** What a path is quoted in. */
const QUOTE = /["'`“”‘’<>]/u;

/** What separates an unquoted path from the prose around it. */
const SEPARATOR = /[\s"'`“”‘’<>]/u;

/** Punctuation that closes the sentence a path was quoted in. */
const TRAILING_PUNCTUATION = ".,;:!?)]";

/**
 * The absolute paths through a `.claude/worktrees/` directory that `value`
 * may mention: `EnterWorktree` reports the path it created inside a sentence.
 * The whole value and each quoted part come before the words, so that a path
 * holding a space is tried whole.
 */
const worktreePaths = (value: string): string[] =>
  [value, ...value.split(QUOTE), ...value.split(SEPARATOR)].flatMap((word) => {
    if (!word.includes(WORKTREES)) {
      return [];
    }

    let end = word.length;

    while (end > 0 && TRAILING_PUNCTUATION.includes(word.charAt(end - 1))) {
      end -= 1;
    }

    return [word.slice(word.indexOf("/"), end)];
  });

/**
 * The checkout under `.claude/worktrees/` that `target` lies in. A worktree's
 * name may hold `/`, so the root is the nearest directory with a `.git` rather
 * than the first segment after `worktrees/`.
 */
export const worktreeRoot = (target: string): string | undefined => {
  const resolved = path.resolve(target);
  const marker = resolved.lastIndexOf(WORKTREES);

  if (marker === -1) {
    return undefined;
  }

  const container = resolved.slice(0, marker + WORKTREES.length);

  for (
    let directory = resolved;
    directory.startsWith(container);
    directory = path.dirname(directory)
  ) {
    if (existsSync(path.join(directory, ".git"))) {
      return directory;
    }
  }

  return undefined;
};

const strings = (value: JsonValue): string[] => {
  if (isJsonString(value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(strings);
  }

  if (isJsonObject(value)) {
    return Object.values(value).flatMap(strings);
  }

  return [];
};

/**
 * The worktree a hook input points at: its `cwd`, then any path to a worktree
 * another field of the input mentions.
 */
export const findWorktree = (input: JsonValue): string | undefined => {
  const cwd = isJsonObject(input) ? input.cwd : undefined;

  const candidates = [
    ...(isJsonString(cwd) ? [cwd] : []),
    ...strings(input).flatMap(worktreePaths),
  ];

  for (const candidate of candidates) {
    const root = worktreeRoot(candidate);

    if (root !== undefined) {
      return root;
    }
  }

  return undefined;
};

const main = async (): Promise<void> => {
  const root = findWorktree(JSON.parse(await text(process.stdin)));

  if (root === undefined || existsSync(path.join(root, "node_modules"))) {
    return;
  }

  console.error(`Running task deps in ${root}`);

  // `task` is wherever the contributor installed it (Dev Container image,
  // Homebrew, `go install`), and running theirs is the point of the hook.
  // oxlint-disable-next-line sonarjs/no-os-command-from-path
  const result = spawnSync("task", ["deps"], {
    cwd: root,
    stdio: ["ignore", 2, 2],
  });

  if (result.error !== undefined || result.status !== 0) {
    const reason =
      result.error?.message ??
      (result.signal === null
        ? `exit status ${result.status}`
        : `killed by ${result.signal}`);

    console.error(
      `task deps failed in ${root} (${reason}); run it there by hand before committing.`
    );
    process.exitCode = 1;

    return;
  }

  process.stdout.write(`Installed the dependencies of ${root}.\n`);
};

if (import.meta.main) {
  await main();
}
