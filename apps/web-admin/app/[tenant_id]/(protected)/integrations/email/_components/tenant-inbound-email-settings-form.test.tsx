// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import { emptyTenantInboundEmailSettings } from "#lib/inbound-email-settings-shared";
import type {
  InboundEmailProvider,
  TenantInboundEmailSettings,
} from "#lib/inbound-email-settings-shared";

import type { TenantInboundEmailSettingsFormState } from "../email-types";
import { TenantInboundEmailSettingsForm } from "./tenant-inbound-email-settings-form";

const { action } = vi.hoisted(() => ({
  action: {
    current: (
      _state: TenantInboundEmailSettingsFormState,
      _formData: FormData
    ): Promise<TenantInboundEmailSettingsFormState> => Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantInboundEmailSettingsAction: (
    state: TenantInboundEmailSettingsFormState,
    formData: FormData
  ) => action.current(state, formData),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const resend: InboundEmailProvider = {
  displayName: "Resend",
  fields: [
    { name: "api_key", required: true, secret: true },
    { name: "webhook_secret", required: true, secret: true },
  ],
  id: "resend",
  webhookPath: "/api/v1/webhook/email/resend",
};

const sendgrid: InboundEmailProvider = {
  displayName: "SendGrid",
  fields: [{ name: "webhook_token", required: true, secret: true }],
  id: "sendgrid",
  webhookPath: "/api/v1/webhook/email/sendgrid",
};

// A provider no catalog has copy for, so its fields are named as declared.
const exampleMail: InboundEmailProvider = {
  displayName: "Example Mail",
  fields: [
    { name: "account", required: true, secret: false },
    { name: "signing_key", required: false, secret: true },
  ],
  id: "examplemail",
  webhookPath: "/api/v1/webhook/email/examplemail",
};

const providers = [resend, sendgrid];

const resendFields = (
  apiKeyHint: string,
  webhookSecretHint: string
): TenantInboundEmailSettings["fields"] => [
  { configured: apiKeyHint !== "", hint: apiKeyHint, name: "api_key" },
  {
    configured: webhookSecretHint !== "",
    hint: webhookSecretHint,
    name: "webhook_secret",
  },
];

const readySettings: TenantInboundEmailSettings = {
  domain: "reply.comics.example",
  enabled: true,
  fields: resendFields("re_••••••••KLMN", "whsec_••••••••WXYZ"),
  provider: "resend",
  ready: true,
};

const disabledSettings: TenantInboundEmailSettings = {
  ...readySettings,
  enabled: false,
  ready: false,
};

const STAFF_ADDRESS_UNSET =
  "Readers' replies go to the address of the staff member who answered. Choose a provider and turn inbound email on to receive them in the console instead.";
const STAFF_ADDRESS_DISABLED =
  "The settings are stored, but inbound email is off. Readers' replies go to the address of the staff member who answered.";
const STAFF_ADDRESS_INCOMPLETE =
  "Inbound email is on, but the domain or a required credential is missing, so readers' replies still go to the address of the staff member who answered.";
const CONSOLE_READY =
  "Readers' replies come back to the console under the message they answer.";

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

afterEach(() => {
  cleanup();
  action.current = () => Promise.resolve(null);
});

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

const inboundCheckbox = () =>
  screen.getByRole("checkbox", { name: "Receive replies in the console" });

const chooseProvider = async (name: string) => {
  const select = screen.getByRole("combobox", {
    name: "Inbound email provider",
  });
  fireEvent.click(select);
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), {
    key: "Enter",
  });
};

describe("TenantInboundEmailSettingsForm", () => {
  it("is off by default and says readers' replies go to the answering staff member", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={emptyTenantInboundEmailSettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.getByText(STAFF_ADDRESS_UNSET)).toBeDefined();
    expect(inboundCheckbox().getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByRole("combobox", { name: "Inbound email provider" })
        .textContent
    ).toContain("Resend");
    expect(screen.getByLabelText("API key")).toBeDefined();
    expect(screen.getByLabelText("Webhook signing secret")).toBeDefined();
    expect(screen.queryByText("Reply address")).toBeNull();
  });

  it("says replies still go to the staff member while it is off or incomplete", () => {
    const { rerender } = render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={disabledSettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByText("Disabled")).toBeDefined();
    expect(screen.getByText(STAFF_ADDRESS_DISABLED)).toBeDefined();

    rerender(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={{
          ...readySettings,
          fields: resendFields("re_••••••••KLMN", ""),
          ready: false,
        }}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByText("Incomplete")).toBeDefined();
    expect(screen.getByText(STAFF_ADDRESS_INCOMPLETE)).toBeDefined();
  });

  it("shows the webhook URL and the reply address to register once it is ready", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
        webhookOrigin="https://comics.example"
      />
    );

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText(CONSOLE_READY)).toBeDefined();
    expect(
      screen.getByText("https://comics.example/api/v1/webhook/email/resend")
    ).toBeDefined();
    expect(
      screen.getByText(
        "In Resend, add this URL under Webhooks for the email.received event, then store the signing secret it shows above."
      )
    ).toBeDefined();
    expect(screen.getByText("contact+*@reply.comics.example")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy the webhook URL" })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy the reply address" })
    ).toBeDefined();
    expect(screen.getByDisplayValue("reply.comics.example")).toBeDefined();
  });

  it("names SendGrid's token and puts it in the webhook URL as the basic auth password", async () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={emptyTenantInboundEmailSettings}
        providers={providers}
        tenantId="TENANT001"
        webhookOrigin="https://comics.example"
      />
    );

    await chooseProvider("SendGrid");

    expect(await screen.findByLabelText("Webhook token")).toBeDefined();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(
      screen.getByText(
        "https://inbound:<token>@comics.example/api/v1/webhook/email/sendgrid"
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "In your DNS, point the domain's MX record at mx.sendgrid.net with priority 10."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "In SendGrid, add the inbound domain under Settings → Inbound Parse with this URL as the destination URL, putting the webhook token stored above in place of <token>."
      )
    ).toBeDefined();
  });

  it("warns that switching provider deletes the stored credentials", async () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.queryByText(
        "Saving with a different provider deletes the credentials stored for Resend."
      )
    ).toBeNull();

    await chooseProvider("SendGrid");

    expect(
      await screen.findByText(
        "Saving with a different provider deletes the credentials stored for Resend."
      )
    ).toBeDefined();
  });

  it("renders every field another provider declares under its declared name", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={{
          domain: "",
          enabled: false,
          fields: [
            { configured: true, hint: "acct_42", name: "account" },
            { configured: false, hint: "", name: "signing_key" },
          ],
          provider: "examplemail",
          ready: false,
        }}
        providers={[exampleMail]}
        tenantId="TENANT001"
        webhookOrigin="https://comics.example"
      />
    );

    const account = screen.getByLabelText<HTMLInputElement>("account");
    expect(account.type).toBe("text");
    expect(account.value).toBe("acct_42");
    expect(screen.getByLabelText<HTMLInputElement>("signing_key").type).toBe(
      "password"
    );
    expect(
      screen.getByText(
        "Register this URL with Example Mail as where it posts received mail."
      )
    ).toBeDefined();
  });

  it("requires the domain only while inbound email is on", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={emptyTenantInboundEmailSettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    const domain = screen.getByLabelText<HTMLInputElement>(/^Inbound domain/u);
    expect(domain.required).toBe(false);

    fireEvent.click(inboundCheckbox());

    expect(
      screen.getByLabelText<HTMLInputElement>(/^Inbound domain/u).required
    ).toBe(true);
  });

  it("posts the provider, the domain, and what the form did to each credential", async () => {
    const submit = vi.fn<typeof action.current>().mockResolvedValue(null);
    action.current = submit;

    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Change" })[1] as HTMLButtonElement
    );
    fireEvent.change(screen.getByLabelText(/^Webhook signing secret/u), {
      target: { value: "whsec_new" },
    });
    fireEvent.change(screen.getByLabelText(/^Inbound domain/u), {
      target: { value: "mail.comics.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });
    const formData = submit.mock.calls[0]?.[1];
    expect(formData?.get("tenant_id")).toBe("TENANT001");
    expect(formData?.get("provider")).toBe("resend");
    expect(formData?.get("enabled")).toBe("on");
    expect(formData?.get("domain")).toBe("mail.comics.example");
    expect(formData?.get("credential_api_key_mode")).toBe("keep");
    expect(formData?.get("credential_webhook_secret_mode")).toBe("replace");
    expect(formData?.get("credential_webhook_secret")).toBe("whsec_new");
  });

  it("shows only the hint and never the plaintext of a stored secret", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByDisplayValue("re_••••••••KLMN")).toBeDefined();
    expect(screen.getByDisplayValue("whsec_••••••••WXYZ")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows a field error the save answers next to its field", async () => {
    action.current = vi.fn().mockResolvedValue({
      fieldErrors: {
        domain: "Enter a domain name such as reply.example.com.",
      },
      message: "Check the highlighted fields.",
      ok: false,
    } satisfies TenantInboundEmailSettingsFormState);

    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Enter a domain name such as reply.example.com.")
    ).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit={false}
        initialSettings={readySettings}
        providers={providers}
        tenantId="TENANT001"
      />
    );

    expect(isClosed(inboundCheckbox())).toBe(true);
    expect(isClosed(screen.getByLabelText(/^Inbound domain/u))).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the read fails", () => {
    render(
      <TenantInboundEmailSettingsForm
        canEdit
        initialSettings={emptyTenantInboundEmailSettings}
        loadErrorMessage="Could not load the inbound email settings. Please try again later."
        providers={[]}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Could not load the inbound email settings. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByText("Not set")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(true);
  });
});
