import {
  colorContrastRatio,
  THEME_TEXT_CONTRAST_PAIRS,
  THEME_TEXT_CONTRAST_MIN_RATIO,
} from "@publira/utils/theme-contrast";
import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";

type Hsl = readonly [hue: number, saturation: number, lightness: number];

const toHsl = (color: string): Hsl => {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const chroma = max - min;

  if (chroma === 0) {
    return [0, 0, lightness];
  }

  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (max === red) {
    hue = ((green - blue) / chroma) % 6;
  } else if (max === green) {
    hue = (blue - red) / chroma + 2;
  } else {
    hue = (red - green) / chroma + 4;
  }

  return [(hue * 60 + 360) % 360, saturation, lightness];
};

const toHex = ([hue, saturation, lightness]: Hsl): string => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(hue / 60);

  const [red, green, blue] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector] ?? [0, 0, 0];

  return `#${[red, green, blue]
    .map((component) =>
      Math.round((component + m) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
};

const invertLightness = (color: string): string => {
  const [hue, saturation, lightness] = toHsl(color);

  return toHex([hue, saturation, 1 - lightness]);
};

const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * A dark palette to start from, made out of a light one.
 *
 * Every color keeps its hue and saturation and takes the opposite lightness:
 * the paper becomes as dark as it was light, the ink as light as it was dark,
 * and a pale tint of the brand becomes a deep shade of the same hue. A pair the
 * inversion leaves under the contrast the save requires takes white or black
 * text, whichever reads better on it — one of the two always clears 4.5:1 — so
 * the result can be saved as it stands.
 */
export const deriveDarkPalette = (
  light: TenantThemeColors
): TenantThemeColors => {
  const dark = { ...DEFAULT_TENANT_THEME_COLORS };

  for (const key of Object.keys(
    DEFAULT_TENANT_THEME_COLORS
  ) as (keyof TenantThemeColors)[]) {
    dark[key] = invertLightness(light[key]);
  }

  for (const { background, foreground } of THEME_TEXT_CONTRAST_PAIRS) {
    if (
      colorContrastRatio(dark[background], dark[foreground]) <
      THEME_TEXT_CONTRAST_MIN_RATIO
    ) {
      dark[foreground] =
        colorContrastRatio(dark[background], WHITE) >=
        colorContrastRatio(dark[background], BLACK)
          ? WHITE
          : BLACK;
    }
  }

  return dark;
};
