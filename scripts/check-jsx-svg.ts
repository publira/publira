/**
 * Fail on an `<svg>` element written into JSX outside the places allowed one.
 *
 *     pnpm jsx-svg:check
 *
 * Icons come from `@publira/icons`, and `packages/icons` is the only place a
 * raw `<svg>` normally lives. A hand-written one elsewhere draws an icon the
 * set does not know about, at a stroke and a size the set does not hold it to,
 * and `pnpm check` cannot see it: the `lucide-react` import that
 * `no-restricted-imports` refuses is not there to refuse.
 *
 * The search runs over the files Git sees, untracked ones included, so a new
 * component is checked before it is ever committed, and anything `.gitignore`
 * leaves out — a build output, `node_modules` — is not.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";

/** The files whose JSX could hold an element. */
const SOURCES = ["*.tsx", "*.jsx"];

/** The paths allowed an `<svg>`, each with the reason nothing else will do. */
const EXCEPTIONS = [
  // The icon set itself, which every other screen draws from.
  "packages/icons/src/**",
  // A generated image rather than an icon: the geometry is computed from the
  // text it encodes, and the fixed black-on-white palette is what makes the
  // code scannable, so nothing in @publira/icons could stand in for it.
  "packages/ui-components/src/qr-code/qr-code.tsx",
  // A chart rather than an icon: its bars and lines are drawn from the figures
  // a screen hands it, in a box the screen sizes, which no fixed glyph can be.
  "packages/ui-components/src/chart/chart.tsx",
];

export interface Finding {
  file: string;
  line: number;
}

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const GIT = "/usr/bin/git";

/** Every `<svg>` outside {@link EXCEPTIONS} in the repository at {@link repository}. */
export const scan = async (repository = process.cwd()): Promise<Finding[]> => {
  const git = spawn(
    GIT,
    [
      "grep",
      "--untracked",
      "-n",
      "-z",
      "--fixed-strings",
      "<svg",
      "--",
      ...SOURCES,
      ...EXCEPTIONS.map((exception) => `:!${exception}`),
    ],
    { cwd: repository, stdio: ["ignore", "pipe", "inherit"] }
  );

  const [output, [code]] = await Promise.all([
    text(git.stdout),
    once(git, "close"),
  ]);

  // `git grep` exits 1 when nothing matched, which is the passing case.
  if (code === 1) {
    return [];
  }

  if (code !== 0) {
    throw new Error(`git grep exited with ${code}`);
  }

  // `-z` ends the path and the line number with a NUL, and the content with a
  // newline as usual.
  return output
    .split("\n")
    .filter((record) => record !== "")
    .map((record) => {
      const [file = "", line = ""] = record.split("\0");

      return { file, line: Number(line) };
    });
};

const report = (finding: Finding): void => {
  const message =
    "Use an icon from @publira/icons instead of writing <svg> in JSX. See apps/AGENTS.md.";

  if (process.env.GITHUB_ACTIONS) {
    console.error(
      `::error file=${finding.file},line=${finding.line}::${message}`
    );

    return;
  }

  console.error(`${finding.file}:${finding.line}: ${message}`);
};

const main = async (): Promise<void> => {
  const findings = await scan();

  if (findings.length > 0) {
    for (const finding of findings) {
      report(finding);
    }

    process.exitCode = 1;

    return;
  }

  console.log(
    "No JSX outside @publira/icons and its documented exceptions writes its own <svg>."
  );
};

/**
 * The unit test imports {@link scan} against a repository of its own, so the
 * scan of this checkout only starts when this file is the program.
 */
if (process.argv[1] === import.meta.filename) {
  await main();
}
