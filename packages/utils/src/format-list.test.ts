import { describe, expect, it } from "vitest";

import { formatList } from "./format-list";

describe("formatList", () => {
  it("formats one, two, and three names in Japanese", () => {
    expect(formatList(["Alice"], { locale: "ja" })).toBe("Alice");
    expect(formatList(["Alice", "Bob"], { locale: "ja" })).toBe("Alice、Bob");
    expect(formatList(["Alice", "Bob", "Carol"], { locale: "ja" })).toBe(
      "Alice、Bob、Carol"
    );
  });

  it("formats one, two, and three names in English", () => {
    expect(formatList(["Alice"], { locale: "en" })).toBe("Alice");
    expect(formatList(["Alice", "Bob"], { locale: "en" })).toBe(
      "Alice and Bob"
    );
    expect(formatList(["Alice", "Bob", "Carol"], { locale: "en" })).toBe(
      "Alice, Bob, and Carol"
    );
  });
});
