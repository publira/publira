import { afterEach, describe, expect, it, vi } from "vitest";

import {
  catalogMessageError,
  formatMessageSource,
  messageVariables,
} from "./mf2";

describe("catalogMessageError", () => {
  it("accepts text, escapes and variable references", () => {
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
      expect(catalogMessageError(source)).toBeUndefined();
    }
  });

  it("accepts declarations, selection and markup", () => {
    for (const source of [
      ".input {$count :integer}\n.match $count\n0 {{No episodes}}\none {{{$count} episode}}\n* {{{$count} episodes}}",
      ".local $shown = {$count :number maximumFractionDigits=1}\n{{{$shown} points}}",
      ".input {$name :string}\n{{Hello, {$name}}}",
      "{#strong}{$count :integer}{/strong} left",
    ]) {
      expect(catalogMessageError(source)).toBeUndefined();
    }
  });

  it("accepts every function each reader formats with by default", () => {
    for (const source of [
      "{$count :integer}",
      "{$ratio :number}",
      "{$count :offset subtract=1}",
      "{$name :string}",
    ]) {
      expect(catalogMessageError(source)).toBeUndefined();
    }
  });

  it("rejects a function some reader lacks by default", () => {
    expect(catalogMessageError("{$at :datetime}")).toContain(
      "':datetime' is not one of the catalog's functions"
    );
    expect(catalogMessageError("{$ratio :percent}")).toContain(":percent");
    expect(
      catalogMessageError(".input {$at :date}\n{{Published {$at}}}")
    ).toContain(":date");
  });

  it("rejects the old bare {name} interpolation", () => {
    expect(catalogMessageError("Notifications, {count} unread")).toContain(
      "'{count}' formats to the literal text 'count'"
    );
    expect(catalogMessageError("Searched for {|a b|}")).toContain(
      "literal text 'a b'"
    );
  });

  it("accepts a literal a function or a declaration takes", () => {
    expect(catalogMessageError("{|1234| :integer} views")).toBeUndefined();
    expect(
      catalogMessageError(".local $unit = {|pages|}\n{{{$count} {$unit}}}")
    ).toBeUndefined();
  });

  it("reports the syntax and data model errors messageformat raises", () => {
    expect(catalogMessageError("a } b")).toContain("parse-error");
    expect(catalogMessageError("{$name")).toContain("Missing");
    expect(catalogMessageError("a \\n b")).toContain("bad-escape");
    expect(catalogMessageError("{$}")).toContain("empty-token");
    expect(
      catalogMessageError(
        ".input {$count :integer}\n.match $count\none {{1 item}}"
      )
    ).toContain("missing-fallback");
  });
});

describe("formatMessageSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("substitutes values", () => {
    expect(
      formatMessageSource("{$first} / {$total} pages", "en-US", {
        first: 3,
        total: 12,
      })
    ).toBe("3 / 12 pages");
  });

  it("formats a number in the locale it is given, not the host's", () => {
    expect(formatMessageSource("{$count}", "en-US", { count: 12_345.5 })).toBe(
      "12,345.5"
    );
    expect(formatMessageSource("{$count}", "de-DE", { count: 12_345.5 })).toBe(
      "12.345,5"
    );
  });

  it("selects by the number a value holds", () => {
    const source =
      ".input {$count :integer}\n.match $count\n0 {{none}}\none {{one}}\n* {{many}}";

    expect(formatMessageSource(source, "en-US", { count: 0 })).toBe("none");
    expect(formatMessageSource(source, "en-US", { count: 1 })).toBe("one");
    expect(formatMessageSource(source, "en-US", { count: 7 })).toBe("many");
  });

  it("does not isolate a placeholder, so no bidi controls reach the copy", () => {
    expect(
      formatMessageSource("Hello {$name}!", "en-US", { name: "محمد" })
    ).toBe("Hello محمد!");
  });

  it("formats an unresolved variable as its fallback value", () => {
    expect(
      formatMessageSource("{$first} / {$total}", "en-US", { first: 3 })
    ).toBe("3 / {$total}");
    expect(formatMessageSource("{$name}", "en-US")).toBe("{$name}");
  });

  it("does not report an unresolved variable as a warning", () => {
    const emitWarning = vi.spyOn(process, "emitWarning");
    const warn = vi.spyOn(console, "warn");

    expect(formatMessageSource("Page {$first} of {$total}", "en-US")).toBe(
      "Page {$first} of {$total}"
    );
    expect(emitWarning).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves escape sequences", () => {
    expect(formatMessageSource("\\{100\\}", "en-US")).toBe("{100}");
    expect(formatMessageSource("C:\\\\Users", "en-US")).toBe("C:\\Users");
  });

  it("returns plain text unchanged", () => {
    expect(formatMessageSource("Home", "en-US", { unused: 1 })).toBe("Home");
  });

  it("throws on a message that is not well-formed MF2", () => {
    expect(() => formatMessageSource("a } b", "en-US")).toThrow();
  });
});

describe("messageVariables", () => {
  it("lists the placeholders of a message in name order", () => {
    expect(messageVariables("{$total} / {$first} pages")).toEqual([
      { name: "first", numeric: false },
      { name: "total", numeric: false },
    ]);
    expect(messageVariables("Home")).toEqual([]);
  });

  it("marks a variable a numeric function takes, wherever it is used", () => {
    expect(
      messageVariables(
        ".input {$count :integer}\n.match $count\none {{{$count} episode by {$name}}}\n* {{{$count} episodes}}"
      )
    ).toEqual([
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    expect(messageVariables("{$ratio :percent} of {$label :string}")).toEqual([
      { name: "label", numeric: false },
      { name: "ratio", numeric: true },
    ]);
  });

  it("leaves out a local and carries a number back to what it reads", () => {
    expect(
      messageVariables(
        ".local $n = {$count}\n.local $m = {$n}\n{{{$m :number}}}"
      )
    ).toEqual([{ name: "count", numeric: true }]);
  });

  it("includes a variable that only an option reads", () => {
    expect(
      messageVariables("{$value :number maximumFractionDigits=$digits}")
    ).toEqual([
      { name: "digits", numeric: false },
      { name: "value", numeric: true },
    ]);
  });

  it("throws on a syntax or data model error", () => {
    expect(() => messageVariables("{$count")).toThrow();
    expect(() => messageVariables(".match $count\n* {{{$count}}}")).toThrow();
  });
});
