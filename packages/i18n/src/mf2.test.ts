import { describe, expect, it } from "vitest";

import {
  formatSimpleMessage,
  parseSimpleMessage,
  simpleMessageSyntaxError,
} from "./mf2";

describe("parseSimpleMessage", () => {
  it("splits text and variable references", () => {
    expect(parseSimpleMessage("公開中シリーズ {$count} 件")).toEqual([
      "公開中シリーズ ",
      { variable: "count" },
      " 件",
    ]);
  });

  it("accepts a message that is only a placeholder", () => {
    expect(parseSimpleMessage("{$body}")).toEqual([{ variable: "body" }]);
  });

  it("accepts an empty message", () => {
    expect(parseSimpleMessage("")).toEqual([]);
  });

  it("keeps leading and trailing whitespace as text", () => {
    expect(parseSimpleMessage("  x  ")).toEqual(["  x  "]);
  });

  it("allows optional whitespace inside an expression", () => {
    expect(parseSimpleMessage("{ $count }")).toEqual([{ variable: "count" }]);
  });

  it("resolves escape sequences to the characters they escape", () => {
    expect(parseSimpleMessage("\\{ \\} \\\\ \\|")).toEqual(["{ } \\ |"]);
  });
});

describe("simpleMessageSyntaxError", () => {
  it("accepts every shape the catalog is allowed to use", () => {
    for (const source of [
      "ホーム",
      "{$name}のロゴ",
      "{$first}–{$last} / {$total}ページ",
      "\\{ literal braces \\}",
      "100%",
      "a.b",
    ]) {
      expect(simpleMessageSyntaxError(source)).toBeUndefined();
    }
  });

  it("rejects the old bare {name} interpolation", () => {
    expect(simpleMessageSyntaxError("通知、未読{count}件")).toContain(
      "only variable expressions"
    );
  });

  it("rejects an unescaped brace", () => {
    expect(simpleMessageSyntaxError("a } b")).toContain(
      "a literal '}' is written"
    );
    expect(simpleMessageSyntaxError("{$name")).toContain(
      "expected '}' to close the variable expression"
    );
  });

  it("rejects an unknown escape", () => {
    expect(simpleMessageSyntaxError("a \\n b")).toContain(
      "a backslash must be followed by"
    );
    expect(simpleMessageSyntaxError("trailing \\")).toContain(
      "a backslash must be followed by"
    );
  });

  it("rejects a name that is not in the ASCII subset", () => {
    expect(simpleMessageSyntaxError("{$}")).toContain(
      "expected a variable name after '$'"
    );
    expect(simpleMessageSyntaxError("{$1st}")).toContain(
      "expected a variable name after '$'"
    );
  });

  it("rejects the complex-message forms", () => {
    expect(
      simpleMessageSyntaxError(".input {$count :number}\n{{{$count}}}")
    ).toContain("is a complex message");
    expect(simpleMessageSyntaxError("{{quoted}}")).toContain("quoted patterns");
    expect(simpleMessageSyntaxError("  .local $x = {|1|}")).toContain(
      "is a complex message"
    );
  });

  it("rejects functions, literals, and markup", () => {
    expect(simpleMessageSyntaxError("{$count :number}")).toContain(
      "expected '}' to close the variable expression"
    );
    expect(simpleMessageSyntaxError("{:datetime}")).toContain(
      "only variable expressions"
    );
    expect(simpleMessageSyntaxError("{#bold}text{/bold}")).toContain(
      "only variable expressions"
    );
  });

  it("rejects U+0000", () => {
    expect(simpleMessageSyntaxError("a\u0000b")).toContain(
      "U+0000 NULL is not allowed"
    );
  });
});

describe("formatSimpleMessage", () => {
  it("substitutes values and stringifies numbers", () => {
    expect(
      formatSimpleMessage("{$first} / {$total}ページ", { first: 3, total: 12 })
    ).toBe("3 / 12ページ");
  });

  it("formats an unresolved variable as its fallback value", () => {
    expect(formatSimpleMessage("{$first} / {$total}", { first: 3 })).toBe(
      "3 / {$total}"
    );
    expect(formatSimpleMessage("{$name}")).toBe("{$name}");
  });

  it("ignores inherited properties of the values object", () => {
    expect(formatSimpleMessage("{$toString}", {})).toBe("{$toString}");
  });

  it("unescapes even when there is nothing to substitute", () => {
    expect(formatSimpleMessage("\\{100\\}")).toBe("{100}");
  });

  it("returns plain text unchanged", () => {
    expect(formatSimpleMessage("ホーム", { unused: 1 })).toBe("ホーム");
  });
});
