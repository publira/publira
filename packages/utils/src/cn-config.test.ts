import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

import { defaultConfig, mergeConfigs, validators } from "cn/config";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

import { cnConfigExtension } from "./cn-config";

const require = createRequire(import.meta.url);

/**
 * The custom properties a stylesheet's `@theme` blocks declare, without
 * repeats. A namespace reset (`--color-*: initial`) is not a token.
 */
const readThemeTokens = (specifier: string): string[] => {
  const tokens = new Set<string>();

  parse(readFileSync(require.resolve(specifier), "utf-8")).walkAtRules(
    "theme",
    (theme) => {
      theme.each((node) => {
        if (
          node.type === "decl" &&
          node.prop.startsWith("--") &&
          !node.prop.endsWith("*")
        ) {
          tokens.add(node.prop);
        }
      });
    }
  );

  return [...tokens];
};

const shippedConfig = mergeConfigs(defaultConfig(), cnConfigExtension);

/** The validators that match a name the config does not list. */
const permissiveValidators = [validators.isAny, validators.isAnyNonArbitrary];

/** Every theme scale a class group reads through `fromTheme`. */
const readScales = new Set(
  Array.from(
    JSON.stringify(shippedConfig.classGroups).matchAll(
      /"\$t":"(?<scale>[^"]+)"/gu
    ),
    (match) => match.groups?.scale
  )
);

/**
 * Tailwind's own theme. The default config is written for it, so a token
 * that redefines one of its names — `--breakpoint-md` — is already matched.
 */
const tailwindTokens = new Set(readThemeTokens("tailwindcss/theme.css"));

const fix =
  "packages/utils/src/cn-config.ts, the extension the shipped cn is built from with createCn";

/**
 * Why the shipped `cn` cannot resolve a conflict between the utilities `token`
 * generates and the rest of their class group, or `undefined` when it can.
 */
const unresolvedReason = (token: string): string | undefined => {
  if (tailwindTokens.has(token)) {
    return;
  }

  // `--text-hero--line-height` is a property of the `text-hero` utility.
  const [key] = token.slice("--".length).split("--");

  const [scale] = Object.keys(shippedConfig.theme)
    .filter((candidate) => key.startsWith(`${candidate}-`))
    .toSorted((a, b) => b.length - a.length);

  if (scale === undefined) {
    return `${token} is in a Tailwind namespace the cn merge config has no theme scale for. In ${fix}, add a scale named after that namespace under extend.theme listing the token's name, and read it with fromTheme() from the class group of the utility Tailwind generates from it under extend.classGroups.`;
  }

  if (!readScales.has(scale)) {
    return `${token} is in the "${scale}" scale of the cn merge config, which no class group reads. In ${fix}, read it with fromTheme() from the class group of the utility Tailwind generates from it under extend.classGroups.`;
  }

  const name = key.slice(scale.length + 1);
  const values = shippedConfig.theme[scale];

  const matchesAnyName = values.some((value) =>
    permissiveValidators.some((validator) =>
      isDeepStrictEqual(value, validator)
    )
  );

  if (matchesAnyName || values.includes(name)) {
    return;
  }

  return `${token} is "${name}" in the "${scale}" scale, which the cn merge config enumerates instead of matching any name, so cn does not recognize its utilities and the last one written no longer wins. In ${fix}, list "${name}" under extend.theme["${scale}"].`;
};

const brandTokens = readThemeTokens("@publira/brand/theme.css");

describe("the cn merge config", () => {
  it("reads the tokens @publira/brand/theme.css defines", () => {
    expect(brandTokens).toEqual(
      expect.arrayContaining([
        "--font-serif",
        "--radius-control",
        "--color-primary",
      ])
    );
  });

  it.each(brandTokens)("resolves the utilities of %s", (token) => {
    const reason = unresolvedReason(token);

    // The reason is the message, so a failure says how to fix it in full.
    expect(reason, reason).toBeUndefined();
  });

  it.each([
    ["--text-hero", '"hero" in the "text" scale'],
    ["--radius-pill", '"pill" in the "radius" scale'],
    ["--shadow-lifted", '"lifted" in the "shadow" scale'],
    ["--spacing-gutter", '"gutter" in the "spacing" scale'],
    ["--z-index-overlay", "no theme scale for"],
  ])("names %s, which it does not resolve", (token, reason) => {
    expect(unresolvedReason(token)).toContain(`${token} is`);
    expect(unresolvedReason(token)).toContain(reason);
  });

  it("checks a line-height property against the utility it belongs to", () => {
    expect(unresolvedReason("--text-hero--line-height")).toContain(
      '"hero" in the "text" scale'
    );
  });
});
