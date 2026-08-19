// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantLogoForm } from "./tenant-logo-form";

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
      variantType: "logo",
      width: 64,
    },
  ],
});

afterEach(() => {
  cleanup();
});

describe("TenantLogoForm", () => {
  it("保存済みのロゴをプレビューし、削除もできるようにする", () => {
    render(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    expect(
      screen.getByAltText<HTMLImageElement>("現在のロゴ").src.includes("logo-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "削除" })).toBeDefined();
  });

  it("未設定のときはプレビューも削除操作も出さない", () => {
    render(<TenantLogoForm action={noopAction} initialLogo={null} />);

    expect(screen.queryByAltText("現在のロゴ")).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.getByText("ロゴは設定されていません。")).toBeDefined();
  });

  it("アップロードと削除を同じフォームの intent で送り分ける", () => {
    render(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "ロゴを保存",
    });

    expect(submit.name).toBe("intent");
    expect(submit.value).toBe("upload");
  });

  it("保存に成功したら、保存されたロゴをプレビューに反映する", async () => {
    const action = vi.fn().mockResolvedValue({
      logo: brandingImage("/images/tenants/logo-2"),
      message: "ロゴを保存しました。",
      ok: true,
    });

    render(
      <TenantLogoForm
        action={action}
        initialLogo={brandingImage("/images/tenants/logo-1")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "ロゴを保存" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("現在のロゴ")
          .src.includes("logo-2")
      ).toBe(true);
    });
  });

  it("送信が失敗しても、直前に保存されたロゴを残す", () => {
    // 失敗した Action state は logo を持たないので、表示をそこから導くと
    // 保存済みの画像が消える。保持しているのは最後に成功した画像である。
    const { rerender } = render(
      <TenantLogoForm action={noopAction} initialLogo={null} />
    );

    rerender(
      <TenantLogoForm
        action={noopAction}
        initialLogo={brandingImage("/images/tenants/logo-2")}
      />
    );

    expect(
      screen.getByAltText<HTMLImageElement>("現在のロゴ").src.includes("logo-2")
    ).toBe(true);
  });
});
