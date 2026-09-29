import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cjkLatinSpaces,
  leavesSpacingToRenderer,
} from "./cjk-latin-spacing.ts";

describe("cjkLatinSpaces", () => {
  it("reports a space between CJK text and Latin text or digits", () => {
    assert.deepEqual(cjkLatinSpaces("次の URL を開く"), [
      "次の URL ",
      " URL を開く",
    ]);
    assert.deepEqual(cjkLatinSpaces("第 5 话"), ["第 5 话", "第 5 话"]);
    assert.deepEqual(cjkLatinSpaces("Publira 管理画面"), ["lira 管理画面"]);
  });

  it("reports a space between CJK text and a variable reference", () => {
    assert.deepEqual(cjkLatinSpaces("1ページあたり {$count} 件"), [
      "ジあたり {$co",
      "unt} 件",
    ]);
  });

  it("leaves text written without the space alone", () => {
    assert.deepEqual(cjkLatinSpaces("1ページあたり{$count}件"), []);
    assert.deepEqual(cjkLatinSpaces("次のURLを開く"), []);
  });

  it("leaves a space next to punctuation or between Latin words alone", () => {
    assert.deepEqual(cjkLatinSpaces("「Summer Days」 を読む"), []);
    assert.deepEqual(cjkLatinSpaces("作品 / Series"), []);
    assert.deepEqual(cjkLatinSpaces("Sign in"), []);
  });

  it("leaves a space between two CJK words alone", () => {
    assert.deepEqual(cjkLatinSpaces("山田 太郎"), []);
  });

  it("does not take fullwidth letters or Hangul for Latin text", () => {
    assert.deepEqual(cjkLatinSpaces("全角 ＡＢＣ"), []);
    assert.deepEqual(cjkLatinSpaces("漢字 한국어"), []);
  });
});

describe("leavesSpacingToRenderer", () => {
  it("holds for Japanese and Chinese, not for Korean or English", () => {
    assert.deepEqual(
      ["ja", "zh-Hans", "zh-Hant", "ko", "en"].map(leavesSpacingToRenderer),
      [true, true, true, false, false]
    );
  });
});
