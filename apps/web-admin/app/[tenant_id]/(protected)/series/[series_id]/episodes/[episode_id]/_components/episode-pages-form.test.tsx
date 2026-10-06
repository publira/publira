// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { EpisodeEditActionState } from "../episode-edit-types";
import { EpisodePagesForm } from "./episode-pages-form";

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

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

afterEach(() => {
  cleanup();
});

const action = vi.fn(() => Promise.resolve(null));

const renderForm = async (
  formAction: Parameters<typeof EpisodePagesForm>[0]["action"] = action
) =>
  render(
    await EpisodePagesForm({
      action: formAction,
      episodeId: "EP001-ID",
      episodePublicId: "EP001",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    })
  );

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so two episode edit pages can sit in the document
 * at the same time.
 */
const renderBothForms = async () => {
  const [first, second] = await Promise.all([
    EpisodePagesForm({
      action,
      episodeId: "EP001-ID",
      episodePublicId: "EP001",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    }),
    EpisodePagesForm({
      action,
      episodeId: "EP002-ID",
      episodePublicId: "EP002",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    }),
  ]);

  render(
    <>
      {first}
      {second}
    </>
  );
};

const fileInput = (): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>(/Page images|ZIP file|ePub file/u);

describe("EpisodePagesForm", () => {
  it("starts in pages mode with the file input set for images", async () => {
    const { container } = await renderForm();

    const uploadMode = container.querySelector(
      'input[name="upload_mode"]'
    ) as HTMLInputElement | null;
    const input = fileInput();

    expect(uploadMode?.value).toBe("pages");
    expect(input.name).toBe("pages");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/*");
    expect(
      screen.getByRole("button", { name: "Add page images" })
    ).toBeTruthy();
  });

  it("changes the input attributes and the wording when switching between ZIP and ePub", async () => {
    await renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Use a ZIP" }));

    const fileInputAfterZip = fileInput();

    expect(fileInputAfterZip.name).toBe("archive");
    expect(fileInputAfterZip.multiple).toBe(false);
    expect(fileInputAfterZip.accept).toBe(".zip,application/zip");
    expect(screen.getByRole("button", { name: "Add a ZIP" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use an ePub" }));

    const fileInputAfterEpub = fileInput();

    expect(fileInputAfterEpub.name).toBe("archive");
    expect(fileInputAfterEpub.accept).toBe(".epub,application/epub+zip");
    expect(screen.getByRole("button", { name: "Add an ePub" })).toBeTruthy();
  });

  it("shows the file name after a file is chosen and clears it when the mode changes", async () => {
    await renderForm();
    const input = fileInput();

    fireEvent.change(input, {
      target: {
        files: [
          new File(["a"], "page-1.png", { type: "image/png" }),
          new File(["b"], "page-2.png", { type: "image/png" }),
        ],
      },
    });

    expect(screen.getByText("page-1.png")).toBeTruthy();
    expect(screen.getByText("page-2.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use a ZIP" }));

    expect(screen.queryByText("page-1.png")).toBeNull();
    expect(screen.queryByText("page-2.png")).toBeNull();
  });

  it("keeps the ids unique when it is mounted twice", async () => {
    await renderBothForms();

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("points each label at its own input when it is mounted twice", async () => {
    await renderBothForms();

    const inputs = screen.getAllByLabelText<HTMLInputElement>(/Page images/u);

    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.name)).toEqual(["pages", "pages"]);
  });

  it("empties the list of picked files once the upload succeeds", async () => {
    const upload = Promise.withResolvers<EpisodeEditActionState>();
    await renderForm(() => upload.promise);

    const input = fileInput();
    fireEvent.change(input, {
      target: {
        files: [new File(["a"], "page-1.png", { type: "image/png" })],
      },
    });
    expect(screen.getByText("page-1.png")).toBeTruthy();

    fireEvent.submit(input.form as HTMLFormElement);
    await act(async () => {
      upload.resolve({
        message: "The pages were added.",
        ok: true,
      });
      await upload.promise;
    });

    expect(await screen.findByText("The pages were added.")).toBeTruthy();
    expect(screen.queryByText("page-1.png")).toBeNull();
  });

  // The Action carries the files picked when the form was submitted, so a file
  // picked or dropped while it is in flight would be listed but not uploaded.
  it("closes the file input and ignores a drop while the upload is in flight", async () => {
    // Never resolved: the assertions are about the window the upload is open in.
    const pendingAction = vi.fn(() => Promise.withResolvers<never>().promise);
    await renderForm(pendingAction);

    const input = fileInput();
    fireEvent.change(input, {
      target: {
        files: [new File(["a"], "page-1.png", { type: "image/png" })],
      },
    });

    expect(input.matches(":disabled")).toBe(false);

    // jsdom holds a click back: the files set above never reach the list its
    // `required` check reads.
    fireEvent.submit(input.form as HTMLFormElement);

    await waitFor(() => {
      expect(input.matches(":disabled")).toBe(true);
    });

    // jsdom has no `DataTransfer`, and its `files` setter takes nothing else,
    // so both stand in here for what a browser does with a drop.
    vi.stubGlobal(
      "DataTransfer",
      class {
        files: File[] = [];
        items = { add: (file: File) => this.files.push(file) };
      }
    );
    Object.defineProperty(input, "files", { value: null, writable: true });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    const dropZone = screen.getByText(
      "Drop images here or select files."
    ).parentElement;
    if (!dropZone) {
      throw new Error("The drop zone is missing.");
    }
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [new File(["b"], "page-2.png", { type: "image/png" })],
      },
    });

    expect(screen.queryByText("page-2.png")).toBeNull();
  });
});
