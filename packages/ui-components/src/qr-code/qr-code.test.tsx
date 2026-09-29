// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QrCode } from "./qr-code";
import { toQrCodePath } from "./qr-code-path";

afterEach(cleanup);

const qr = toQrCodePath("https://example.com/app");

describe("QrCode", () => {
  it("names the code as one image when it is given a label", () => {
    render(<QrCode aria-label="Scan to open the app" {...qr} />);

    const image = screen.getByRole("img", { name: "Scan to open the app" });
    expect(image.getAttribute("viewBox")).toBe(`0 0 ${qr.size} ${qr.size}`);
    expect(image.getAttribute("aria-hidden")).toBeNull();
  });

  it("hides the code from assistive technology without a label", () => {
    const { container } = render(<QrCode {...qr} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  });

  it("draws dark modules on a white field whatever the theme", () => {
    const { container } = render(<QrCode {...qr} />);

    expect(container.querySelector("rect")?.getAttribute("fill")).toBe(
      "#ffffff"
    );
    expect(container.querySelector("path")?.getAttribute("d")).toBe(qr.path);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe(
      "#000000"
    );
  });
});
