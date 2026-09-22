import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findAgentCoAuthors } from "./check-agent-trailer.ts";

const commit = (...trailers: string[]): string =>
  ["feat(web-host): add episode access gate", "", ...trailers, ""].join("\n");

describe("findAgentCoAuthors", () => {
  it("rejects an agent co-author in every capitalization of the token", () => {
    for (const token of [
      "Co-authored-by",
      "Co-Authored-By",
      "co-authored-by",
      "CO-AUTHORED-BY",
    ]) {
      assert.deepEqual(
        findAgentCoAuthors(
          commit(`${token}: Claude Opus 5.5 <noreply@anthropic.com>`)
        ),
        [`${token}: Claude Opus 5.5 <noreply@anthropic.com>`]
      );
    }
  });

  it("recognizes agents by name or by address", () => {
    for (const trailer of [
      "Co-authored-by: Claude <noreply@anthropic.com>",
      "Co-authored-by: Claude Code <claude@example.com>",
      "Co-authored-by: Codex <codex@openai.com>",
      "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>",
      "Co-authored-by: Cursor Agent <cursoragent@cursor.com>",
      "Co-authored-by: gemini-code-assist[bot] <bot@example.com>",
      "Co-authored-by: devin-ai-integration[bot] <bot@example.com>",
      "Co-authored-by: aider (gpt-5) <noreply@aider.chat>",
    ]) {
      assert.deepEqual(findAgentCoAuthors(commit(trailer)), [trailer]);
    }
  });

  it("passes the Assisted-by trailer and co-authors who are people", () => {
    assert.deepEqual(
      findAgentCoAuthors(
        commit(
          "Co-authored-by: Claude Monet <claude@example.com>",
          "Co-authored-by: renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>",
          "Assisted-by: Claude Code:claude-opus-5"
        )
      ),
      []
    );
  });

  it("ignores comment lines and the diff that --verbose appends", () => {
    assert.deepEqual(
      findAgentCoAuthors(
        [
          commit("Assisted-by: Claude Code:claude-opus-5"),
          "# Co-authored-by: Claude <noreply@anthropic.com>",
          "# ------------------------ >8 ------------------------",
          "Co-authored-by: Claude <noreply@anthropic.com>",
        ].join("\n")
      ),
      []
    );
  });
});
