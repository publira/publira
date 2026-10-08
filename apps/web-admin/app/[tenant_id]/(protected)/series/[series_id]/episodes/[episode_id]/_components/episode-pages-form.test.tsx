// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import {
  EPISODE_PAGES_UPLOAD_MAX_BYTES,
  EPISODE_PAGES_UPLOAD_PATH,
} from "#lib/episode-pages-upload";
import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";

import { EpisodePagesForm } from "./episode-pages-form";

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Answers every upload with `body`, or leaves it in flight when given none. */
const stubUpload = (body?: EpisodePagesUploadResponse, status = 200) => {
  const fetch = vi.fn((_input: string, _init: RequestInit) =>
    body
      ? Promise.resolve(Response.json(body, { status }))
      : Promise.withResolvers<never>().promise
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const renderForm = async () =>
  render(
    await EpisodePagesForm({
      episodeId: "EP001-ID",
      episodePublicId: "EP001",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
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
      episodeId: "EP001-ID",
      episodePublicId: "EP001",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
    }),
    EpisodePagesForm({
      episodeId: "EP002-ID",
      episodePublicId: "EP002",
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
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
    expect(input.accept).toBe("image/jpeg,image/png,image/gif,image/webp");
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

  it("posts the form to the upload route and refreshes the screen once the pages are in", async () => {
    const fetch = stubUpload({ message: "Page images added.", ok: true });
    await renderForm();

    const input = fileInput();
    fireEvent.change(input, {
      target: {
        files: [new File(["a"], "page-1.png", { type: "image/png" })],
      },
    });
    expect(screen.getByText("page-1.png")).toBeTruthy();

    fireEvent.submit(input.form as HTMLFormElement);

    expect(await screen.findByText("Page images added.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [path, init] = fetch.mock.calls[0] ?? [];
    expect(path).toBe(EPISODE_PAGES_UPLOAD_PATH);
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body.get("episode_id")).toBe("EP001-ID");
    expect(body.get("series_id")).toBe("SERIES001-ID");
    expect(body.get("upload_mode")).toBe("pages");
    expect(mockRefresh).toHaveBeenCalledOnce();
    // The upload empties the file input, and the names listed for it with it.
    expect(screen.queryByText("page-1.png")).toBeNull();
  });

  it("shows the refusal the route answers with and keeps the screen as it is", async () => {
    stubUpload({ message: "Select a ZIP (.zip) file.", ok: false }, 400);
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    expect(await screen.findByText("Select a ZIP (.zip) file.")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("goes to the login page the route names when the session was rejected", async () => {
    stubUpload(
      {
        location: "/login?next=%2Fseries&reason=session_revoked",
        message: "Your session is no longer valid. Please sign in again.",
        ok: false,
      },
      401
    );
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/login?next=%2Fseries&reason=session_revoked"
      );
    });
  });

  it("holds an upload the network refused and sends it again once the browser is back online", async () => {
    const fetch = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        Response.json({ message: "Page images added.", ok: true })
      );
    vi.stubGlobal("fetch", fetch);
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    // Held rather than failed: nothing is said while the connection is gone.
    expect(
      screen.queryByText(
        "Could not add the page images. Please try again later."
      )
    ).toBeNull();

    window.dispatchEvent(new Event("online"));

    expect(await screen.findByText("Page images added.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1].body).toBe(fetch.mock.calls[0]?.[1].body);
  });

  it("refuses an answer that is not the route's own as a failed upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<html>Bad Gateway</html>", { status: 502 })
        )
      )
    );
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    expect(
      await screen.findByText(
        "Could not add the page images. Please try again later."
      )
    ).toBeTruthy();
  });

  it("states the size limit when a proxy in front refuses the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<html>Request Entity Too Large</html>", {
            status: 413,
          })
        )
      )
    );
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    expect(
      await screen.findByText(/Keep each upload to 256MB or less/u)
    ).toBeTruthy();
  });

  it("refuses files over the upload limit without sending them", async () => {
    const fetch = stubUpload({ message: "Page images added.", ok: true });
    // jsdom submits an empty file in place of the ones a `change` event
    // hands the input, so the oversized file is what the form's entries yield.
    const oversized = new File(["a"], "page-1.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", {
      value: EPISODE_PAGES_UPLOAD_MAX_BYTES + 1,
    });
    const values = vi
      .spyOn(FormData.prototype, "values")
      .mockImplementation(() => [oversized].values());
    onTestFinished(() => {
      values.mockRestore();
    });
    await renderForm();

    fireEvent.submit(fileInput().form as HTMLFormElement);

    expect(
      await screen.findByText(/Keep each upload to 256MB or less/u)
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  // The Action carries the files picked when the form was submitted, so a file
  // picked or dropped while it is in flight would be listed but not uploaded.
  it("closes the file input and ignores a drop while the upload is in flight", async () => {
    // Never answered: the assertions are about the window the upload is open in.
    stubUpload();
    await renderForm();

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
