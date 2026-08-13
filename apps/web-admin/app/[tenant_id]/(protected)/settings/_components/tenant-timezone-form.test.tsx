// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantTimezoneForm } from "./tenant-timezone-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

afterEach(() => {
  cleanup();
});

describe("TenantTimezoneForm", () => {
  it("保存済みのタイムゾーンを選択済みとして表示する", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="America/Los_Angeles"
      />
    );

    const input = screen.getByLabelText<HTMLInputElement>("タイムゾーン");

    expect(input.value).toBe("America/Los_Angeles");
    expect(input.disabled).toBe(false);
  });

  it("列挙されないエイリアスが保存されていても選択済みのまま表示する", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="Asia/Calcutta"
      />
    );

    expect(screen.getByLabelText<HTMLInputElement>("タイムゾーン").value).toBe(
      "Asia/Calcutta"
    );
  });

  it("テナント管理者でない場合は閲覧専用にする", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit={false}
        initialTimezone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("タイムゾーン").disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "タイムゾーンを保存",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "この設定はテナント管理者のみ編集できます。現在は閲覧専用です。"
      )
    ).toBeDefined();
  });

  it("取得に失敗した場合は入力欄の横に理由を出す", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="Asia/Tokyo"
        loadErrorMessage="タイムゾーンの取得に失敗しました。"
      />
    );

    expect(
      screen.getByText("タイムゾーンの取得に失敗しました。")
    ).toBeDefined();
  });
});
