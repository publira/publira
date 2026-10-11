// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { EyeCatchVariant } from "#components/eye-catch-picture";

import { EyeCatchThumbnail } from "./eye-catch-thumbnail";

afterEach(() => {
  cleanup();
});

const variant = (
  variantType: string,
  width: number,
  height: number
): EyeCatchVariant => ({
  contentType: "image/webp",
  height,
  url: `/images/series/SERIES01/${variantType}/${width}`,
  variantType,
  width,
});

describe("EyeCatchThumbnail", () => {
  it("Draws the square variant rather than cropping the wide one", () => {
    render(
      <EyeCatchThumbnail
        alt="Published Series"
        variants={[
          variant("landscape", 1600, 900),
          variant("square", 600, 600),
          variant("square", 1200, 1200),
          variant("portrait", 1200, 1600),
        ]}
      />
    );

    const image = screen.getByRole("img", { name: "Published Series" });

    expect(image.getAttribute("src")).toBe(
      "/images/series/SERIES01/square/1200"
    );
    expect(image.getAttribute("srcset")).toBe(
      "/images/series/SERIES01/square/600 600w, /images/series/SERIES01/square/1200 1200w"
    );
  });

  it("Keeps a flat frame for a work with no artwork", () => {
    const { container } = render(
      <EyeCatchThumbnail alt="Published Series" variants={undefined} />
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  });
});
