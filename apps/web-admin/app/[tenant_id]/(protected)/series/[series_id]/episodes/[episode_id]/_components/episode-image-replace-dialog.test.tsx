// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import {
  EPISODE_PAGE_IMAGE_MAX_BYTES,
  EPISODE_PAGE_REPLACE_PATH,
} from "#lib/episode-pages-upload";
import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";

import { EpisodeImageReplaceDialog } from "./episode-image-replace-dialog";

const { mockAddToast, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockAddToast: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("@publira/ui-components/toast", () => ({
  useToastManager: () => ({ add: mockAddToast }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Answers every replacement with `body`. */
const stubReplace = (body: EpisodePagesUploadResponse, status = 200) => {
  const fetch = vi.fn((_input: string, _init: RequestInit) =>
    Promise.resolve(Response.json(body, { status }))
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

/** Opens the dialog for page 3 and answers its file input. */
const openDialog = () => {
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeImageReplaceDialog
        episodeId="EP001-ID"
        imageId="IMAGE003"
        position={3}
      />
    </AdminLocaleTestProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Replace page 3" }));

  return screen.getByLabelText<HTMLInputElement>(/New page image/u);
};

describe("EpisodeImageReplaceDialog", () => {
  it("asks for one image of a format publira server decodes", () => {
    const input = openDialog();

    expect(screen.getByRole("dialog", { name: "Replace page 3" })).toBeTruthy();
    expect(input.multiple).toBe(false);
    expect(input.accept).toBe("image/jpeg,image/png,image/gif,image/webp");
  });

  it("posts the image to the replace route, then closes and reads the pages again", async () => {
    const fetch = stubReplace({ message: "Page replaced.", ok: true });
    const input = openDialog();

    fireEvent.submit(input.form as HTMLFormElement);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith({
        title: "Page replaced.",
        type: "success",
      });
    });
    const [path, init] = fetch.mock.calls[0] ?? [];
    expect(path).toBe(EPISODE_PAGE_REPLACE_PATH);
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body.get("episode_id")).toBe("EP001-ID");
    expect(body.get("image_id")).toBe("IMAGE003");
    expect(mockRefresh).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows the refusal the route answers with and stays open", async () => {
    stubReplace(
      {
        message:
          "The image could not be used. Choose a JPEG, PNG, GIF, or WebP image of up to 20MB.",
        ok: false,
      },
      422
    );
    const input = openDialog();

    fireEvent.submit(input.form as HTMLFormElement);

    expect(
      await screen.findByText(/The image could not be used/u)
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mockAddToast).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refuses an image over 20MB without sending it", async () => {
    const fetch = stubReplace({ message: "Page replaced.", ok: true });
    // jsdom submits an empty file in place of the one a `change` event hands
    // the input, so the oversized file is what the form's entries yield.
    const oversized = new File(["a"], "page-3.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", {
      value: EPISODE_PAGE_IMAGE_MAX_BYTES + 1,
    });
    const values = vi
      .spyOn(FormData.prototype, "values")
      .mockImplementation(() => [oversized].values());
    onTestFinished(() => {
      values.mockRestore();
    });
    const input = openDialog();

    fireEvent.submit(input.form as HTMLFormElement);

    expect(
      await screen.findByText(
        "The image is larger than 20MB. Choose a smaller one."
      )
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks to check the pages when the connection drops under the image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );
    const input = openDialog();

    fireEvent.submit(input.form as HTMLFormElement);

    expect(
      await screen.findByText(/the page may have been replaced/u)
    ).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});
