// @vitest-environment jsdom

import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { cleanup, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { ThemePreview } from "./theme-preview";

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

const frameOf = (container: HTMLElement): HTMLElement => {
  const frame = container.querySelector<HTMLElement>(".publira-theme-scope");
  if (!frame) {
    throw new Error("the preview frame is missing");
  }
  return frame;
};

afterEach(() => {
  cleanup();
});

describe("ThemePreview", () => {
  it("paints the frame from the colors it was given, not the document's", () => {
    const { container } = render(
      <ThemePreview
        theme={{
          ...DEFAULT_TENANT_THEME_COLORS,
          backgroundColor: "#101010",
          cardColor: "#202020",
          primaryColor: "#ff0000",
        }}
      />
    );

    const frame = frameOf(container);

    expect(frame.style.getPropertyValue("--publira-color-primary")).toBe(
      "#ff0000"
    );
    expect(frame.style.getPropertyValue("--publira-color-background")).toBe(
      "#101010"
    );
    expect(frame.style.getPropertyValue("--publira-color-card")).toBe(
      "#202020"
    );
  });

  it("shows the sample site the colors are judged on", () => {
    render(<ThemePreview theme={DEFAULT_TENANT_THEME_COLORS} />);

    expect(screen.getAllByText("Aozora Books").length).toBeGreaterThan(0);
    expect(
      screen.getByText("The Lighthouse at the End of Summer")
    ).toBeTruthy();
    expect(screen.getByText("Notes from the Night Bakery")).toBeTruthy();
  });

  it("keeps the facsimile out of the accessibility tree", () => {
    const { container } = render(
      <ThemePreview theme={DEFAULT_TENANT_THEME_COLORS} />
    );

    expect(frameOf(container).getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("a, button, input")).toHaveLength(0);
  });
});
