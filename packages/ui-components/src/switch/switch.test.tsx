// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Switch } from "./switch";

// jsdom applies no Tailwind CSS, so each variant is checked as the selector it
// compiles to against the element Base UI renders.
const variantSelectors: Record<string, string> = {
  "data-disabled": "[data-disabled]",
  disabled: ":disabled",
};

const variantOf = (element: Element, utility: string) =>
  [...element.classList]
    .find((token) => token.endsWith(`:${utility}`))
    ?.slice(0, -utility.length - 1);

afterEach(cleanup);

describe("Switch", () => {
  it.each(["opacity-50", "cursor-not-allowed"])(
    "applies %s to a disabled switch",
    (utility) => {
      render(<Switch disabled />);

      const root = screen.getByRole("switch");
      const selector = variantSelectors[variantOf(root, utility) ?? ""];

      expect(selector).toBeDefined();
      expect(root.matches(selector ?? "")).toBe(true);
    }
  );
});
