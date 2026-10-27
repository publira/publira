// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { formatDateTime } from "@publira/utils";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantBrandMark } from "#lib/brand-marks";

import { BRAND_MARK_GUIDELINE_URLS } from "../_lib/brand-mark-guidelines";
import type { TenantBrandMarkActionState } from "../branding-types";
import { TenantBrandMarkCard } from "./tenant-brand-mark-card";

const { save } = vi.hoisted(() => ({
  save: {
    calls: [] as FormData[],
    current: Promise.withResolvers<TenantBrandMarkActionState>(),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantBrandMarkAction: (
    _state: TenantBrandMarkActionState,
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

const ACCEPTED_AT = "2026-10-20T03:04:05Z";

/**
 * A mark as the API answers it. The image is a placeholder path drawn for the
 * test, never one of the owners' real artwork.
 */
const uploadedMark = (termsAcceptedByName: string): TenantBrandMark => ({
  image: {
    updatedAt: ACCEPTED_AT,
    variants: [
      {
        contentType: "image/png",
        fileSizeBytes: 2048,
        height: 40,
        label: "original",
        url: "/images/tenants/test-media/x_share",
        variantType: "x_share",
        width: 120,
      },
    ],
  },
  kind: "x_share",
  termsAcceptedAt: ACCEPTED_AT,
  termsAcceptedByName,
  termsUrl: "https://example.com/brand/guidelines",
});

const renderCard = async (mark: TenantBrandMark | null) =>
  render(
    await TenantBrandMarkCard({
      kind: "x_share",
      locale: "en",
      mark,
      tenantId: "TENANT001",
      timeZone: "UTC",
    })
  );

const openUploadDialog = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  return await screen.findByRole("dialog");
};

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantBrandMarkActionState>();
  save.calls = [];
});

describe("TenantBrandMarkCard", () => {
  it("says nothing is uploaded and offers only the upload", async () => {
    await renderCard(null);

    expect(
      screen.getByRole("heading", { name: "X share button" })
    ).toBeDefined();
    expect(screen.getByText("No mark is uploaded.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByAltText("Current mark")).toBeNull();
  });

  it("shows the uploaded mark with who accepted its guidelines and when, and offers to replace or delete it", async () => {
    await renderCard(uploadedMark("Example Admin"));

    expect(
      screen
        .getByAltText<HTMLImageElement>("Current mark")
        .src.includes("test-media")
    ).toBe(true);
    expect(
      screen.getByText(
        `Guidelines accepted by Example Admin on ${formatDateTime(ACCEPTED_AT, { locale: "en", timeZone: "UTC" })}.`
      )
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Accepted guidelines" })
        .getAttribute("href")
    ).toBe("https://example.com/brand/guidelines");
    expect(screen.getByRole("button", { name: "Replace" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
    expect(screen.queryByText("No mark is uploaded.")).toBeNull();
  });

  it("says when the account that accepted the guidelines no longer exists", async () => {
    await renderCard(uploadedMark(""));

    expect(
      screen.getByText(
        `Guidelines accepted on ${formatDateTime(ACCEPTED_AT, { locale: "en", timeZone: "UTC" })} by an account that has since been deleted.`
      )
    ).toBeDefined();
  });

  it("links the dialog to the owner's guidelines and keeps the file and the upload closed until they are accepted", async () => {
    await renderCard(null);

    const dialog = await openUploadDialog("Upload");

    expect(
      within(dialog)
        .getByRole("link", { name: "X brand toolkit" })
        .getAttribute("href")
    ).toBe(BRAND_MARK_GUIDELINE_URLS.x_share);
    const file = within(dialog).getByLabelText<HTMLInputElement>("Mark image");
    const submit = within(dialog).getByRole("button", {
      name: "Upload the mark",
    });
    expect(file.matches(":disabled")).toBe(true);
    expect(submit.matches(":disabled")).toBe(true);

    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I have read these guidelines and accept them.",
      })
    );

    await waitFor(() => {
      expect(file.matches(":disabled")).toBe(false);
    });
    expect(submit.matches(":disabled")).toBe(false);
  });

  it("posts the upload with the guidelines it showed and their acceptance", async () => {
    await renderCard(uploadedMark("Example Admin"));

    const dialog = await openUploadDialog("Replace");
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I have read these guidelines and accept them.",
      })
    );
    const submit = within(dialog).getByRole("button", {
      name: "Upload the mark",
    });
    await waitFor(() => {
      expect(submit.matches(":disabled")).toBe(false);
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("upload");
    expect(save.calls[0]?.get("kind")).toBe("x_share");
    expect(save.calls[0]?.get("tenant_id")).toBe("TENANT001");
    expect(save.calls[0]?.get("terms_accepted")).toBe("true");
    expect(save.calls[0]?.get("terms_url")).toBe(
      BRAND_MARK_GUIDELINE_URLS.x_share
    );

    save.current.resolve({ message: "The mark was uploaded.", ok: true });
    expect(await screen.findByText("The mark was uploaded.")).toBeDefined();
  });

  // The dialog's acceptance belongs to one opening: closing it without
  // uploading leaves nothing ticked for the next one.
  it("asks for the acceptance again each time the dialog opens", async () => {
    await renderCard(null);

    let dialog = await openUploadDialog("Upload");
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I have read these guidelines and accept them.",
      })
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    dialog = await openUploadDialog("Upload");

    expect(
      within(dialog)
        .getByLabelText<HTMLInputElement>("Mark image")
        .matches(":disabled")
    ).toBe(true);
  });

  it("posts the removal with the delete intent once it is confirmed", async () => {
    await renderCard(uploadedMark("Example Admin"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("delete");
    expect(save.calls[0]?.get("kind")).toBe("x_share");
    expect(save.calls[0]?.get("terms_accepted")).toBeNull();
  });
});
