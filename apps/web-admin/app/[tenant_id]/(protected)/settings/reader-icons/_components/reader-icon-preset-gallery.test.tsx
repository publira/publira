// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderIconPresetItem } from "#lib/reader-icon-settings";

import { ReaderIconPresetGallery } from "./reader-icon-preset-gallery";

const { remove } = vi.hoisted(() => ({
  remove: {
    current: Promise.withResolvers<FormActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  deleteReaderIconPresetAction: (_state: unknown, formData: FormData) => {
    remove.formData = formData;
    return remove.current.promise;
  },
  uploadReaderIconPresetAction: () => Promise.resolve(null),
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

const preset = (id: string): ReaderIconPresetItem => ({
  id,
  variants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 2048,
      height: 256,
      label: "original",
      url: `/images/reader-icon-presets/${id}`,
      width: 256,
    },
  ],
});

const uploadButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Add the icon" });

afterEach(() => {
  cleanup();
  remove.current.resolve(null);
  remove.current = Promise.withResolvers<FormActionState>();
  remove.formData = undefined;
});

describe("ReaderIconPresetGallery", () => {
  it("shows each preset with the size of its stored rendition", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: true,
        presets: [preset("p1"), preset("p2")],
        tenantId: "T1",
      })
    );

    expect(
      decodeURIComponent(
        screen
          .getByRole("img", { name: "Preset icon 1" })
          .getAttribute("src") ?? ""
      )
    ).toContain("/images/reader-icon-presets/p1");
    expect(screen.getByRole("img", { name: "Preset icon 2" })).toBeDefined();
    expect(await screen.findAllByText("256 × 256 px")).toHaveLength(2);
    expect(uploadButton().disabled).toBe(false);
  });

  it("warns that readers who chose a preset lose it before deleting it", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: true,
        presets: [preset("0199e3a4-5b6c-7d8e-9f01-23456789abcd")],
        tenantId: "T1",
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete preset icon 1?");
    expect(dialog.textContent).toContain(
      "Readers who chose this icon are left without one"
    );
    expect(remove.formData).toBeUndefined();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement
    );

    await waitFor(() => {
      expect(remove.formData?.get("preset_id")).toBe(
        "0199e3a4-5b6c-7d8e-9f01-23456789abcd"
      );
    });
    expect(remove.formData?.get("tenant_id")).toBe("T1");
  });

  it("says the set is empty and readers have nothing to pick", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: true,
        presets: [],
        tenantId: "T1",
      })
    );

    expect(await screen.findByText("No preset icons yet")).toBeDefined();
  });

  it("stops offering the upload once the tenant holds 50 presets", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: true,
        presets: Array.from({ length: 50 }, (_, index) => preset(`p${index}`)),
        tenantId: "T1",
      })
    );

    expect(uploadButton().disabled).toBe(true);
    expect(
      await screen.findByText(
        "This tenant has 50 preset icons, the most it can hold. Delete one to add another."
      )
    ).toBeDefined();
  });

  it("keeps the upload open when the list could not be read", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: true,
        listErrorMessage: "Could not load the preset icons.",
        presets: [],
        tenantId: "T1",
      })
    );

    expect(
      await screen.findByText("Could not show the preset icons")
    ).toBeDefined();
    expect(screen.queryByText("No preset icons yet")).toBeNull();
    expect(uploadButton().disabled).toBe(false);
  });

  it("offers neither the upload nor a delete to someone who is not a tenant admin", async () => {
    render(
      await ReaderIconPresetGallery({
        canEdit: false,
        presets: [preset("p1")],
        tenantId: "T1",
      })
    );

    expect(uploadButton().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
