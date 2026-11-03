import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogGluedParentheses,
  gluedParentheses,
  spacesParentheses,
} from "./half-width-parentheses.ts";

// The cases are Japanese: a CJK character beside a parenthesis is the
// behaviour under test.
describe("gluedParentheses", () => {
  it("reports a parenthesis a letter or a digit touches on its outer side", () => {
    assert.deepEqual(gluedParentheses([..."乱数(16進数)です"]), [2, 7]);
    assert.deepEqual(gluedParentheses([..."ECS(Fargate)"]), [3]);
  });

  it("leaves a parenthesis set off with a space or meeting punctuation alone", () => {
    assert.deepEqual(gluedParentheses([..."乱数 (16進数) です"]), []);
    assert.deepEqual(gluedParentheses([..."乱数 (16進数)、または"]), []);
    assert.deepEqual(gluedParentheses([..."「(未追加)」"]), []);
  });
});

describe("catalogGluedParentheses", () => {
  it("reports a parenthesis a letter touches, with the text around it", () => {
    assert.deepEqual(catalogGluedParentheses("有効期限(日数)"), [
      "有効期限(日数)",
    ]);
  });

  it("takes a variable reference for the value it renders", () => {
    assert.deepEqual(catalogGluedParentheses("{$amount}({$currency})です"), [
      "unt}({$cu",
      "ncy})です",
    ]);
  });

  it("leaves a parenthesis set off with a space alone", () => {
    assert.deepEqual(
      catalogGluedParentheses("{$amount} ({$currency}) です"),
      []
    );
    assert.deepEqual(
      catalogGluedParentheses(
        "タイムゾーン ({$time_zone}) の暦日として解釈します。"
      ),
      []
    );
  });
});

describe("spacesParentheses", () => {
  it("holds for Japanese only", () => {
    assert.deepEqual(
      ["ja", "zh-Hans", "zh-Hant", "ko", "en"].map(spacesParentheses),
      [true, false, false, false, false]
    );
  });
});
