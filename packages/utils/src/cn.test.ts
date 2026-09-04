import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("joins the class names it is given", () => {
    expect(cn("rounded-md", "px-3")).toBe("rounded-md px-3");
  });

  it("drops the falsy branch of a conditional class name", () => {
    const isPadded = false;

    expect(cn("rounded-md", isPadded && "px-3", undefined, null)).toBe(
      "rounded-md"
    );
  });

  it("flattens array and object inputs the way clsx does", () => {
    expect(cn(["rounded-md", ["px-3"]], { "py-2": true, "py-4": false })).toBe(
      "rounded-md px-3 py-2"
    );
  });

  it("lets the later of two conflicting Tailwind utilities win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("resolves a conflict introduced by a conditional class name", () => {
    const isLarge = true;

    expect(cn("text-sm", isLarge && "text-lg")).toBe("text-lg");
  });

  it("keeps a conflicting utility that a variant scopes to another state", () => {
    expect(cn("p-2", "hover:p-4")).toBe("p-2 hover:p-4");
  });

  it("keeps utilities from different conflict groups side by side", () => {
    expect(cn("px-3", "py-2")).toBe("px-3 py-2");
  });
});
