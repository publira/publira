// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  cleanup();
});

describe("TenantIconForm", () => {
  it("保存済みのアイコンをプレビューし、削除もできるようにする", () => {
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

  it("未設定のときはプレビューも削除操作も出さない", () => {
    render(<TenantIconForm action={noopAction} initialIcon={null} />);

    expect(screen.queryByAltText("現在のアイコン")).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.getByText("アイコンは設定されていません。")).toBeDefined();
  });

  it("アップロードと削除を同じフォームの intent で送り分ける", () => {
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

  it("保存に成功したら、保存されたアイコンをプレビューに反映する", async () => {
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

  it("送信が失敗しても、直前に保存されたアイコンを残す", async () => {
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

    // 送信が終わるまで待つ。FormMessage 側の本文は検査しない — <output> は
    // フォーム reset で既定値のテキストに畳まれ、2 回目以降の本文が DOM に
    // 反映されない (#1070)。ここで確かめたいのはプレビューの保持である。
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
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

  it("initialIcon が差し替わったら、そのプレビューに追従する", () => {
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
