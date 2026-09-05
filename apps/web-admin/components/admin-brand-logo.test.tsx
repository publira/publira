// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminBrandLogo } from "./admin-brand-logo";

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant-1"),
}));

vi.mock("./tenant-brand-logo", () => ({
  TenantBrandLogo: ({
    alt,
    variant,
  }: {
    alt: string;
    variant: { url: string };
  }) => (
    // oxlint-disable-next-line next/no-img-element -- next/image needs a loader
    <img alt={alt} src={variant.url} />
  ),
}));

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

describe("AdminBrandLogo", () => {
  it("builds the alternative text from the catalog", async () => {
    render(await AdminBrandLogo({ tenantName: "Acme Publishing", variant }));

    expect(screen.getByAltText("Acme Publishing logo")).toBeDefined();
  });
});
