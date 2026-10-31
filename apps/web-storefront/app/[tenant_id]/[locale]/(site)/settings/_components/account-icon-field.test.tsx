// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { AccountIconField } from "./account-icon-field";

const { mockCheckImage, mockRemoveIcon, mockSelectIcon, mockUploadIcon } =
  vi.hoisted(() => ({
    mockCheckImage: vi.fn(),
    mockRemoveIcon: vi.fn(),
    mockSelectIcon: vi.fn(),
    mockUploadIcon: vi.fn(),
  }));

vi.mock("../_lib/icon-actions", () => ({
  removeIconAction: mockRemoveIcon,
  selectIconAction: mockSelectIcon,
  uploadIconAction: mockUploadIcon,
}));

vi.mock("#lib/account-icon", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccountIconImage: mockCheckImage,
}));

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const ICON = { height: 512, url: "/images/users/U001/icon-1.png", width: 512 };

const UPLOAD = { kind: "upload" } as const;

const PRESETS = {
  kind: "preset",
  presets: [
    {
      icon: { height: 256, url: "/images/presets/P1/icon.png", width: 256 },
      id: "P1",
    },
    {
      icon: { height: 256, url: "/images/presets/P2/icon.png", width: 256 },
      id: "P2",
    },
  ],
} as const;

const PRESET_ICON = PRESETS.presets[1].icon;

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

/** The form the Action was called with. */
const sentForm = (action: typeof mockUploadIcon): FormData => {
  const [form] = action.mock.calls[0] ?? [];

  if (!(form instanceof FormData)) {
    throw new TypeError("the Action was not called with a form");
  }

  return form;
};

