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

import type { TenantSignInImageActionState } from "../branding-types";
import { TenantSignInImageForm } from "./tenant-sign-in-image-form";

const { save } = vi.hoisted(() => ({
  save: {
    calls: [] as FormData[],
    current: Promise.withResolvers<TenantSignInImageActionState>(),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantSignInImageAction: (
    _state: TenantSignInImageActionState,
    data: FormData
  ) => {
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
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const brandingImage = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00Z",
  variants: [
    {
      contentType: "image/jpeg",
      fileSizeBytes: 1024,
      height: 1280,
      label: "original",
      url,
      variantType: "sign_in",
      width: 1920,
    },
  ],
});

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantSignInImageActionState>();
  save.calls = [];
});

describe("TenantSignInImageForm", () => {
  it("previews the saved image and offers to remove it", async () => {
    render(
      await TenantSignInImageForm({
        signInImage: brandingImage("/images/tenants/sign-in-1"),
        tenantId: "TENANT001",
      })
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current sign-in image")
        .src.includes("sign-in-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("lays the preview out at the size it is drawn, not at the stored image's", async () => {
    render(
      await TenantSignInImageForm({
        signInImage: brandingImage("/images/tenants/sign-in-1"),
        tenantId: "TENANT001",
      })
    );

    const preview = screen.getByAltText<HTMLImageElement>(
      "Current sign-in image"
    );
    // 1920x1280 drawn 160px tall keeps its 3:2.
    expect(preview.getAttribute("width")).toBe("240");
    expect(preview.getAttribute("height")).toBe("160");
  });

  it("shows neither the preview nor the remove action when nothing is set", async () => {
    render(
      await TenantSignInImageForm({ signInImage: null, tenantId: "TENANT001" })
    );

    expect(screen.queryByAltText("Current sign-in image")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("No sign-in image is set.")).toBeDefined();
  });

  it("posts the upload with the upload intent", async () => {
    render(
      await TenantSignInImageForm({ signInImage: null, tenantId: "TENANT001" })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save the sign-in image" })
    );

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("upload");
    expect(save.calls[0]?.get("tenant_id")).toBe("TENANT001");
  });

  it("posts the removal with the delete intent once it is confirmed, and reports it", async () => {
    render(
      await TenantSignInImageForm({
        signInImage: brandingImage("/images/tenants/sign-in-1"),
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

    save.current.resolve({
      message: "The sign-in image was deleted.",
      ok: true,
    });
    expect(
      await screen.findByText("The sign-in image was deleted.")
    ).toBeDefined();
  });

  it("shows why the save was refused", async () => {
    render(
      await TenantSignInImageForm({ signInImage: null, tenantId: "TENANT001" })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save the sign-in image" })
    );
    save.current.resolve({
      message: "Could not save the sign-in image.",
      ok: false,
    });

    expect(
      await screen.findByText("Could not save the sign-in image.")
    ).toBeDefined();
  });

  // The Action carries the file picked when the form was submitted, and React
  // resets the form once it settles, so a file picked while it is in flight
  // would be neither saved nor kept.
  it("closes the file field while the save is in flight", async () => {
    render(
      await TenantSignInImageForm({ signInImage: null, tenantId: "TENANT001" })
    );

    const file = screen.getByLabelText<HTMLInputElement>("Sign-in image file");

    expect(file.matches(":disabled")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Save the sign-in image" })
    );

    await waitFor(() => {
      expect(file.matches(":disabled")).toBe(true);
    });
  });
});
