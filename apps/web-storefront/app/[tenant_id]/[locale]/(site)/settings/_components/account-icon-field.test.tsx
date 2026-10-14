// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { AccountIconField } from "./account-icon-field";

const { mockCheckImage, mockRefresh } = vi.hoisted(() => ({
  mockCheckImage: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("#lib/account-icon", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccountIconImage: mockCheckImage,
}));

const ICON = { height: 512, url: "/images/users/U001/icon-1.png", width: 512 };

const mockFetch = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  mockFetch.mockResolvedValueOnce(
    new Response(body === null ? null : JSON.stringify(body), { status })
  );

const fileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]');

/** Picks `file` the way the browser's file chooser hands it to the input. */
const pick = async (file: File) => {
  const input = fileInput();
  if (!input) {
    throw new Error("no file input");
  }
  await act(() => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

const png = () =>
  new File([new Uint8Array([1, 2, 3])], "icon.png", { type: "image/png" });

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockCheckImage.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountIconField", () => {
  it("offers an upload and no removal to an account with no icon", async () => {
    await renderWithClientMessages(
      <AccountIconField icon={null} locale="en" />
    );

    expect(
      await screen.findByRole("button", { name: "Upload icon" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove icon" })).toBeNull();
    expect(screen.queryByAltText("Your icon")).toBeNull();
  });

  it("shows the icon with a change and a removal once one is set", async () => {
    await renderWithClientMessages(
      <AccountIconField icon={ICON} locale="en" />
    );

    expect(
      await screen.findByRole("button", { name: "Change icon" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove icon" })).toBeTruthy();
    expect(screen.getByAltText<HTMLImageElement>("Your icon").src).toContain(
      "icon-1.png"
    );
  });

  it("uploads the picked image and reads the account again", async () => {
    answer(200, { message: "Your icon has been updated." });
    await renderWithClientMessages(
      <AccountIconField icon={null} locale="en" />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    const file = png();
    await pick(file);

    expect(await screen.findByText("Your icon has been updated.")).toBeTruthy();
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me/icon?locale=en");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData | undefined)?.get("icon")).toBe(file);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["too-large", "This image is larger than 10MB. Select a smaller one."],
    ["too-small", "This image is smaller than 128x128px. Select a larger one."],
    [
      "unsupported",
      "This file cannot be used. Select a JPEG, PNG, or WebP image.",
    ],
  ] as const)(
    "turns away a %s file without sending it",
    async (problem, message) => {
      mockCheckImage.mockResolvedValueOnce(problem);
      await renderWithClientMessages(
        <AccountIconField icon={null} locale="en" />
      );
      await screen.findByRole("button", { name: "Upload icon" });

      await pick(png());

      expect(await screen.findByText(message)).toBeTruthy();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    }
  );

  it("shows the refusal the server words", async () => {
    answer(400, {
      message:
        "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px.",
    });
    await renderWithClientMessages(
      <AccountIconField icon={null} locale="en" />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    await pick(png());

    expect(
      await screen.findByText(
        "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px."
      )
    ).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("words a refusal with no message as a failed upload", async () => {
    answer(403, null);
    await renderWithClientMessages(
      <AccountIconField icon={null} locale="en" />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    await pick(png());

    expect(
      await screen.findByText(
        "Could not update your icon. Please try again later."
      )
    ).toBeTruthy();
  });

  it("words a request that never arrived as a failed upload", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderWithClientMessages(
      <AccountIconField icon={null} locale="en" />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    await pick(png());

    expect(
      await screen.findByText(
        "Could not update your icon. Please try again later."
      )
    ).toBeTruthy();
  });

  it("removes the icon in the reader's language and reads the account again", async () => {
    answer(200, { message: "アイコンを削除しました。" });
    await renderWithClientMessages(
      <AccountIconField icon={ICON} locale="ja" />,
      "ja"
    );

    const remove = await screen.findByRole("button", {
      name: "アイコンを削除",
    });
    await act(() => {
      fireEvent.click(remove);
    });

    expect(await screen.findByText("アイコンを削除しました。")).toBeTruthy();
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me/icon?locale=ja");
    expect(init?.method).toBe("DELETE");
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});
