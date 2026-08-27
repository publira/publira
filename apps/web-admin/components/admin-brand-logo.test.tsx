// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminBrandLogo } from "./admin-brand-logo";

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("ja"),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("ja")),
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
  it("代替テキストをカタログから組み立てる", async () => {
    render(await AdminBrandLogo({ tenantName: "青枝出版", variant }));

    expect(screen.getByAltText("青枝出版のロゴ")).toBeDefined();
  });
});
