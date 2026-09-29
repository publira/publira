/**
 * `commit-msg` hook: rejects a co-author trailer that names an AI coding agent.
 *
 *     node scripts/check-agent-trailer.ts .git/COMMIT_EDITMSG
 *
 * An agent is disclosed with `Assisted-by: <AGENT_NAME>:<MODEL_VERSION>`, never
 * as a co-author, and co-author trailers naming humans pass untouched.
 */

import { readFile } from "node:fs/promises";

/**
 * Git and GitHub read the trailer token case-insensitively, so every spelling
 * of it is the same trailer.
 */
const CO_AUTHOR = /^co-authored-by\s*:(?<value>.*)$/iu;

/**
 * Matched against the trailer's name and address together. A bare `claude`,
 * `cursor`, or `gemini` is not enough, and neither is a company's domain: those
 * are also people's names and their employers' addresses.
 */
const AGENTS: readonly RegExp[] = [
  /\bnoreply@anthropic\.com\b/iu,
  /\bclaude (?:code|fable|haiku|opus|sonnet)\b/iu,
  /\bchatgpt\b/iu,
  /\bcodex\b/iu,
  /\bcopilot\b/iu,
  /\bcursoragent@cursor\.com\b/iu,
  /\bcursor agent\b/iu,
  /\bgemini-code-assist\b/iu,
  /\bdevin-ai-integration\b/iu,
  /\bnoreply@aider\.chat\b/iu,
];

/** `git commit --verbose` appends the diff below this line. */
const SCISSORS = "# ------------------------ >8 ------------------------";

/** The co-author trailers in `message` that name an agent, as written. */
export const findAgentCoAuthors = (message: string): string[] =>
  message
    .split(SCISSORS)[0]
    .split("\n")
    // `git commit` strips comment lines only after the hook has read the file.
    .filter((line) => !line.startsWith("#"))
    .filter((line) => {
      const value = CO_AUTHOR.exec(line)?.groups?.value;

      return value !== undefined && AGENTS.some((agent) => agent.test(value));
    })
    .map((line) => line.trim());

const main = async () => {
  const path = process.argv.at(2);
  if (path === undefined) {
    console.error("usage: node scripts/check-agent-trailer.ts <message-file>");
    process.exitCode = 2;

    return;
  }

  const findings = findAgentCoAuthors(await readFile(path, "utf-8"));
  if (findings.length === 0) {
    return;
  }

  for (const finding of findings) {
    console.error(`co-author trailer names an AI agent: ${finding}`);
  }
  console.error(
    [
      "",
      "Disclose the agent with an Assisted-by trailer instead (see AGENTS.md):",
      "",
      '  git commit --trailer "Assisted-by: Claude Code:claude-opus-5"',
    ].join("\n")
  );
  process.exitCode = 1;
};

if (process.argv[1] === import.meta.filename) {
  await main();
}
