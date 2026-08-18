// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
});
