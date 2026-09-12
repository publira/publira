// @vitest-environment jsdom

import { DEFAULT_TENANT_THEME } from "@publira/utils/theme-css-variables";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemePreview } from "./theme-preview";

/**
 * Every string in the preview suspends on the catalog `<ClientMessage>` loads,
 * so the render is awaited: `act` lets React flush the commit that follows the
 * `import()` instead of leaving each boundary on its skeleton.
 */
const renderPreview = async (
  theme: typeof DEFAULT_TENANT_THEME = DEFAULT_TENANT_THEME
): Promise<HTMLElement> => {
  let container: HTMLElement | undefined;

  await act(() => {
    ({ container } = render(<ThemePreview theme={theme} />));
  });

  const frame = container?.querySelector<HTMLElement>(".publira-theme-scope");
  if (!frame) {
    throw new Error("the preview frame is missing");
  }

  return frame;
};

afterEach(() => {
  cleanup();
});

describe("ThemePreview", () => {
  it("paints the frame from the theme it was given, not the document's", async () => {
    const frame = await renderPreview({
      ...DEFAULT_TENANT_THEME,
      backgroundColor: "#101010",
      cardColor: "#202020",
      primaryColor: "#ff0000",
      sansFontFamily: '"Noto Sans SC", sans-serif',
      serifFontFamily: '"Noto Serif KR", serif',
    });

    expect(frame.style.getPropertyValue("--publira-color-primary")).toBe(
      "#ff0000"
    );
    expect(frame.style.getPropertyValue("--publira-color-background")).toBe(
      "#101010"
    );
    expect(frame.style.getPropertyValue("--publira-color-card")).toBe(
      "#202020"
    );
    expect(frame.style.getPropertyValue("--publira-font-serif")).toBe(
      '"Noto Serif KR", serif'
    );
    expect(frame.style.getPropertyValue("--publira-font-sans")).toBe(
      '"Noto Sans SC", sans-serif'
    );
  });

  it("shows the sample site the colors are judged on", async () => {
    await renderPreview();

    const siteName = await screen.findAllByText("Aozora Books");
    const featured = await screen.findAllByText(
      "The Lighthouse at the End of Summer"
    );
    const second = await screen.findByText("Notes from the Night Bakery");
    const typeSamples = await screen.findAllByText(
      "日本語 · Latin · 한국어 · 中文"
    );

    expect(siteName.length).toBeGreaterThan(0);
    expect(featured.length).toBeGreaterThan(0);
    expect(second).toBeTruthy();
    expect(typeSamples).toHaveLength(2);
  });

  it("keeps the facsimile out of the accessibility tree", async () => {
    const frame = await renderPreview();

    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.querySelectorAll("a, button, input")).toHaveLength(0);
  });

  // The brief allows no gradient anywhere, least of all where artwork is
  // missing: that surface is a flat `muted` rectangle carrying the title.
  it("paints no gradient", async () => {
    const frame = await renderPreview();

    for (const element of frame.querySelectorAll<HTMLElement>("*")) {
      for (const name of element.classList) {
        expect(name).not.toContain("gradient");
        expect(name.startsWith("bg-linear-")).toBe(false);
        expect(name.startsWith("bg-radial")).toBe(false);
        expect(name.startsWith("bg-conic")).toBe(false);
      }
    }
  });
});
