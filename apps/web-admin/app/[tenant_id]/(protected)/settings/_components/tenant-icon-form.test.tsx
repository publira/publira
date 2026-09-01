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
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
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
        .getByAltText<HTMLImageElement>("現在のアイコン")
        .src.includes("icon-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "削除" })).toBeDefined();
  });

  it("shows neither the preview nor the remove action when nothing is set", () => {
    render(<TenantIconForm action={noopAction} initialIcon={null} />);

    expect(screen.queryByAltText("現在のアイコン")).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.getByText("アイコンは設定されていません。")).toBeDefined();
  });

  it("tells upload and removal apart by the intent of the same form", () => {
    render(
      <TenantIconForm
        action={noopAction}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "アイコンを保存",
    });

    expect(submit.name).toBe("intent");
    expect(submit.value).toBe("upload");

    const remove = screen.getByRole<HTMLButtonElement>("button", {
      name: "アイコンを削除",
    });

    expect(remove.name).toBe("intent");
    expect(remove.value).toBe("delete");
  });

  it("reflects the saved icon in the preview once the save succeeds", async () => {
    const action = vi.fn().mockResolvedValue({
      icon: brandingImage("/images/tenants/icon-2"),
      message: "アイコンを保存しました。",
      ok: true,
    });

    render(
      <TenantIconForm
        action={action}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "アイコンを保存" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("現在のアイコン")
          .src.includes("icon-2")
      ).toBe(true);
    });
  });

  it("keeps the last saved icon when the submission fails", async () => {
    // 失敗した Action state は icon を持たないので、表示をそこから導くと
    // 保存済みの画像が消える。保持しているのは最後に成功した画像である。
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        icon: brandingImage("/images/tenants/icon-2"),
        message: "アイコンを保存しました。",
        ok: true,
      })
      .mockResolvedValueOnce({
        message: "アイコンの保存に失敗しました。",
        ok: false,
      });

    render(
      <TenantIconForm
        action={action}
        initialIcon={brandingImage("/images/tenants/icon-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "アイコンを保存" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("現在のアイコン")
          .src.includes("icon-2")
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "アイコンを保存" }));

    await waitFor(() => {
      expect(screen.getByText("アイコンの保存に失敗しました。")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "保存中..." })).toBeNull();
    });
    expect(
      screen
        .getByAltText<HTMLImageElement>("現在のアイコン")
        .src.includes("icon-2")
    ).toBe(true);
  });

  it("follows the new preview when initialIcon is replaced", () => {
    const { rerender } = render(
      <TenantIconForm action={noopAction} initialIcon={null} />
    );

    rerender(
      <TenantIconForm
        action={noopAction}
        initialIcon={brandingImage("/images/tenants/icon-2")}
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("現在のアイコン")
        .src.includes("icon-2")
    ).toBe(true);
  });
});
