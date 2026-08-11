import { describe, expect, it } from "vitest";

import {
  buildOperatorsPath,
  parseOperatorsSearchParams,
} from "./search-params";

describe("parseOperatorsSearchParams", () => {
  it("cursor token を変更せず返す", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseOperatorsSearchParams({ token })).toEqual({ token });
  });

  it("複数値や未指定の token を空値にする", () => {
    expect(parseOperatorsSearchParams({ token: ["first", "second"] })).toEqual({
      token: "",
    });
    expect(parseOperatorsSearchParams({})).toEqual({ token: "" });
  });
});

describe("buildOperatorsPath", () => {
  it("ページ token を URL に保持する", () => {
    expect(buildOperatorsPath({ token: "next/page" })).toBe(
      "/operators?token=next%2Fpage"
    );
  });

  it("token がなければ一覧のルートを返す", () => {
    expect(buildOperatorsPath({ token: "" })).toBe("/operators");
  });
});
