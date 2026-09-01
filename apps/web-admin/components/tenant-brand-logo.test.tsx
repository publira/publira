// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TenantBrandLogo } from "./tenant-brand-logo";

const variant = {
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 64,
  label: "original",
  url: "/images/tenants/logo-1",
  variantType: "logo",
  width: 128,
};

afterEach(() => {
  cleanup();
});

describe("TenantBrandLogo", () => {
  it("shows the logo image", () => {
    render(<TenantBrandLogo alt="青枝出版のロゴ" variant={variant} />);

    expect(
      screen
        .getByAltText<HTMLImageElement>("青枝出版のロゴ")
        .src.includes("logo-1")
    ).toBe(true);
  });

  it("renders nothing when the image fails to load", () => {
    render(<TenantBrandLogo alt="青枝出版のロゴ" variant={variant} />);

    fireEvent.error(screen.getByAltText("青枝出版のロゴ"));

    expect(screen.queryByAltText("青枝出版のロゴ")).toBeNull();
  });
});
