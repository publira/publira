// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { TenantDefaultLocaleForm } from "./tenant-default-locale-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "英語", locale: "en" as const },
];

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantDefaultLocaleForm", () => {
  it("shows the saved default locale as the selected one", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit
        initialDefaultLocale="en"
        options={options}
      />
    );

    const trigger = screen.getByLabelText("既定言語");

    expect(trigger.textContent).toContain("英語");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit={false}
        initialDefaultLocale="ja"
        options={options}
      />
    );

    expect(screen.getByLabelText("既定言語")).toHaveProperty("disabled", true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "既定言語を保存",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "この設定はテナント管理者のみ編集できます。現在は閲覧専用です。"
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit
        initialDefaultLocale="ja"
        loadErrorMessage="既定言語の取得に失敗しました。"
        options={options}
      />
    );

    expect(screen.getByLabelText("既定言語")).toHaveProperty("disabled", true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "既定言語を保存",
      }).disabled
    ).toBe(true);
    expect(screen.getByText(/既定言語の取得に失敗しました。/u)).toBeDefined();
    expect(
      screen.getByText(/保存すると現在の設定を上書きしてしまうため/u)
    ).toBeDefined();
  });
});
