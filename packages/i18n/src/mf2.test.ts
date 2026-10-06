import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatMessageSource,
  messageVariables,
  simpleMessageParts,
  simpleMessageSyntaxError,
} from "./mf2";

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

describe("simpleMessageParts", () => {
  it("splits a message into its text and its placeholders, in order", () => {
    expect(simpleMessageParts("{$first} / {$total} pages")).toEqual([
      { variable: "first" },
      " / ",
      { variable: "total" },
      " pages",
    ]);
  });

  it("resolves escapes into the text, so a reader needs no parser", () => {
    expect(simpleMessageParts("\\{ {$q} \\} C:\\\\Users")).toEqual([
      "{ ",
      { variable: "q" },
      " } C:\\Users",
    ]);
  });

  it("returns plain text as one part and an empty message as none", () => {
    expect(simpleMessageParts("Home")).toEqual(["Home"]);
    expect(simpleMessageParts("")).toEqual([]);
  });

  it("throws the same reason simpleMessageSyntaxError reports", () => {
    expect(() => simpleMessageParts("{$count :number}")).toThrow(
      "functions (':number')"
    );
    expect(() => simpleMessageParts("a } b")).toThrow("parse-error");
  });
});

describe("messageVariables", () => {
  it("lists the placeholders of a simple message in name order", () => {
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
