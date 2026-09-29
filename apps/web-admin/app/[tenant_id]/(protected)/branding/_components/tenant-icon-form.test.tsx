// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantIconActionState } from "../branding-types";
import { TenantIconForm } from "./tenant-icon-form";

const { save } = vi.hoisted(() => ({
  save: {
    calls: [] as FormData[],
    current: Promise.withResolvers<TenantIconActionState>(),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantIconAction: (_state: TenantIconActionState, data: FormData) => {
    save.calls.push(data);
    return save.current.promise;
  },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

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

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantIconActionState>();
  save.calls = [];
});

describe("TenantIconForm", () => {
  it("previews the saved icon and offers to remove it", async () => {
    render(
      await TenantIconForm({
        icon: brandingImage("/images/tenants/icon-1"),
        tenantId: "TENANT001",
      })
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current icon")
        .src.includes("icon-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("shows neither the preview nor the remove action when nothing is set", async () => {
    render(await TenantIconForm({ icon: null, tenantId: "TENANT001" }));

    expect(screen.queryByAltText("Current icon")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("No icon is set.")).toBeDefined();
  });

  it("posts the upload with the upload intent", async () => {
    render(await TenantIconForm({ icon: null, tenantId: "TENANT001" }));

    fireEvent.click(screen.getByRole("button", { name: "Save the icon" }));

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("upload");
    expect(save.calls[0]?.get("tenant_id")).toBe("TENANT001");
  });

  it("posts the removal with the delete intent once it is confirmed, and reports it", async () => {
    render(
      await TenantIconForm({
        icon: brandingImage("/images/tenants/icon-1"),
        tenantId: "TENANT001",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("delete");
    expect(save.calls[0]?.get("tenant_id")).toBe("TENANT001");

    save.current.resolve({ message: "The icon was deleted.", ok: true });
    expect(await screen.findByText("The icon was deleted.")).toBeDefined();
  });

  it("shows why the save was refused", async () => {
    render(await TenantIconForm({ icon: null, tenantId: "TENANT001" }));

    fireEvent.click(screen.getByRole("button", { name: "Save the icon" }));
    save.current.resolve({ message: "Could not save the icon.", ok: false });

    expect(await screen.findByText("Could not save the icon.")).toBeDefined();
  });

  // The Action carries the file picked when the form was submitted, and React
  // resets the form once it settles, so a file picked while it is in flight
  // would be neither saved nor kept.
  it("closes the file field while the save is in flight", async () => {
    render(await TenantIconForm({ icon: null, tenantId: "TENANT001" }));

    const file = screen.getByLabelText<HTMLInputElement>("Icon image");

    expect(file.matches(":disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save the icon" }));

    await waitFor(() => {
      expect(file.matches(":disabled")).toBe(true);
    });
  });
});
