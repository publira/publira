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
  it("Display logo image", () => {
    render(
      <TenantBrandLogo
        alt="Acme Publishing logo"
        fallbackLabel="Acme Publishing"
        variant={variant}
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Acme Publishing logo")
        .src.includes("logo-1")
    ).toBe(true);
  });

  it("Fallback to site name text if loading fails", () => {
    render(
      <TenantBrandLogo
        alt="Acme Publishing logo"
        fallbackLabel="Acme Publishing"
        variant={variant}
      />
    );

    fireEvent.error(screen.getByAltText("Acme Publishing logo"));

    expect(screen.queryByAltText("Acme Publishing logo")).toBeNull();
    expect(screen.getByText("Acme Publishing")).toBeDefined();
  });
});
