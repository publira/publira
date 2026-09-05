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

import { TenantIconForm } from "./tenant-icon-form";

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
      variantType: "icon",
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

describe("TenantIconForm", () => {
  it("previews the saved icon and offers to remove it", () => {
    render(
      <TenantIconForm
        action={noopAction}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current icon")
        .src.includes("icon-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("shows neither the preview nor the remove action when nothing is set", () => {
    render(<TenantIconForm action={noopAction} initialIcon={null} />);

    expect(screen.queryByAltText("Current icon")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("No icon is set.")).toBeDefined();
  });

  it("tells upload and removal apart by the intent of the same form", () => {
    render(
      <TenantIconForm
        action={noopAction}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save the icon",
    });

    expect(submit.name).toBe("intent");
    expect(submit.value).toBe("upload");

    const remove = screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete the icon",
    });

    expect(remove.name).toBe("intent");
    expect(remove.value).toBe("delete");
  });

  it("reflects the saved icon in the preview once the save succeeds", async () => {
    const action = vi.fn().mockResolvedValue({
      icon: brandingImage("/images/tenants/icon-2"),
      message: "The icon was saved.",
      ok: true,
    });

    render(
      <TenantIconForm
        action={action}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save the icon" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("Current icon")
          .src.includes("icon-2")
      ).toBe(true);
    });
  });

  it("keeps the last saved icon when the submission fails", async () => {
    // A failed Action state carries no icon, so deriving the preview from it
    // would blank out an image that is still stored. What the form holds on to
    // is the last image that saved.
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        icon: brandingImage("/images/tenants/icon-2"),
        message: "The icon was saved.",
        ok: true,
      })
      .mockResolvedValueOnce({
        message: "Could not save the icon.",
        ok: false,
      });

    render(
      <TenantIconForm
        action={action}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save the icon" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("Current icon")
          .src.includes("icon-2")
      ).toBe(true);
    });
    // The preview adopts the saved image as soon as the Action resolves, which
    // is before the submission itself settles. Retry for the submit button
    // instead of reading it synchronously, or the second click races the
    // pending render that still labels it "Saving...".
    fireEvent.click(
      await screen.findByRole("button", { name: "Save the icon" })
    );

    await waitFor(() => {
      expect(screen.getByText("Could not save the icon.")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Saving..." })).toBeNull();
    });
    expect(
      screen
        .getByAltText<HTMLImageElement>("Current icon")
        .src.includes("icon-2")
    ).toBe(true);
  });

  it("follows the new preview when it is remounted by key", () => {
    // The card holds the last confirmed icon for the life of the mount, so a
    // caller that has to seed it again remounts the form with a changed `key`.
    const { rerender } = render(
      <TenantIconForm action={noopAction} initialIcon={null} key="unset" />
    );

    rerender(
      <TenantIconForm
        action={noopAction}
        initialIcon={brandingImage("/images/tenants/icon-2")}
        key="icon-2"
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current icon")
        .src.includes("icon-2")
    ).toBe(true);
  });
});
