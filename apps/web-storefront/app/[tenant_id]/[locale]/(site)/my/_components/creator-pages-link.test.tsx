// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorPagesLink } from "./creator-pages-link";

const { mockGetTenantCreatorPagesEnabled, mockListMyCreators } = vi.hoisted(
  () => ({
    mockGetTenantCreatorPagesEnabled: vi.fn(),
    mockListMyCreators: vi.fn(),
  })
);

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("11111111-1111-4111-8111-111111111111"),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/tenant", () => ({
  getTenantCreatorPagesEnabled: mockGetTenantCreatorPagesEnabled,
}));

vi.mock("#lib/creator-pages", () => ({
  listMyCreators: mockListMyCreators,
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => <span>{message}</span>,
}));

vi.mock("#components/locale-link", () => ({
  LocaleLink: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const CREATOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTenantCreatorPagesEnabled.mockResolvedValue(true);
});

const renderLink = async () => {
  render(<div>{await CreatorPagesLink()}</div>);
};

const link = () =>
  screen.queryByRole("link", { name: "storefront.my.to_creator_pages" });

describe("CreatorPagesLink", () => {
  it("leads a reader linked to an Author to the first of them", async () => {
    mockListMyCreators.mockResolvedValue({
      ok: true,
      value: {
        creators: [
          {
            iconImageUrl: "",
            id: CREATOR_ID,
            name: "Night Author",
            publicId: "AUTHOR000001",
          },
        ],
        salesVisible: true,
      },
    });

    await renderLink();

    expect(link()?.getAttribute("href")).toBe(`/my/creators/${CREATOR_ID}`);
  });

  it("asks nothing of the API on a tenant that shows no Author pages", async () => {
    mockGetTenantCreatorPagesEnabled.mockResolvedValue(false);

    await renderLink();

    expect(mockListMyCreators).not.toHaveBeenCalled();
    expect(link()).toBeNull();
  });

  it("leaves the link out for a reader linked to no Author", async () => {
    mockListMyCreators.mockResolvedValue({
      ok: true,
      value: { creators: [], salesVisible: true },
    });

    await renderLink();

    expect(link()).toBeNull();
  });

  it("leaves the link out, rather than taking My Page down, when the Authors cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListMyCreators.mockRejectedValue(new Error("socket hang up"));

    await renderLink();

    expect(link()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
