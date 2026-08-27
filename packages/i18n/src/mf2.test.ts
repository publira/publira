import { describe, expect, it } from "vitest";

import { formatSimpleMessage, simpleMessageSyntaxError } from "./mf2";

describe("simpleMessageSyntaxError", () => {
  it("accepts every shape the catalog is allowed to use", () => {
    for (const source of [
      "ホーム",
      "{$name}のロゴ",
      "{$first}–{$last} / {$total}ページ",
      "\\{ literal braces \\}",
      "{ $count }",
      "100%",
      "a.b",
      "",
    ]) {
      expect(simpleMessageSyntaxError(source)).toBeUndefined();
    }
  });

  it("rejects the old bare {name} interpolation", () => {
    expect(simpleMessageSyntaxError("通知、未読{count}件")).toContain(
      "literal expressions"
    );
  });

  it("reports the syntax errors messageformat raises", () => {
    expect(simpleMessageSyntaxError("a } b")).toContain("parse-error");
    expect(simpleMessageSyntaxError("{$name")).toContain("Missing");
    expect(simpleMessageSyntaxError("a \\n b")).toContain("bad-escape");
    expect(simpleMessageSyntaxError("{$}")).toContain("empty-token");
  });

  it("rejects the features the catalog does not use", () => {
    expect(simpleMessageSyntaxError("{$count :number}")).toContain(
      "functions (':number')"
    );
    expect(simpleMessageSyntaxError("{#bold}text{/bold}")).toContain("markup");
    expect(
      simpleMessageSyntaxError(".input {$count :number}\n{{{$count}}}")
    ).toContain("declarations");
    expect(
      simpleMessageSyntaxError(
        ".input {$count :number}\n.match $count\none {{1件}}\n* {{{$count}件}}"
      )
    ).toContain("selection");
  });
});

describe("formatSimpleMessage", () => {
  it("substitutes values and stringifies numbers", () => {
    expect(
      formatSimpleMessage("{$first} / {$total}ページ", { first: 3, total: 12 })
    ).toBe("3 / 12ページ");
  });

  it("does not localize a number, so the host locale cannot leak in", () => {
    expect(formatSimpleMessage("{$count}件", { count: 12_345 })).toBe(
      "12345件"
    );
  });

  it("does not isolate a placeholder, so no bidi controls reach the copy", () => {
    expect(formatSimpleMessage("Hello {$name}!", { name: "محمد" })).toBe(
      "Hello محمد!"
    );
  });

  it("formats an unresolved variable as its fallback value", () => {
    expect(formatSimpleMessage("{$first} / {$total}", { first: 3 })).toBe(
      "3 / {$total}"
    );
    expect(formatSimpleMessage("{$name}")).toBe("{$name}");
  });

  it("resolves escape sequences", () => {
    expect(formatSimpleMessage("\\{100\\}")).toBe("{100}");
    expect(formatSimpleMessage("C:\\\\Users")).toBe("C:\\Users");
  });

  it("returns plain text unchanged", () => {
    expect(formatSimpleMessage("ホーム", { unused: 1 })).toBe("ホーム");
  });

  it("throws on a message that is not well-formed MF2", () => {
    expect(() => formatSimpleMessage("a } b")).toThrow();
  });
});
