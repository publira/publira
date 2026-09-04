/**
 * Weighted review-size scorer.
 *
 * Reads a unified diff on standard input and prints the review-size score and
 * the `size/*` label the score falls into:
 *
 *     git diff origin/main...HEAD | node scripts/pr-size.ts
 *
 * `--json` prints the score, the label, and the per-file breakdown instead, so
 * the `Review` workflow and a calibration run read the same number a human
 * does. The formula is
 *
 *     score = Σ over changed files ( coefficient(path) × significant_lines(file) )
 *
 * A line count on its own says nothing about review load: a lock-file refresh
 * and a rewrite of the session cookie handling both read as a few hundred
 * lines. The coefficients below weigh a line by what it costs to read.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/**
 * gitignore-style pattern to an anchored regular expression. `path.matchesGlob`
 * would do this, but it never lets `**` cross a dot directory, so
 * `.github/workflows/ci.yml` would escape every `**` pattern in the table.
 */
export const globToRegExp = (pattern: string): RegExp => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        while (pattern[index + 1] === "*") {
          index += 1;
        }
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/u, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
};

const matcher = (patterns: readonly string[]) => {
  const expressions = patterns.map(globToRegExp);
  return (file: string) =>
    expressions.some((expression) => expression.test(file));
};

/**
 * Generated and vendored output is already excluded from review by
 * `.gitattributes`, so the coefficient table does not list those paths a second
 * time — it reads them from there.
 */
const generatedPatterns = (): string[] => {
  const contents = readFileSync(path.resolve(root, ".gitattributes"), "utf-8");
  const patterns: string[] = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const [pattern, ...attributes] = trimmed.split(/\s+/u);
    if (
      pattern &&
      attributes.some(
        (attribute) =>
          attribute === "linguist-generated" ||
          attribute === "linguist-vendored"
      )
    ) {
      patterns.push(pattern);
    }
  }
  return patterns;
};

/** Written by a tool, read by nobody. */
const LOCK_FILES = [
  "pnpm-lock.yaml",
  "mobile/pubspec.lock",
  "skills-lock.json",
  ".devcontainer/devcontainer-lock.json",
] as const;

/**
 * First match wins, so a more specific kind sits above the kind that would
 * otherwise swallow it: `locales/*.json` above JSON configuration, `*.test.tsx`
 * above `*.tsx`, documentation above the test tree it lives in.
 *
 * `*.tsx` is discounted for what the tag filter in `isSignificant` cannot
 * reach: the formatter puts one attribute per line, so a component's props
 * arrive as attribute-only and opening-tag lines, each cheaper to read than a
 * line of logic. It is not discounted for being React — the hazards that make a
 * component hard to review sit in a handful of lines and do not grow with the
 * size of the tree.
 */
const COEFFICIENTS: readonly {
  coefficient: number;
  patterns: readonly string[];
}[] = [
  { coefficient: 0, patterns: [...generatedPatterns(), ...LOCK_FILES] },
  {
    coefficient: 0.2,
    patterns: [
      "locales/*.json",
      "**/fixtures/**",
      "**/testdata/**",
      "**/__snapshots__/**",
      "**/*.snap",
    ],
  },
  {
    coefficient: 0.3,
    patterns: ["**/*.md", "**/*.mdx", "**/*.txt", "LICENSE"],
  },
  {
    coefficient: 0.5,
    patterns: [
      "**/*_test.go",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*_test.dart",
      "e2e/**",
      "mobile/test/**",
      "mobile/integration_test/**",
    ],
  },
  {
    coefficient: 0.7,
    patterns: [
      "**/*.yml",
      "**/*.yaml",
      "**/*.json",
      "**/*.json5",
      "**/*.toml",
      "**/*.xml",
      "**/*.properties",
      "**/*.plist",
      "**/*.xcconfig",
    ],
  },
  { coefficient: 0.9, patterns: ["**/*.tsx"] },
  {
    coefficient: 1.5,
    patterns: ["proto/**", "db/migrations/**", "db/query/**"],
  },
];

/**
 * Application and package source, and every path the table does not name. An
 * unfamiliar path is read line by line like source, so it is scored that way
 * rather than discounted for being unfamiliar.
 */
const DEFAULT_COEFFICIENT = 1;

