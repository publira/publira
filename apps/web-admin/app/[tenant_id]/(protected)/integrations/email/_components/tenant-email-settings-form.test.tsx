// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import {
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
} from "#lib/email-settings-shared";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";

import type {
  TenantEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../email-types";
import { TenantEmailSettingsForm } from "./tenant-email-settings-form";

const { actions } = vi.hoisted(() => ({
  actions: {
    save: (
      _previousState: TenantEmailSettingsFormState,
      _formData: FormData
    ): Promise<TenantEmailSettingsFormState> => Promise.resolve(null),
    test: (
      _previousState: TenantSmtpTestFormState,
      _formData: FormData
    ): Promise<TenantSmtpTestFormState> => Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  sendTenantSmtpTestEmailAction: (
    previousState: TenantSmtpTestFormState,
    formData: FormData
  ) => actions.test(previousState, formData),
  updateTenantEmailSettingsAction: (
    previousState: TenantEmailSettingsFormState,
    formData: FormData
  ) => actions.save(previousState, formData),
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

const storedSettings = (
  overrides: Partial<TenantSmtpSettings> = {}
): TenantSmtpSettings => ({
  encryption: "starttls",
  fromAddress: "mail@tenant.example",
  fromName: "Tenant Mail",
  hasPassword: true,
  host: "smtp.tenant.example",
  port: 587,
  replyTo: "",
  smtpOverrideEnabled: true,
  username: "tenant-user",
  ...overrides,
});

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const renderForm = async (
  settings: TenantSmtpSettings,
  {
    saveAction = () => Promise.resolve(null),
    testAction = () => Promise.resolve(null),
  }: {
    saveAction?: (
      previousState: TenantEmailSettingsFormState,
      formData: FormData
    ) => Promise<TenantEmailSettingsFormState>;
    testAction?: (
      previousState: TenantSmtpTestFormState,
      formData: FormData
    ) => Promise<TenantSmtpTestFormState>;
  } = {}
) => {
  actions.save = saveAction;
  actions.test = testAction;
  await act(() => {
    render(
      <TenantEmailSettingsForm
        canEdit
        fromNamePlaceholder="Tenant"
        initialSettings={settings}
        tenantId="TENANT001"
      />,
      { wrapper: EnglishConsole }
    );
  });
};

const refusedSave = () =>
  vi.fn((_previousState: TenantEmailSettingsFormState, _formData: FormData) =>
    Promise.resolve<TenantEmailSettingsFormState>({
      message: "Could not save.",
      ok: false,
    })
  );

const passwordBox = () => {
  const password = document.querySelector<HTMLInputElement>(
    'input[name="password"]'
  );
  if (!password) {
    throw new Error("The form has no password box open.");
  }
  return password;
};

const testButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Test the connection",
  });

const overrideCheckbox = () =>
  screen.getByRole("checkbox", { name: "Use this tenant's own SMTP server" });

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the checkboxes are Base UI ones that say so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

const settingsControls = () => [
  overrideCheckbox(),
  screen.getByRole("textbox", { name: /Host/u }),
  screen.getByRole("spinbutton", { name: /Port/u }),
  screen.getByRole("textbox", { name: /Username/u }),
  screen.getByRole("button", { name: "Change" }),
  screen.getByRole("combobox", { name: /Encryption/u }),
  screen.getByRole("textbox", { name: /Sender name/u }),
  screen.getByRole("textbox", { name: /Sender email address/u }),
  screen.getByRole("textbox", { name: /Reply-to address/u }),
  testButton(),
];

afterEach(() => {
  cleanup();
});

describe("TenantEmailSettingsForm", () => {
  // The test message goes out over the tenant's own SMTP server. A tenant that
  // overrides nothing sends over the platform relay instead, whose settings the
  // platform console owns and tests, and whose credentials the tenant console's
  // database role cannot read.
  it("offers the connection test only while the override is on", async () => {
    await renderForm(storedSettings({ smtpOverrideEnabled: false }));

    expect(testButton().disabled).toBe(true);

    await act(() => {
      fireEvent.click(overrideCheckbox());
    });

    expect(testButton().disabled).toBe(false);
  });

  it("offers the connection test for stored override settings", async () => {
    await renderForm(storedSettings());

    expect(testButton().disabled).toBe(false);
  });

  // A save carries every field the form held when it was submitted, so a
  // change made while it is in flight would sit in the form unsaved. A test
  // started meanwhile would send the fields the save has closed, which a
  // disabled control leaves out of the form, so it waits too.
  it("closes the fields and the connection test while the save is in flight", async () => {
    const save = Promise.withResolvers<TenantEmailSettingsFormState>();
    await renderForm(storedSettings(), { saveAction: () => save.promise });

    for (const control of settingsControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      for (const control of settingsControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });

    // A transition left open would hold back every later test's Action.
    save.resolve(null);
    await waitFor(() => {
      expect(testButton().matches(":disabled")).toBe(false);
    });
  });

  // The test runs against what the form holds, saved or not, so an operator
  // who tests an edit and then saves it has to find the edit still there.
  it("keeps the typed settings once the connection test settles", async () => {
    const testAction = vi.fn(
      (_previousState: TenantSmtpTestFormState, _formData: FormData) =>
        Promise.resolve<TenantSmtpTestFormState>({
          message: "Test email sent.",
          ok: true,
          recipientEmail: "admin@tenant.example",
        })
    );
    await renderForm(storedSettings(), { testAction });

    const typed = [
      [/Host/u, "smtp.edited.example"],
      [/Port/u, "2525"],
      [/Username/u, "edited-user"],
      [/Sender name/u, "Edited Mail"],
      [/Sender email address/u, "edited@tenant.example"],
      [/Reply-to address/u, "support@tenant.example"],
    ] as const;
    for (const [label, value] of typed) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    fireEvent.click(testButton());
    fireEvent.click(
      await screen.findByRole("button", { name: "Run the test" })
    );

    await screen.findByText("Test email sent.");
    expect(testAction.mock.calls[0]?.[1].get("host")).toBe(
      "smtp.edited.example"
    );
    for (const [label, value] of typed) {
      expect(screen.getByLabelText(label)).toHaveProperty("value", value);
    }
  });

  it("sends the test to the typed address once it is not sent to the operator", async () => {
    const testAction = vi.fn(
      (_previousState: TenantSmtpTestFormState, _formData: FormData) =>
        Promise.resolve<TenantSmtpTestFormState>({
          message: "Test email sent.",
          ok: true,
          recipientEmail: "recipient@example.com",
        })
    );
    await renderForm(storedSettings(), { testAction });

    fireEvent.click(testButton());
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Send it to myself" })
    );
    fireEvent.change(
      await screen.findByRole("textbox", { name: /Recipient email address/u }),
      { target: { value: "recipient@example.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));

    await screen.findByText("Test email sent.");
    const posted = testAction.mock.calls[0]?.[1];
    expect(posted?.get("recipient_type")).toBe(
      String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
    );
    expect(posted?.get("recipient_email")).toBe("recipient@example.com");
  });

  // The test carries the recipient chosen when it was started, so a change
  // made while it is in flight would not be where the message went.
  it("closes the recipient while the connection test is in flight", async () => {
    const test = Promise.withResolvers<TenantSmtpTestFormState>();
    await renderForm(storedSettings(), { testAction: () => test.promise });

    fireEvent.click(testButton());
    const sendToSelf = await screen.findByRole("checkbox", {
      name: "Send it to myself",
    });
    fireEvent.click(sendToSelf);
    const recipient = await screen.findByRole<HTMLInputElement>("textbox", {
      name: /Recipient email address/u,
    });
    fireEvent.change(recipient, {
      target: { value: "recipient@example.com" },
    });

    expect(isClosed(sendToSelf)).toBe(false);
    expect(recipient.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));

    await waitFor(() => {
      expect(isClosed(sendToSelf)).toBe(true);
      expect(recipient.disabled).toBe(true);
    });

    // A transition left open would hold back every later test's Action.
    test.resolve(null);
    await waitFor(() => {
      expect(recipient.disabled).toBe(false);
    });
  });

  it("keeps the stored password until the administrator asks to change it", async () => {
    const saveAction = refusedSave();
    await renderForm(storedSettings(), { saveAction });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Could not save.");
    const formData = saveAction.mock.calls[0]?.[1];
    expect(formData?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_UNCHANGED)
    );
    expect(formData?.has("password")).toBe(false);
  });

  it("saves without a username or a password for a relay that takes no credentials", async () => {
    const saveAction = refusedSave();
    await renderForm(storedSettings({ hasPassword: false, username: "" }), {
      saveAction,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Could not save.");
    const blank = saveAction.mock.calls[0]?.[1];
    expect(blank?.get("username")).toBe("");
    expect(blank?.get("password")).toBe("");
    expect(blank?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_CLEAR)
    );

    fireEvent.change(passwordBox(), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveAction).toHaveBeenCalledTimes(2);
    });
    expect(saveAction.mock.calls[1]?.[1].get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_REPLACE)
    );
  });

  // Moving saved credentials to a relay that takes none has to be able to drop
  // the stored password, which a blank username would otherwise be refused beside.
  it("removes the stored password when its box is opened and left empty", async () => {
    const saveAction = refusedSave();
    await renderForm(storedSettings(), { saveAction });

    fireEvent.change(screen.getByLabelText(/Username/u), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Could not save.");
    const formData = saveAction.mock.calls[0]?.[1];
    expect(formData?.get("username")).toBe("");
    expect(formData?.get("password")).toBe("");
    expect(formData?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_CLEAR)
    );
  });

  it("explains under the username what leaving it blank means", async () => {
    await renderForm(storedSettings());

    const description = screen.getByText(
      "Leave blank for a relay that takes no credentials; email is then sent without authenticating."
    );
    expect(
      screen.getByLabelText(/Username/u).getAttribute("aria-describedby")
    ).toContain(description.id);
  });

  it("says what an empty box does only while the stored password is open", async () => {
    const note = "Saving with this box empty removes the stored password.";
    await renderForm(storedSettings());

    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText(note)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the change" }));
    expect(screen.queryByText(note)).toBeNull();

    cleanup();
    await renderForm(storedSettings({ hasPassword: false, username: "" }));
    expect(screen.queryByText(note)).toBeNull();
  });

  it("shows the refusal of a password without a username on the username field", async () => {
    const refusal =
      "A password needs a username. Enter the username, or remove the password to send without authenticating.";
    const saveAction = vi.fn(
      (_previousState: TenantEmailSettingsFormState, _formData: FormData) =>
        Promise.resolve<TenantEmailSettingsFormState>({
          fieldErrors: { username: refusal },
          message: "Please check the information you entered.",
          ok: false,
        })
    );
    await renderForm(storedSettings({ hasPassword: false, username: "" }), {
      saveAction,
    });

    fireEvent.change(passwordBox(), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const message = await screen.findByText(refusal);
    const sent = saveAction.mock.calls[0]?.[1];
    expect(sent?.get("username")).toBe("");
    expect(sent?.get("password")).toBe("new-secret");
    const username = screen.getByLabelText(/Username/u);
    expect(username.parentElement?.contains(message)).toBe(true);
    expect(username).toHaveProperty("value", "");
    expect(passwordBox().value).toBe("new-secret");
  });
});
