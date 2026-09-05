// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { TenantLogoForm } from "./tenant-logo-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const brandingImage = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00Z",
  variants: [
    {
      contentType: "image/png",
      fileSizeBytes: 1024,
      height: 64,
      label: "original",
      url,
      variantType: "logo",
      width: 64,
    },
  ],
});

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantLogoForm", () => {
  it("previews the saved logo and offers to remove it", () => {
    render(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current logo")
        .src.includes("logo-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("shows neither the preview nor the remove action when nothing is set", () => {
    render(<TenantLogoForm action={noopAction} initialLogo={null} />);

    expect(screen.queryByAltText("Current logo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("No logo is set.")).toBeDefined();
  });

  it("tells upload and removal apart by the intent of the same form", () => {
    render(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save the logo",
    });

    expect(submit.name).toBe("intent");
    expect(submit.value).toBe("upload");

    const remove = screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete the logo",
    });

    expect(remove.name).toBe("intent");
    expect(remove.value).toBe("delete");
  });

  it("reflects the saved logo in the preview once the save succeeds", async () => {
    const action = vi.fn().mockResolvedValue({
      logo: brandingImage("/images/tenants/logo-2"),
      message: "The logo was saved.",
      ok: true,
    });

    render(
      <TenantLogoForm
        action={action}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save the logo" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("Current logo")
          .src.includes("logo-2")
      ).toBe(true);
    });
  });

  it("keeps the last saved logo when the submission fails", async () => {
    // A failed Action state carries no logo, so deriving the preview from it
    // would blank out an image that is still stored. What the form holds on to
    // is the last image that saved.
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        logo: brandingImage("/images/tenants/logo-2"),
        message: "The logo was saved.",
        ok: true,
      })
      .mockResolvedValueOnce({
        message: "Could not save the logo.",
        ok: false,
      });

    render(
      <TenantLogoForm
        action={action}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save the logo" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("Current logo")
          .src.includes("logo-2")
      ).toBe(true);
    });
    // The preview adopts the saved image as soon as the Action resolves, which
    // is before the submission itself settles. Retry for the submit button
    // instead of reading it synchronously, or the second click races the
    // pending render that still labels it "Saving...".
    fireEvent.click(
      await screen.findByRole("button", { name: "Save the logo" })
    );

    await waitFor(() => {
      expect(screen.getByText("Could not save the logo.")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Saving..." })).toBeNull();
    });
    expect(
      screen
        .getByAltText<HTMLImageElement>("Current logo")
        .src.includes("logo-2")
    ).toBe(true);
  });

  it("follows the new preview when it is remounted by key", () => {
    // The card holds the last confirmed logo for the life of the mount, so a
    // caller that has to seed it again remounts the form with a changed `key`.
    const { rerender } = render(
      <TenantLogoForm action={noopAction} initialLogo={null} key="unset" />
    );

    rerender(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-2")}
        key="logo-2"
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current logo")
        .src.includes("logo-2")
    ).toBe(true);
  });
});
