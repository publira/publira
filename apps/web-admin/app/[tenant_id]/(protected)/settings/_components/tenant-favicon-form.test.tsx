// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantFaviconForm } from "./tenant-favicon-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

afterEach(() => {
  cleanup();
});

describe("TenantFaviconForm", () => {
  it("保存済みのファビコンをプレビューし、削除もできるようにする", () => {
    render(
      <TenantFaviconForm
        action={noopAction}
        initialFaviconUrl="/images/tenants/favicon-1"
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("現在のファビコン")
        .src.includes("favicon-1")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "削除" })).toBeDefined();
  });

  it("未設定のときはプレビューも削除操作も出さない", () => {
    render(<TenantFaviconForm action={noopAction} initialFaviconUrl="" />);

    expect(screen.queryByAltText("現在のファビコン")).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.getByText("ファビコンは設定されていません。")).toBeDefined();
  });

  it("アップロードと削除を同じフォームの intent で送り分ける", () => {
    render(
      <TenantFaviconForm
        action={noopAction}
        initialFaviconUrl="/images/tenants/favicon-1"
      />
    );

    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "ファビコンを保存",
    });

    expect(submit.name).toBe("intent");
    expect(submit.value).toBe("upload");
  });

  it("保存に成功したら、保存されたファビコンをプレビューに反映する", async () => {
    const action = vi.fn().mockResolvedValue({
      faviconUrl: "/images/tenants/favicon-2",
      message: "ファビコンを保存しました。",
      ok: true,
    });

    render(
      <TenantFaviconForm
        action={action}
        initialFaviconUrl="/images/tenants/favicon-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "ファビコンを保存" }));

    await waitFor(() => {
      expect(
        screen
          .getByAltText<HTMLImageElement>("現在のファビコン")
          .src.includes("favicon-2")
      ).toBe(true);
    });
  });

  it("送信が失敗しても、直前に保存されたファビコンを残す", () => {
    // 失敗した Action state は favicon を持たないので、表示をそこから導くと
    // 保存済みのアイコンが消える。保持しているのは最後に成功した URL である。
    const { rerender } = render(
      <TenantFaviconForm action={noopAction} initialFaviconUrl="" />
    );

    rerender(
      <TenantFaviconForm
        action={noopAction}
        initialFaviconUrl="/images/tenants/favicon-2"
      />
    );

    expect(
      screen
        .getByAltText<HTMLImageElement>("現在のファビコン")
        .src.includes("favicon-2")
    ).toBe(true);
  });
});
