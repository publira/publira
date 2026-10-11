// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isControlKeyTarget, resolveNeighborSide } from "./neighbor-navigation";

describe("resolveNeighborSide", () => {
  it("names the episode the key would reach if the pages ran on", () => {
    expect(resolveNeighborSide("ArrowLeft", "rtl")).toBe("next");
    expect(resolveNeighborSide("ArrowRight", "rtl")).toBe("previous");
    expect(resolveNeighborSide("ArrowLeft", "ltr")).toBe("previous");
    expect(resolveNeighborSide("ArrowRight", "ltr")).toBe("next");
  });

  it("answers for the horizontal arrow keys and nothing else", () => {
    expect(resolveNeighborSide("ArrowUp", "rtl")).toBeUndefined();
    expect(resolveNeighborSide("ArrowDown", "ltr")).toBeUndefined();
    expect(resolveNeighborSide("Enter", "rtl")).toBeUndefined();
    expect(resolveNeighborSide(" ", "ltr")).toBeUndefined();
  });
});

describe("isControlKeyTarget", () => {
  it("leaves a key press aimed at a control alone", () => {
    for (const tagName of ["button", "input", "select", "textarea"]) {
      expect(isControlKeyTarget(document.createElement(tagName))).toBe(true);
    }

    const link = document.createElement("a");
    link.href = "/series/SERIES_001";
    expect(isControlKeyTarget(link)).toBe(true);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isControlKeyTarget(editable)).toBe(true);
  });

  it("counts a control the press landed inside of", () => {
    const link = document.createElement("a");
    link.href = "/series/SERIES_001/episodes/EPISODE_002";
    const label = document.createElement("span");
    link.append(label);

    expect(isControlKeyTarget(label)).toBe(true);
  });

  it("does not count the pages themselves, or a press with no element behind it", () => {
    expect(isControlKeyTarget(document.createElement("canvas"))).toBe(false);
    expect(isControlKeyTarget(null)).toBe(false);
  });
});
