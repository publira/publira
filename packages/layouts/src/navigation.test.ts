import { describe, expect, it } from "vitest";

import { isCurrentPath, toConsolePathname } from "./navigation";

describe("isCurrentPath", () => {
  it("root is active only on an exact match", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/series", "/")).toBe(false);
  });

  it("an ordinary path counts its child paths as active", () => {
    expect(isCurrentPath("/series/EP001", "/series")).toBe(true);
    expect(isCurrentPath("/catalog", "/series")).toBe(false);
  });

  it("a matching, more specific href leaves the parent href inactive", () => {
    const allHrefs = ["/series", "/series/EP001"];

    expect(isCurrentPath("/series/EP001/edit", "/series", allHrefs)).toBe(
      false
    );
    expect(isCurrentPath("/series/EP001/edit", "/series/EP001", allHrefs)).toBe(
      true
    );
  });
});

describe("toConsolePathname", () => {
  it.each([
    { pathname: "/tenants/new", expected: "/tenants/new" },
    { pathname: "/", expected: "/" },
    { pathname: "/en/tenants/new", expected: "/tenants/new" },
    { pathname: "/ja", expected: "/" },
    {
      pathname: "/1b4e28ba-2fa1-11d2-883f-0016d3cca427/series",
      expected: "/series",
    },
    {
      pathname: "/1b4e28ba-2fa1-11d2-883f-0016d3cca427/ja/series",
      expected: "/series",
    },
  ])("reads $pathname as $expected", ({ expected, pathname }) => {
    expect(toConsolePathname(pathname)).toBe(expected);
  });

  it("drops a locale only in front of the path", () => {
    expect(toConsolePathname("/tenants/en")).toBe("/tenants/en");
  });
});
