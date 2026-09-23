/**
 * Fail on the utility classes the design brief replaced.
 *
 *     node scripts/check-design-tokens.ts
 *
 * The brief pins two radii (`rounded-control`, `rounded-surface`) and one
 * shadow (`shadow-floating`), and it rejects the tracked-out all-caps eyebrow
 * and the monospace face for small data outright. Every one of those is a class
 * a screen can reach for again in a single line, and none of them is a mistake
 * a reviewer reliably catches: the markup looks fine on its own, and only the
 * screen standing next to it says otherwise. So the classes themselves are what
 * this checks.
 *
 * `font-mono` is the one with an allowance rather than a ban. A console has one
 * typeface for its data — an identifier is set in the sans face with tabular
 * figures, and a copy control is what gives an operator the exact value — but
 * source code is genuinely a different kind of text, and the face is what makes
 * it readable. So the face is allowed where the element says it is code, and
 * refused everywhere else.
 *
 * CI runs this in `Check`, beside the step that keeps hand-written `<svg>` out
 * of JSX, and it is worth running before a push for the same reason that one
 * is: the fix is a class name, and finding it locally costs nothing.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";

/** The directories whose screens the brief governs. */
const ROOTS = ["apps", "packages"];

const SKIP_DIRECTORIES = new Set([
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "test-results",
]);

const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);

/**
 * A test names a class in order to assert something about it, which is the
 * opposite of using one: `theme-preview.test.tsx` renders the preview and
 * checks that no gradient utility came back. Reading those as usages would
 * make the guard fire on the tests that defend the same rule.
 */
const isTestFile = (file: string): boolean =>
  /\.(?:test|spec)\.[jt]sx?$/u.test(file);

interface Rule {
  /** Why the class is gone, and what stands in for it. */
  advice: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    advice:
      "Two radii only: `rounded-control` for inputs, buttons and chips, `rounded-surface` for artwork and floating layers. An in-flow surface such as a card or a table has none.",
    pattern: /\brounded-(?:2xl|3xl|\[)/gu,
  },
  {
    advice:
      "One shadow, on floating layers only: `shadow-floating`. An in-flow surface is separated from the page by a hairline or by a step from `background` to `card`.",
    pattern: /\bshadow-(?:sm|md|lg|xl|2xl)\b/gu,
  },
  {
    advice:
      "The brief has no all-caps eyebrow: a label appears only when the content underneath needs the distinction, and it is set in sentence case.",
    pattern: /\buppercase\b/gu,
  },
  {
    advice:
      "Letter-spacing is the type scale's decision, not a screen's. Drop the tracking rather than tuning it per screen.",
    pattern: /\btracking-\[/gu,
  },
];

const MONOSPACE = /\bfont-mono\b/gu;

/** The elements whose content is code, and may therefore be set in that face. */
const CODE_ELEMENTS = new Set(["code", "pre"]);

/**
 * The JSX element a match sits inside, read as the nearest tag opened before it.
 *
 * `className` is written on the element itself in this repository — through
 * `cn()` or a template literal, but always on the element — so the last tag
 * name before the match is the element that carries the class.
 */
const enclosingElement = (source: string, index: number): string | null => {
  const openings = source.slice(0, index).matchAll(/<(?<tag>[A-Za-z][\w.]*)/gu);
  let last: string | null = null;
  for (const opening of openings) {
    last = opening.groups?.tag ?? null;
  }

  return last;
};

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

export interface Finding {
  advice: string;
  file: string;
  line: number;
  match: string;
}

export const findInFile = (file: string, source: string): Finding[] => {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      findings.push({
        advice: rule.advice,
        file,
        line: lineOf(source, match.index),
        match: match[0],
      });
    }
  }

  for (const match of source.matchAll(MONOSPACE)) {
    const element = enclosingElement(source, match.index);
    if (element && CODE_ELEMENTS.has(element)) {
      continue;
    }
    findings.push({
      advice:
        "The console has one typeface for its data. `font-mono` belongs on a `<code>` or `<pre>` element; an identifier is set in the sans face with `tabular-nums`, beside a copy control where the exact value matters (`Identifier` in @publira/ui-components).",
      file,
      line: lineOf(source, match.index),
      match: match[0],
    });
  }

  return findings;
};

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return SKIP_DIRECTORIES.has(entry.name) ? [] : await walk(entryPath);
      }
      if (isTestFile(entry.name)) {
        return [];
      }

      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
    })
  );

  return files.flat();
};

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const GIT = "/usr/bin/git";

/**
 * The files `.gitattributes` marks `linguist-generated`. Generated code such as
 * buf's output carries proto doc comments verbatim, so a word like "uppercase"
 * there is prose, not a class a screen uses.
 */
const generatedFiles = async (
  repository: string,
  files: string[]
): Promise<Set<string>> => {
  const git = spawn(
    GIT,
    ["check-attr", "-z", "--stdin", "linguist-generated"],
    { cwd: repository, stdio: ["pipe", "pipe", "inherit"] }
  );
  git.stdin.end(files.join("\0"));
  const [output, [code]] = await Promise.all([
    text(git.stdout),
    once(git, "close"),
  ]);
  if (code !== 0) {
    throw new Error(`git check-attr exited with ${code}`);
  }

  // `-z` prints each path, attribute, and value as a NUL-terminated triple.
  const fields = output.split("\0");
  const generated = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] === "set") {
      generated.add(fields[index] ?? "");
    }
  }

  return generated;
};

/**
 * Every finding in the hand-written sources under {@link roots}, which are
 * relative to {@link repository}, as are the files the findings name.
 */
export const scan = async (
  roots: string[],
  repository = process.cwd()
): Promise<Finding[]> => {
  const walked = await Promise.all(
    roots.map((root) => walk(path.join(repository, root)))
  );
  const files = walked.flat().map((file) => path.relative(repository, file));
  const generated = await generatedFiles(repository, files);
  const sources = await Promise.all(
    files
      .filter((file) => !generated.has(file))
      .map(async (file) => ({
        file,
        source: await readFile(path.join(repository, file), "utf-8"),
      }))
  );

  return sources.flatMap(({ file, source }) => findInFile(file, source));
};

const report = (finding: Finding): void => {
  const message = `\`${finding.match}\` is not a class this design uses. ${finding.advice}`;
  if (process.env.GITHUB_ACTIONS) {
    console.error(
      `::error file=${finding.file},line=${finding.line}::${message}`
    );

    return;
  }
  console.error(`${finding.file}:${finding.line}: ${message}`);
};

const main = async (): Promise<void> => {
  const findings = await scan(ROOTS);

  if (findings.length > 0) {
    for (const finding of findings) {
      report(finding);
    }
    process.exitCode = 1;

    return;
  }

  console.log(
    `${ROOTS.join(" and ")}: no screen reaches for a radius, a shadow, or a face the design brief replaced.`
  );
};

/**
 * The unit test imports {@link findInFile} rather than running the walk, so the
 * scan only starts when this file is the program.
 */
if (process.argv[1] === import.meta.filename) {
  await main();
}
