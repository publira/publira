import { readFile } from "node:fs/promises";

import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import { describe, expect, it } from "vitest";

import { emailColors } from "./colors";

/**
 * The default palette lives in three hand-written copies: the `var()`
 * fallbacks in `@publira/brand/theme.css`, `DEFAULT_TENANT_THEME_COLORS` in
 * `@publira/utils`, and `emailColors` here, which exists because an email
 * client resolves no custom property. This package is the only one that can
 * see all three, so the check that they still agree lives here.
 */
const readThemeCssFallbacks = async (): Promise<Record<string, string>> => {
  const source = await readFile(
    new URL(import.meta.resolve("@publira/brand/theme.css")),
    "utf-8"
  );
  const declaration =
    /var\(\s*(?<property>--publira-color-[a-z-]+),\s*(?<value>#[0-9a-f]{6})\s*\)/gu;
  const fallbacks: Record<string, string> = {};
  for (const [, property, value] of source.matchAll(declaration)) {
    fallbacks[property] = value;
  }
  return fallbacks;
};

/** Which theme token each email color is a copy of. */
const emailColorTokens: Record<keyof typeof emailColors, string> = {
  background: "--publira-color-background",
  border: "--publira-color-border",
  brand: "--publira-color-primary",
  buttonForeground: "--publira-color-primary-foreground",
  card: "--publira-color-card",
  foreground: "--publira-color-foreground",
  muted: "--publira-color-muted-foreground",
};

describe("default palette copies", () => {
  it("gives every theme.css fallback the same value as the tenant theme default", async () => {
    await expect(readThemeCssFallbacks()).resolves.toEqual(
      toPubliraThemeCssVariables()
    );
  });

  it("gives every email color the same value as the theme token it copies", async () => {
    const fallbacks = await readThemeCssFallbacks();
    const expected = Object.fromEntries(
      Object.entries(emailColorTokens).map(([name, token]) => [
        name,
        fallbacks[token],
      ])
    );

    expect({ ...emailColors }).toEqual(expected);
  });
});
