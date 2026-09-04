import { describe, expect, it } from "vitest";

import { formatSimpleMessage, simpleMessageSyntaxError } from "./mf2";

describe("simpleMessageSyntaxError", () => {
  it("accepts every shape the catalog is allowed to use", () => {
    for (const source of [
      "Home",
      "{$name} logo",
      "{$first}–{$last} / {$total} pages",
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
    expect(simpleMessageSyntaxError("Notifications, {count} unread")).toContain(
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
        ".input {$count :number}\n.match $count\none {{1 item}}\n* {{{$count} items}}"
      )
    ).toContain("selection");
  });
});

describe("formatSimpleMessage", () => {
  it("substitutes values and stringifies numbers", () => {
    expect(
      formatSimpleMessage("{$first} / {$total} pages", { first: 3, total: 12 })
    ).toBe("3 / 12 pages");
  });

  it("does not localize a number, so the host locale cannot leak in", () => {
    expect(formatSimpleMessage("{$count} items", { count: 12_345 })).toBe(
      "12345 items"
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
    expect(formatSimpleMessage("Home", { unused: 1 })).toBe("Home");
  });

  it("throws on a message that is not well-formed MF2", () => {
    expect(() => formatSimpleMessage("a } b")).toThrow();
  });
});