const matchers = COEFFICIENTS.map(({ coefficient: weight, patterns }) => ({
  matches: matcher(patterns),
  weight,
}));

export const coefficient = (file: string): number =>
  matchers.find(({ matches }) => matches(file))?.weight ?? DEFAULT_COEFFICIENT;

/** `{`, `}`, `(`, `)`, `[`, `]`, `,`, `;`, and combinations such as `});`. */
const DELIMITER_ONLY = /^[{}()[\],;]+$/u;

/**
 * One whole JSX tag and nothing else — `</Card>`, `<Separator />`,
 * `<CardHeader>`, `<>`, `</>` — or the `>` / `/>` that closes a tag the
 * formatter broke across lines. A closing tag is the JSX brace: it carries as
 * much information as the `}` beside it and is dropped for the same reason.
 */
const JSX_TAG_ONLY = /^(?:<\/?[A-Za-z][\w.]*\s*\/?>|<\/?>|\/?>)$/u;

export const isSignificant = (line: string): boolean => {
  const trimmed = line.trim();
  return (
    trimmed !== "" &&
    !DELIMITER_ONLY.test(trimmed) &&
    !JSX_TAG_ONLY.test(trimmed)
  );
};

export interface FileScore {
  coefficient: number;
  file: string;
  score: number;
  significantLines: number;
}

const stripPrefix = (value: string): string =>
  value.replace(/\t.*$/u, "").replace(/^[ab]\//u, "");

/**
 * Added and removed lines together, per file, minus the lines that carry no
 * information.
 *
 * A `+`/`-` line inside a hunk is content even when it reads like a header —
 * removing a Markdown rule `-- x` produces `--- x` — so the hunk state is
 * consulted before the `---` / `+++` header lines are.
 */
export const significantLinesByFile = (diff: string): Map<string, number> => {
  const counts = new Map<string, number>();
  let oldPath = "";
  let file = "";
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = "";
      file = "";
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line === "" || line.startsWith(" ") || line.startsWith("\\")) {
        continue;
      }
      if (line.startsWith("+") || line.startsWith("-")) {
        if (isSignificant(line.slice(1))) {
          counts.set(file, (counts.get(file) ?? 0) + 1);
        }
        continue;
      }
      inHunk = false;
    }
    if (line.startsWith("--- ")) {
      oldPath = stripPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = stripPrefix(line.slice(4));
      file = newPath === "/dev/null" ? oldPath : newPath;
      if (file) {
        counts.set(file, counts.get(file) ?? 0);
      }
    }
  }

  return counts;
};

export const scoreDiff = (
  diff: string
): { files: FileScore[]; score: number } => {
  const files = [...significantLinesByFile(diff)].map(
    ([file, significantLines]): FileScore => {
      const weight = coefficient(file);
      return {
        coefficient: weight,
        file,
        score: Math.round(weight * significantLines * 10) / 10,
        significantLines,
      };
    }
  );
  const total = files.reduce((sum, entry) => sum + entry.score, 0);
  return { files, score: Math.round(total * 10) / 10 };
};

/**
 * Over the last 40 pull requests this repository merged, these thresholds put
 * 16 in `size/xs`, 14 in `size/s`, 8 in `size/m`, and one each in `size/l` and
 * `size/xl` — which is what the list should say: most changes here are a short
 * read, and the few that are not stand out.
 */
const BUCKETS: readonly { label: string; max: number }[] = [
  { label: "size/xs", max: 60 },
  { label: "size/s", max: 200 },
  { label: "size/m", max: 600 },
  { label: "size/l", max: 1600 },
  { label: "size/xl", max: Number.POSITIVE_INFINITY },
];

export const LABELS: readonly string[] = BUCKETS.map(({ label }) => label);

export const bucket = (score: number): string => {
  const found = BUCKETS.find(({ max }) => score <= max);
  if (!found) {
    throw new Error(`No bucket for score ${score}`);
  }
  return found.label;
};

if (import.meta.main) {
  const diff = readFileSync(0, "utf-8");
  const { files, score } = scoreDiff(diff);
  const label = bucket(score);
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ files, label, score }, null, 2)}\n`
    );
  } else {
    process.stdout.write(`score: ${score}\nlabel: ${label}\n`);
  }
}
