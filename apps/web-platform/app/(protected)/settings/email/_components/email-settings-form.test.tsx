// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
} from "#lib/email-settings-shared";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";

import type {
  PlatformEmailSettingsFormState,
  PlatformSmtpTestFormState,
} from "../../_lib/actions";
import { EmailSettingsForm } from "./email-settings-form";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, resolved ahead so the tree renders
// without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

const storedSettings: PlatformSmtpSettings = {
  encryption: "starttls",
  fromAddress: "mail@platform.example",
  hasPassword: true,
  host: "smtp.platform.example",
  port: 587,
  replyTo: "",
  revision: "1",
  username: "platform-user",
};

const renderForm = ({
  saveAction = () => Promise.resolve<PlatformEmailSettingsFormState>(null),
  testAction = () => Promise.resolve<PlatformSmtpTestFormState>(null),
}: {
  saveAction?: (
    previousState: PlatformEmailSettingsFormState,
    formData: FormData
  ) => Promise<PlatformEmailSettingsFormState>;
  testAction?: (
    previousState: PlatformSmtpTestFormState,
    formData: FormData
  ) => Promise<PlatformSmtpTestFormState>;
}) =>
  render(
    <EmailSettingsForm
      initialSettings={storedSettings}
      saveAction={saveAction}
      testAction={testAction}
    />
  );

beforeEach(async () => {
  state.t = await getMessagesFor("en");
});

afterEach(() => {
  cleanup();
});

describe("EmailSettingsForm", () => {
  // The test runs against what the form holds, saved or not, so an operator
  // who tests an edit and then saves it has to find the edit still there.
  it("keeps the typed settings once the connection test settles", async () => {
    const testAction = vi.fn(
      (_previousState: PlatformSmtpTestFormState, _formData: FormData) =>
        Promise.resolve<PlatformSmtpTestFormState>({
          message: "Test email sent.",
          ok: true,
          recipientEmail: "operator@platform.example",
        })
    );
    renderForm({ testAction });

    const typed = [
      [/Host/u, "smtp.edited.example"],
      [/Port/u, "2525"],
      [/Username/u, "edited-user"],
      [/From address/u, "edited@platform.example"],
      [/Reply-to address/u, "support@platform.example"],
    ] as const;
    for (const [label, value] of typed) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }));

    await screen.findByText("Test email sent.");
    expect(testAction.mock.calls[0]?.[1].get("host")).toBe(
      "smtp.edited.example"
    );
    for (const [label, value] of typed) {
      expect(screen.getByLabelText(label)).toHaveProperty("value", value);
    }
  });

  it("sends the test to another address once Send to me is cleared", async () => {
    const testAction = vi.fn(
      (_previousState: PlatformSmtpTestFormState, _formData: FormData) =>
        Promise.resolve<PlatformSmtpTestFormState>({
          message: "Could not send the test email.",
          ok: false,
        })
    );
    renderForm({ testAction });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const sendToSelf = await screen.findByRole("checkbox", {
      name: "Send to me",
    });
    expect(screen.queryByLabelText(/Recipient email address/u)).toBeNull();

    fireEvent.click(sendToSelf);
    fireEvent.change(screen.getByLabelText(/Recipient email address/u), {
      target: { value: "someone@platform.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));

    await screen.findByText("Could not send the test email.");
    const formData = testAction.mock.calls[0]?.[1];
    expect(formData?.get("recipient_type")).toBe(
      String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
    );
    expect(formData?.get("recipient_email")).toBe("someone@platform.example");
  });

  it("keeps the stored password until the operator asks to change it", async () => {
    const saveAction = vi.fn(
      (_previousState: PlatformEmailSettingsFormState, _formData: FormData) =>
        Promise.resolve<PlatformEmailSettingsFormState>({
          message: "Could not save.",
          ok: false,
        })
    );
    renderForm({ saveAction });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Could not save.");
    const formData = saveAction.mock.calls[0]?.[1];
    expect(formData?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_UNCHANGED)
    );
    expect(formData?.has("password")).toBe(false);
    expect(formData?.get("revision")).toBe("1");
  });

  it("masks a saved password again and sends the revision the save wrote next", async () => {
    const saveAction = vi.fn(
      (_previousState: PlatformEmailSettingsFormState, _formData: FormData) =>
        Promise.resolve<PlatformEmailSettingsFormState>({
          message: "Email settings saved.",
          ok: true,
          settings: { ...storedSettings, revision: "2" },
        })
    );
    const { container } = renderForm({ saveAction });

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const password = container.querySelector<HTMLInputElement>(
      'input[name="password"]'
    );
    if (!password) {
      throw new Error("Change did not open the password box.");
    }
    fireEvent.change(password, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Email settings saved.");
    const saved = saveAction.mock.calls[0]?.[1];
    expect(saved?.get("password")).toBe("new-secret");
    expect(saved?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_REPLACE)
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    });
    expect(container.querySelector('input[name="password"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saveAction).toHaveBeenCalledTimes(2);
    });
    const next = saveAction.mock.calls[1]?.[1];
    expect(next?.get("revision")).toBe("2");
    expect(next?.get("password_update_mode")).toBe(
      String(SECRET_UPDATE_MODE_UNCHANGED)
    );
  });
});