beforeEach(() => {
  mockCheckImage.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountIconField", () => {
  it("offers an upload and no removal to an account with no icon", async () => {
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={null}
        locale="en"
        tenantId={TENANT_ID}
      />
    );

    expect(
      await screen.findByRole("button", { name: "Upload icon" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove icon" })).toBeNull();
    expect(screen.queryByAltText("Your icon")).toBeNull();
  });

  it("shows the icon with a change and a removal once one is set", async () => {
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={ICON}
        locale="en"
        tenantId={TENANT_ID}
      />
    );

    expect(
      await screen.findByRole("button", { name: "Change icon" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove icon" })).toBeTruthy();
    expect(screen.getByAltText<HTMLImageElement>("Your icon").src).toContain(
      "icon-1.png"
    );
  });

  it("uploads the picked image for this tenant and locale", async () => {
    mockUploadIcon.mockResolvedValueOnce({
      message: "Your icon has been updated.",
      ok: true,
    });
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={null}
        locale="en"
        tenantId={TENANT_ID}
      />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    const file = png();
    await pick(file);

    expect(await screen.findByText("Your icon has been updated.")).toBeTruthy();
    const form = sentForm(mockUploadIcon);
    expect(form.get("icon")).toBe(file);
    expect(form.get("locale")).toBe("en");
    expect(form.get("tenantId")).toBe(TENANT_ID);
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
        <AccountIconField
          choice={UPLOAD}
          iconPresetId={null}
          icon={null}
          locale="en"
          tenantId={TENANT_ID}
        />
      );
      await screen.findByRole("button", { name: "Upload icon" });

      await pick(png());

      expect(await screen.findByText(message)).toBeTruthy();
      expect(mockUploadIcon).not.toHaveBeenCalled();
    }
  );

  it("shows the refusal the Action words", async () => {
    mockUploadIcon.mockResolvedValueOnce({
      message:
        "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px.",
      ok: false,
    });
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={null}
        locale="en"
        tenantId={TENANT_ID}
      />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    await pick(png());

    expect(
      await screen.findByText(
        "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px."
      )
    ).toBeTruthy();
  });

  it("words an Action that never answered as a failed upload", async () => {
    mockUploadIcon.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={null}
        locale="en"
        tenantId={TENANT_ID}
      />
    );
    await screen.findByRole("button", { name: "Upload icon" });

    await pick(png());

    expect(
      await screen.findByText(
        "Could not update your icon. Please try again later."
      )
    ).toBeTruthy();
  });

  it("removes the icon in the reader's language", async () => {
    mockRemoveIcon.mockResolvedValueOnce({
      message: "アイコンを削除しました。",
      ok: true,
    });
    await renderWithClientMessages(
      <AccountIconField
        choice={UPLOAD}
        iconPresetId={null}
        icon={ICON}
        locale="ja"
        tenantId={TENANT_ID}
      />,
      "ja"
    );

    const remove = await screen.findByRole("button", {
      name: "アイコンを削除",
    });

    await act(() => {
      fireEvent.click(remove);
    });

    expect(await screen.findByText("アイコンを削除しました。")).toBeTruthy();
    const form = sentForm(mockRemoveIcon);
    expect(form.get("locale")).toBe("ja");
    expect(form.get("tenantId")).toBe(TENANT_ID);
  });

  describe("under a tenant that offers presets", () => {
    it("offers the presets and no upload", async () => {
      await renderWithClientMessages(
        <AccountIconField
          choice={PRESETS}
          icon={null}
          iconPresetId={null}
          locale="en"
          tenantId={TENANT_ID}
        />
      );

      const list = await screen.findByRole("list", {
        name: "Icons to choose from",
      });

      expect(list.querySelectorAll("li")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Icon 1" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Icon 2" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upload icon" })).toBeNull();
      expect(fileInput()).toBeNull();
      expect(screen.queryByRole("button", { name: "Remove icon" })).toBeNull();
      expect(
        screen.getByText("Choose one of the icons this site provides.")
      ).toBeTruthy();
    });

    it("marks the preset the account shows and offers its removal", async () => {
      await renderWithClientMessages(
        <AccountIconField
          choice={PRESETS}
          icon={PRESET_ICON}
          iconPresetId="P2"
          locale="en"
          tenantId={TENANT_ID}
        />
      );

      const current = await screen.findByRole("button", { name: "Icon 2" });
      expect(current.getAttribute("aria-pressed")).toBe("true");
      expect(
        screen
          .getByRole("button", { name: "Icon 1" })
          .getAttribute("aria-pressed")
      ).toBe("false");
      expect(screen.getByRole("button", { name: "Remove icon" })).toBeTruthy();
      expect(screen.getByAltText<HTMLImageElement>("Your icon").src).toContain(
        "P2"
      );
    });

    it("shows the picked preset for this tenant and locale", async () => {
      mockSelectIcon.mockResolvedValueOnce({
        message: "Your icon has been updated.",
        ok: true,
      });
      await renderWithClientMessages(
        <AccountIconField
          choice={PRESETS}
          icon={null}
          iconPresetId={null}
          locale="en"
          tenantId={TENANT_ID}
        />
      );

      const preset = await screen.findByRole("button", { name: "Icon 1" });
      await act(() => {
        fireEvent.click(preset);
      });

      expect(
        await screen.findByText("Your icon has been updated.")
      ).toBeTruthy();
      const form = sentForm(mockSelectIcon);
      expect(form.get("presetId")).toBe("P1");
      expect(form.get("locale")).toBe("en");
      expect(form.get("tenantId")).toBe(TENANT_ID);
    });

    it("sends nothing for the preset the account already shows", async () => {
      await renderWithClientMessages(
        <AccountIconField
          choice={PRESETS}
          icon={PRESET_ICON}
          iconPresetId="P2"
          locale="en"
          tenantId={TENANT_ID}
        />
      );

      const current = await screen.findByRole("button", { name: "Icon 2" });
      await act(() => {
        fireEvent.click(current);
      });

      expect(mockSelectIcon).not.toHaveBeenCalled();
    });

    it("words an Action that never answered as a failed change", async () => {
      mockSelectIcon.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await renderWithClientMessages(
        <AccountIconField
          choice={PRESETS}
          icon={null}
          iconPresetId={null}
          locale="en"
          tenantId={TENANT_ID}
        />
      );

      const preset = await screen.findByRole("button", { name: "Icon 1" });
      await act(() => {
        fireEvent.click(preset);
      });

      expect(
        await screen.findByText(
          "Could not update your icon. Please try again later."
        )
      ).toBeTruthy();
    });
  });
});
