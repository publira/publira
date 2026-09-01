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
import { emptyTenantPaymentSettings } from "#lib/payment-settings-shared";
import type { TenantPaymentSettings } from "#lib/payment-settings-shared";

import type { TenantPaymentSettingsFormState } from "../settings-types";
import { TenantPaymentSettingsForm } from "./tenant-payment-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const readySettings: TenantPaymentSettings = {
  enabled: true,
  provider: "stripe",
  ready: true,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

const incompleteSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  enabled: true,
};

const disabledSettings: TenantPaymentSettings = {
  ...emptyTenantPaymentSettings,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

const noopAction = (): Promise<TenantPaymentSettingsFormState> =>
  Promise.resolve(null);

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantPaymentSettingsForm", () => {
  it("shows an unconfigured tenant as its own status", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={emptyTenantPaymentSettings}
      />
    );

    expect(screen.getByText("未設定")).toBeDefined();
    expect(screen.getByLabelText("シークレットキー")).toBeDefined();
    expect(screen.getByLabelText("Webhook 署名シークレット")).toBeDefined();
  });

  it("shows only the hint and never the plaintext of a usable configuration", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
      />
    );

    expect(screen.getByText("利用可能")).toBeDefined();
    expect(screen.getByDisplayValue("sk_test_••••••••KLMN")).toBeDefined();
    expect(screen.getByDisplayValue("whsec_••••••••WXYZ")).toBeDefined();
    expect(screen.queryByDisplayValue(/sk_test_[^•]/u)).toBeNull();
    expect(
      screen.queryByLabelText("シークレットキー")?.getAttribute("type")
    ).toBe("text");
  });

  it("reports missing configuration when it is enabled without a secret", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={incompleteSettings}
      />
    );

    expect(screen.getByText("設定不足")).toBeDefined();
  });

  it("shows a saved but disabled configuration as disabled", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={disabledSettings}
      />
    );

    expect(screen.getByText("無効")).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit={false}
        initialSettings={readySettings}
      />
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Stripe 決済を有効にする")
        .disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled
    ).toBe(true);
    expect(
      screen.getAllByRole<HTMLButtonElement>("button", { name: "変更する" })[0]
        ?.disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "この設定はテナント管理者のみ編集できます。現在は閲覧専用です。"
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={emptyTenantPaymentSettings}
        loadErrorMessage="この操作を行う権限がありません。"
      />
    );

    expect(screen.getByText("この操作を行う権限がありません。")).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled
    ).toBe(true);
  });

  it("turns the fields write-only and keeps the hint once change is pressed", () => {
    render(
      <TenantPaymentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={readySettings}
      />
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "変更する",
      })[0] as HTMLButtonElement
    );

    const secretInput =
      screen.getByLabelText<HTMLInputElement>("シークレットキー");

    expect(secretInput.type).toBe("password");
    expect(secretInput.value).toBe("");
    expect(screen.getByDisplayValue("whsec_••••••••WXYZ")).toBeDefined();
  });

  it("shows a failed save on the form", async () => {
    const action = vi.fn().mockResolvedValue({
      message: "secret is required",
      ok: false,
    } satisfies TenantPaymentSettingsFormState);

    render(
      <TenantPaymentSettingsForm
        action={action}
        canEdit
        initialSettings={disabledSettings}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("secret is required")).toBeDefined();
    });
  });

  it("drops the typed secret after saving and shows only the hint", async () => {
    const leakedSecret = "plaintext-secret-value";
    const action = vi.fn().mockResolvedValue({
      message: "決済設定を保存しました。",
      ok: true,
      settings: {
        ...readySettings,
        secretKeyHint: "sk_test_••••••••NEW1",
      },
    } satisfies TenantPaymentSettingsFormState);

    render(
      <TenantPaymentSettingsForm
        action={action}
        canEdit
        initialSettings={readySettings}
      />
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "変更する",
      })[0] as HTMLButtonElement
    );
    fireEvent.change(screen.getByLabelText("シークレットキー"), {
      target: { value: leakedSecret },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("sk_test_••••••••NEW1")).toBeDefined();
    });
    expect(screen.queryByDisplayValue(leakedSecret)).toBeNull();
    expect(document.body.textContent).not.toContain(leakedSecret);
  });
});
